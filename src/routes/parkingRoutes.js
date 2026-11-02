import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { ParkingZone } from '../models/parkingZone.js';
import { ParkingSlot } from '../models/parkingSlot.js';
import { Movement } from '../models/movement.js';
import { Vehicle } from '../models/vehicle.js';
import { permit } from '../middleware/permit.js';
import { httpError } from '../utils/core.js';
import { paginatedQuery } from '../utils/pagination.js';
import { tenantFilter } from '../middleware/tenant.js';

const router = Router();
const statuses = ['Available', 'Reserved', 'Occupied', 'Blocked', 'Maintenance'];
function handleSlotError(error, next) {
  if (error?.code === 11000) {
    next(httpError(409, 'A parking space with this code or zone, row, and number already exists'));
    return;
  }
  next(error);
}
async function findVehicle(vehicleReference, req) {
  const matches = [{ vehicleCode: vehicleReference }, { registration: vehicleReference }];
  if (mongoose.isObjectIdOrHexString(vehicleReference)) matches.unshift({ _id: vehicleReference });
  return Vehicle.findOne(tenantFilter(req, { $or: matches }));
}
const slotInput = z.object({
  code: z.string().min(2).max(30),
  zone: z.string().min(1),
  section: z.string().max(30).optional(),
  row: z.string().min(1).max(30),
  number: z.coerce.number().int().min(1).optional(),
  type: z.enum(['parking', 'inspection', 'road-test', 'workshop', 'delivery']).optional(),
  capacity: z.coerce.number().int().min(1).max(10).optional(),
  vehicleConstraints: z.array(z.string()).optional(),
  status: z.enum(statuses).optional(),
  vehicle: z.string().optional(),
});
async function setSlotAssignment(req, slot, status, vehicleReference) {
  if (!['Reserved', 'Occupied'].includes(status)) {
    slot.status = status;
    await slot.save();
    return slot;
  }
  if (!vehicleReference) throw httpError(400, `Select a vehicle before setting a slot to ${status}`);
  const vehicle = await findVehicle(vehicleReference, req);
  if (!vehicle) throw httpError(404, 'Vehicle not found. Select a valid vehicle registration.');
  if (status === 'Reserved' && slot.status === 'Occupied')
    throw httpError(409, 'Release the occupied vehicle before reserving this slot');
  if (
    status === 'Occupied' &&
    vehicle.currentLocation &&
    String(vehicle.currentLocation) !== String(slot.id)
  ) {
    throw httpError(409, 'Vehicle already has an active physical location');
  }
  if (
    status === 'Occupied' &&
    slot.reservationVehicle &&
    String(slot.reservationVehicle) !== String(vehicle.id)
  ) {
    throw httpError(409, 'This slot is reserved for a different vehicle');
  }
  if (
    status === 'Occupied' &&
    slot.activeVehicle &&
    String(slot.activeVehicle) !== String(vehicle.id)
  ) {
    throw httpError(409, 'Release the currently assigned vehicle before changing this slot');
  }
  if (status === 'Reserved') {
    slot.status = status;
    slot.reservationVehicle = vehicle.id;
    slot.reservedUntil = new Date(Date.now() + 2 * 3600e3);
    await slot.save();
    await Movement.create({
      dealership: req.tenantId,
      vehicle: vehicle.id,
      to: slot.id,
      action: 'Reserve',
      by: req.user.id,
    });
    return slot;
  }
  slot.status = status;
  slot.activeVehicle = vehicle.id;
  slot.occupiedAt = new Date();
  slot.reservationVehicle = undefined;
  slot.reservedUntil = undefined;
  await slot.save();
  vehicle.currentLocation = slot.id;
  await vehicle.save();
  await Movement.create({
    dealership: req.tenantId,
    vehicle: vehicle.id,
    to: slot.id,
    action: 'Occupy',
    by: req.user.id,
    physicalConfirmation: true,
  });
  return slot;
}
router.get('/parking/zones', permit('parking:view'), async (req, res, next) => {
  try {
    res.json(await ParkingZone.find(tenantFilter(req)).sort({ name: 1 }));
  } catch (error) {
    next(error);
  }
});
router.post('/parking/zones', permit('settings:manage'), async (req, res, next) => {
  try {
    res.status(201).json(
      await ParkingZone.create({ dealership: req.tenantId, ...z
          .object({
            name: z.string().min(2),
            code: z.string().min(2).max(12),
            description: z.string().optional(),
          })
          .parse(req.body) })
    );
  } catch (error) {
    next(error);
  }
});
router.patch('/parking/zones/:id', permit('settings:manage'), async (req, res, next) => {
  try {
    const zone = await ParkingZone.findOneAndUpdate(
      tenantFilter(req, { _id: req.params.id }),
      z
        .object({
          name: z.string().min(2).optional(),
          description: z.string().optional(),
          enabled: z.boolean().optional(),
        })
        .parse(req.body),
      { new: true }
    );
    if (!zone) throw httpError(404, 'Parking zone not found');
    res.json(zone);
  } catch (error) {
    next(error);
  }
});
router.get('/parking/slots', permit('parking:view'), paginatedQuery(ParkingSlot));
router.post('/parking/slots', permit('parking:configure'), async (req, res, next) => {
  try {
    const input = slotInput.parse(req.body);
    const { vehicle, status = 'Available', ...slotData } = input;
    if (['Reserved', 'Occupied'].includes(status) && !vehicle)
      throw httpError(400, `Select a vehicle before setting a slot to ${status}`);
    if (['Reserved', 'Occupied'].includes(status)) {
      const vehicleRecord = await findVehicle(vehicle, req);
      if (!vehicleRecord)
        throw httpError(404, 'Vehicle not found. Select a valid vehicle registration.');
      if (
        status === 'Occupied' &&
        vehicleRecord.currentLocation
      ) {
        throw httpError(409, 'Vehicle already has an active physical location');
      }
    }
    const slot = await ParkingSlot.create({
      ...slotData,
      status: 'Available',
      dealership: req.tenantId,
    });
    if (['Reserved', 'Occupied'].includes(status))
      await setSlotAssignment(req, slot, status, vehicle);
    res.status(201).json(slot);
  } catch (error) {
    handleSlotError(error, next);
  }
});
router.patch('/parking/slots/:id', permit('parking:configure'), async (req, res, next) => {
  try {
    const slot = await ParkingSlot.findOne(tenantFilter(req, { _id: req.params.id }));
    if (!slot) throw httpError(404, 'Parking slot not found');
    const update = slotInput.partial().extend({ enabled: z.boolean().optional() }).parse(req.body);
    if (
      ['Occupied', 'Reserved'].includes(slot.status) &&
      update.enabled === false
    )
      throw httpError(409, 'Release the active assignment before disabling this slot');
    if (slot.status === 'Occupied' && update.status && update.status !== 'Occupied')
      throw httpError(409, 'Release the occupied vehicle before changing this slot status');
    if (
      slot.status === 'Reserved' &&
      update.status &&
      update.status !== 'Reserved' &&
      update.status !== 'Occupied'
    )
      throw httpError(409, 'Cancel the reservation before changing this slot status');
    if (
      slot.status === 'Reserved' &&
      update.status === 'Occupied' &&
      String(update.vehicle || '') !== String(slot.reservationVehicle || '')
    )
      throw httpError(409, 'A reservation can only be occupied by its assigned vehicle');
    if (
      slot.status === 'Reserved' &&
      update.status === 'Reserved' &&
      update.vehicle &&
      String(update.vehicle) !== String(slot.reservationVehicle || '')
    )
      throw httpError(409, 'Cancel the reservation before assigning it to a different vehicle');
    const { vehicle, status, ...slotData } = update;
    Object.assign(slot, slotData);
    if (status) {
      const currentVehicle = status === 'Occupied' ? slot.activeVehicle : slot.reservationVehicle;
      const assignmentUnchanged =
        ['Reserved', 'Occupied'].includes(status) &&
        slot.status === status &&
        currentVehicle &&
        String(currentVehicle) === String(vehicle || currentVehicle);
      if (assignmentUnchanged) await slot.save();
      else await setSlotAssignment(
        req,
        slot,
        status,
        vehicle || slot.activeVehicle || slot.reservationVehicle
      );
    } else await slot.save();
    res.json(slot);
  } catch (error) {
    handleSlotError(error, next);
  }
});
router.delete('/parking/slots/:id', permit('parking:configure'), async (req, res, next) => {
  try {
    const slot = await ParkingSlot.findOne(tenantFilter(req, { _id: req.params.id }));
    if (!slot) throw httpError(404, 'Parking slot not found');
    if (['Occupied', 'Reserved'].includes(slot.status))
      throw httpError(409, 'An occupied or reserved slot cannot be removed');
    await slot.deleteOne();
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
router.get('/parking/vehicles/:vehicleId/history', permit('parking:view'), async (req, res, next) => {
  try {
    res.json(
      await Movement.find(tenantFilter(req, { vehicle: req.params.vehicleId })).populate('from to by').sort({ createdAt: -1 })
    );
  } catch (error) {
    next(error);
  }
});
router.post('/parking/reserve', permit('parking:reserve'), async (req, res, next) => {
  try {
    const { vehicle, slot, reason, reservedUntil } = z
      .object({
        vehicle: z.string(),
        slot: z.string(),
        reason: z.string().max(1000).optional(),
        reservedUntil: z.coerce.date().optional(),
      })
      .parse(req.body);
    const vehicleRecord = await findVehicle(vehicle, req);
    if (!vehicleRecord) throw httpError(404, 'Vehicle not found. Use a valid vehicle ID, registration, or vehicle code.');
    const target = await ParkingSlot.findOneAndUpdate(
      tenantFilter(req, { _id: slot, status: 'Available', enabled: true }),
      {
        $set: {
          status: 'Reserved',
          reservationVehicle: vehicleRecord.id,
          reservedUntil: reservedUntil || new Date(Date.now() + 2 * 3600e3),
        },
      },
      { new: true }
    );
    if (!target) throw httpError(409, 'This slot is no longer available');
    await Movement.create({
      dealership: req.tenantId, vehicle: vehicleRecord.id,
      to: target.id,
      action: 'Reserve',
      reason,
      by: req.user.id,
    });
    res.json(target);
  } catch (error) {
    next(error);
  }
});
router.post('/parking/confirm', permit('parking:move'), async (req, res, next) => {
  try {
    const { vehicle, slot, reason } = z
      .object({ vehicle: z.string(), slot: z.string(), reason: z.string().max(1000).optional() })
      .parse(req.body);
    const vehicleRecord = await findVehicle(vehicle, req);
    if (!vehicleRecord) throw httpError(404, 'Vehicle not found. Use a valid vehicle ID, registration, or vehicle code.');
    if (vehicleRecord.currentLocation && String(vehicleRecord.currentLocation) !== slot)
      throw httpError(409, 'Vehicle already has an active physical location');
    const target = await ParkingSlot.findOneAndUpdate(
      {
        ...tenantFilter(req), _id: slot,
        status: { $in: ['Available', 'Reserved'] },
        $or: [
          { reservationVehicle: { $exists: false } },
          { reservationVehicle: null },
          { reservationVehicle: vehicleRecord.id },
        ],
      },
      {
        $set: { status: 'Occupied', activeVehicle: vehicleRecord.id, occupiedAt: new Date() },
        $unset: { reservationVehicle: 1, reservedUntil: 1 },
      },
      { new: true }
    );
    if (!target) throw httpError(409, 'This slot cannot be occupied');
    await Vehicle.findOneAndUpdate(tenantFilter(req, { _id: vehicleRecord.id }), { $set: { currentLocation: target.id } });
    await Movement.create({
      dealership: req.tenantId, vehicle: vehicleRecord.id,
      to: target.id,
      action: 'Occupy',
      reason,
      by: req.user.id,
      physicalConfirmation: true,
    });
    res.json(target);
  } catch (error) {
    next(error);
  }
});
router.post('/parking/release', permit('parking:release'), async (req, res, next) => {
  try {
    const { vehicle, reason } = z
      .object({ vehicle: z.string(), reason: z.string().min(1).max(1000) })
      .parse(req.body);
    const vehicleRecord = await Vehicle.findOne(tenantFilter(req, { _id: vehicle }));
    if (!vehicleRecord?.currentLocation) throw httpError(404, 'Vehicle has no active location');
    const slot = await ParkingSlot.findOneAndUpdate(
      tenantFilter(req, { _id: vehicleRecord.currentLocation, activeVehicle: vehicle, status: 'Occupied' }),
      { $set: { status: 'Available' }, $unset: { activeVehicle: 1, occupiedAt: 1 } },
      { new: true }
    );
    if (!slot) throw httpError(409, 'Persisted vehicle location is inconsistent');
    await Vehicle.findOneAndUpdate(tenantFilter(req, { _id: vehicle }), { $unset: { currentLocation: 1 } });
    await Movement.create({
      dealership: req.tenantId, vehicle,
      from: slot.id,
      action: 'Release',
      reason,
      by: req.user.id,
      physicalConfirmation: true,
    });
    res.json(slot);
  } catch (error) {
    next(error);
  }
});
router.post('/parking/relocate', permit('parking:move'), async (req, res, next) => {
  try {
    const { vehicle, to, reason } = z
      .object({ vehicle: z.string(), to: z.string(), reason: z.string().min(1).max(1000) })
      .parse(req.body);
    const record = await Vehicle.findOne(tenantFilter(req, { _id: vehicle }));
    if (!record?.currentLocation) throw httpError(404, 'Vehicle has no active location');
    const target = await ParkingSlot.findOneAndUpdate(
      tenantFilter(req, { _id: to, status: 'Available', enabled: true }),
      { $set: { status: 'Occupied', activeVehicle: vehicle, occupiedAt: new Date() } },
      { new: true }
    );
    if (!target) throw httpError(409, 'Destination is no longer available');
    const source = await ParkingSlot.findOneAndUpdate(
      tenantFilter(req, { _id: record.currentLocation, activeVehicle: vehicle, status: 'Occupied' }),
      { $set: { status: 'Available' }, $unset: { activeVehicle: 1, occupiedAt: 1 } },
      { new: true }
    );
    if (!source) {
      await ParkingSlot.findOneAndUpdate(tenantFilter(req, { _id: target.id }), {
        $set: { status: 'Available' },
        $unset: { activeVehicle: 1, occupiedAt: 1 },
      });
      throw httpError(409, 'Source slot changed before relocation completed');
    }
    await Vehicle.findOneAndUpdate(tenantFilter(req, { _id: vehicle }), { $set: { currentLocation: target.id } });
    await Movement.create({
      dealership: req.tenantId, vehicle,
      from: source.id,
      to: target.id,
      action: 'Relocate',
      reason,
      by: req.user.id,
      physicalConfirmation: true,
    });
    res.json({ from: source, to: target });
  } catch (error) {
    next(error);
  }
});
export default router;
