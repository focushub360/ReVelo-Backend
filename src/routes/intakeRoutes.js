import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { Appointment, Enquiry, ParkingSlot, Vehicle, VehicleIntake, Movement, Inspection, Notification } from '../models/index.js';
import { permit } from '../middleware/permit.js';
import { tenantFilter } from '../middleware/tenant.js';
import { httpError } from '../utils/core.js';
import { readPrivateDocument, savePrivateImage } from '../storage/privateStorage.js';
import { sendVehicleIntakeRejectionNotice } from '../services/emailService.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 10 } });
const checkInput = z.object({ ownerIdentityMatched: z.boolean(), rcMatched: z.boolean(), chassisMatched: z.boolean(), engineMatched: z.boolean(), keysReceived: z.boolean(), odometerRecorded: z.boolean(), exteriorChecked: z.boolean() });

// Keep a 20-minute travel / handover buffer around every advisor appointment.
// This is enforced on the API, not just the calendar UI, so a concurrent tab
// or direct request cannot double-book an advisor.
const assertAdvisorAvailability = async ({ req, startsAt, endsAt }) => {
  const bufferMs = 20 * 60 * 1000;
  const bufferedStart = new Date(startsAt.getTime() - bufferMs);
  const bufferedEnd = new Date(endsAt.getTime() + bufferMs);
  const conflict = await Appointment.findOne(
    tenantFilter(req, {
      assignedTo: req.user.id,
      type: 'Inspection',
      status: { $in: ['Requested', 'Confirmed'] },
      startsAt: { $lt: bufferedEnd },
      endsAt: { $gt: bufferedStart },
    })
  ).select('startsAt endsAt locationLabel');
  if (conflict) {
    throw httpError(
      409,
      `This overlaps an intake appointment at ${conflict.startsAt.toLocaleString()}. Keep at least 20 minutes between appointments and choose another date or time.`
    );
  }
};

router.get('/intake-appointments', permit('enquiries'), async (req, res, next) => {
  try {
    const filter = req.user.role === 'Dealer Admin' ? {} : { assignedTo: req.user.id };
    const appointments = await Appointment.find(tenantFilter(req, { ...filter, type: 'Inspection' }))
      .populate('enquiry', 'enquiryCode')
      .populate('vehicle', 'registration make model')
      .populate('party', 'name phone')
      .sort({ startsAt: 1 })
      .lean();
    res.json(appointments);
  } catch (error) { next(error); }
});

router.post('/enquiries/:id/intake-appointments', permit('enquiries'), async (req, res, next) => {
  try {
    const input = z.object({ startsAt: z.coerce.date(), endsAt: z.coerce.date(), locationLabel: z.string().trim().min(2).max(160), notes: z.string().max(1000).optional() }).parse(req.body);
    if (input.endsAt <= input.startsAt) throw httpError(400, 'Appointment end must be after start');
    await assertAdvisorAvailability({ req, startsAt: input.startsAt, endsAt: input.endsAt });
    const enquiry = await Enquiry.findOne(tenantFilter(req, { _id: req.params.id, type: 'seller' }));
    if (!enquiry) throw httpError(404, 'Seller enquiry not found');
    const appointment = await Appointment.create({ dealership: req.tenantId, enquiry: enquiry.id, vehicle: enquiry.vehicle, party: enquiry.person, assignedTo: req.user.id, type: 'Inspection', ...input, status: 'Confirmed' });
    res.status(201).json(appointment);
  } catch (error) { next(error); }
});
router.get('/enquiries/:id/intake-appointments', permit('enquiries'), async (req, res, next) => {
  try { res.json(await Appointment.find(tenantFilter(req, { enquiry: req.params.id, type: 'Inspection' })).sort({ startsAt: -1 }).lean()); }
  catch (error) { next(error); }
});

router.post('/intake-appointments/:id/complete', permit('parking:move'), async (req, res, next) => {
  try {
    const input = z.object({ parkingSlot: z.string(), odometer: z.coerce.number().min(0), physicalChecks: checkInput, roadTest: z.object({ completed: z.boolean(), durationMinutes: z.coerce.number().int().min(0).max(600), startMileage: z.coerce.number().min(0), endMileage: z.coerce.number().min(0), observations: z.string().max(3000).optional() }), advisorNotes: z.string().max(5000).optional(), liveLocation: z.object({ latitude: z.coerce.number().min(-90).max(90), longitude: z.coerce.number().min(-180).max(180), accuracy: z.coerce.number().min(0).optional() }).optional() }).parse(req.body);
    if (input.roadTest.endMileage < input.roadTest.startMileage) throw httpError(400, 'Road-test end mileage cannot be lower than start mileage');
    const appointment = await Appointment.findOne(tenantFilter(req, { _id: req.params.id, type: 'Inspection', status: 'Confirmed' }));
    if (!appointment) throw httpError(404, 'Confirmed physical-intake appointment not found');
    const slot = await ParkingSlot.findOne(tenantFilter(req, { _id: input.parkingSlot, enabled: true, type: 'parking', status: { $in: ['Available', 'Reserved'] } }));
    if (!slot) throw httpError(409, 'Choose an available parking slot released for vehicle intake');
    const vehicle = await Vehicle.findOne(tenantFilter(req, { _id: appointment.vehicle }));
    if (!vehicle || vehicle.currentLocation) throw httpError(409, 'Vehicle already has an active parking location');
    slot.status = 'Occupied'; slot.activeVehicle = vehicle.id; slot.occupiedAt = new Date(); slot.reservationVehicle = undefined; slot.reservedUntil = undefined; await slot.save();
    vehicle.currentLocation = slot.id; vehicle.odometer = input.odometer; await vehicle.save();
    const intake = await VehicleIntake.create({ dealership: req.tenantId, enquiry: appointment.enquiry, appointment: appointment.id, vehicle: vehicle.id, advisor: req.user.id, parkingSlot: slot.id, odometer: input.odometer, physicalChecks: input.physicalChecks, roadTest: input.roadTest, advisorNotes: input.advisorNotes, liveLocation: input.liveLocation ? { ...input.liveLocation, capturedAt: new Date() } : undefined, status: 'Completed', history: [{ type: 'completed', message: 'Service Advisor completed physical intake and road-test record', actor: req.user.id }] });
    appointment.status = 'Completed'; await appointment.save();
    await Movement.create({ dealership: req.tenantId, vehicle: vehicle.id, to: slot.id, action: 'Physical Intake', by: req.user.id, physicalConfirmation: true });
    res.status(201).json(intake);
  } catch (error) { next(error); }
});

router.post('/vehicle-intakes/:id/handoff-to-technician', permit('inspections:assign'), async (req, res, next) => {
  try {
    const intake = await VehicleIntake.findOne(tenantFilter(req, { _id: req.params.id, status: 'Completed' }));
    if (!intake) throw httpError(404, 'Completed physical intake not found');
    const existing = await Inspection.findOne(tenantFilter(req, { vehicle: intake.vehicle, kind: 'mechanical', parentReport: { $exists: true } }));
    if (existing) return res.json(existing);
    const { User } = await import('../models/user.js');
    const technician = await User.findOne(tenantFilter(req, { active: true, operationalProfile: 'Senior Technician / Vehicle Inspector' })).sort({ createdAt: 1 });
    if (!technician) throw httpError(400, 'Add an active Senior Technician before handoff');
    const [sourceSlot, inspectionSlot] = await Promise.all([
      ParkingSlot.findOne(tenantFilter(req, { _id: intake.parkingSlot, activeVehicle: intake.vehicle, status: 'Occupied' })),
      ParkingSlot.findOne(tenantFilter(req, { type: 'inspection', enabled: true, status: 'Available' })).sort({ code: 1 }),
    ]);
    if (!sourceSlot) throw httpError(409, 'The intake parking slot is no longer occupied by this vehicle');
    if (!inspectionSlot) throw httpError(409, 'No released inspection slot is available. A technician must release an inspection slot first.');
    sourceSlot.status = 'Available'; sourceSlot.activeVehicle = undefined; sourceSlot.occupiedAt = undefined;
    inspectionSlot.status = 'Occupied'; inspectionSlot.activeVehicle = intake.vehicle; inspectionSlot.occupiedAt = new Date();
    await Promise.all([sourceSlot.save(), inspectionSlot.save()]);
    await Vehicle.findOneAndUpdate(tenantFilter(req, { _id: intake.vehicle }), { currentLocation: inspectionSlot.id });
    await Movement.create({ dealership: req.tenantId, vehicle: intake.vehicle, from: sourceSlot.id, to: inspectionSlot.id, action: 'Move to technical inspection', by: req.user.id, physicalConfirmation: true });
    const inspection = await Inspection.create({ dealership: req.tenantId, vehicle: intake.vehicle, kind: 'mechanical', assignedTo: technician.id, assignedBy: req.user.id, status: 'Assigned', roadTest: intake.roadTest, diagnostics: { source: 'Service Advisor physical intake', notes: intake.advisorNotes }, history: [{ type: 'handoff', message: `Physical intake complete. Parking slot ${intake.parkingSlot}; road-test evidence supplied.`, actor: req.user.id }] });
    intake.status = 'Handed to Technician'; await intake.save();
    await Notification.create({ dealership: req.tenantId, recipient: technician.id, event: 'technical-inspection-assigned', title: 'Vehicle ready for technical inspection', body: 'Physical intake, parking allocation, and road-test details are ready. Customer documents are not included in this handoff.', entityType: 'Inspection', entityId: String(inspection.id) });
    res.status(201).json(inspection);
  } catch (error) { next(error); }
});
router.post('/vehicle-intakes/:id/reject', permit('enquiries:manage'), async (req, res, next) => {
  try {
    const { reason } = z.object({ reason: z.string().trim().min(3).max(2000) }).parse(req.body);
    const intake = await VehicleIntake.findOne(tenantFilter(req, { _id: req.params.id, status: 'Completed' }));
    if (!intake) throw httpError(404, 'Completed physical intake not found');
    const [enquiry, vehicle] = await Promise.all([Enquiry.findOne(tenantFilter(req, { _id: intake.enquiry })).populate('person'), Vehicle.findOne(tenantFilter(req, { _id: intake.vehicle }))]);
    if (!enquiry || !vehicle) throw httpError(404, 'Seller vehicle details not found');
    const slot = await ParkingSlot.findOne(tenantFilter(req, { _id: intake.parkingSlot, activeVehicle: vehicle.id }));
    if (slot) { slot.status = 'Available'; slot.activeVehicle = undefined; slot.occupiedAt = undefined; await slot.save(); }
    vehicle.currentLocation = undefined; await vehicle.save();
    intake.status = 'Rejected'; intake.rejectionReason = reason; intake.history.push({ type: 'rejected', message: `Service Advisor rejected physical intake: ${reason}`, actor: req.user.id }); await intake.save();
    enquiry.status = 'Rejected'; enquiry.history.push({ type: 'physical-intake-rejected', message: reason, actor: req.user.id }); await enquiry.save();
    await Movement.create({ dealership: req.tenantId, vehicle: vehicle.id, from: intake.parkingSlot, action: 'Release - intake rejected', reason, by: req.user.id, physicalConfirmation: true });
    let sellerNotification = 'not_applicable'; if (enquiry.person?.email) { try { sellerNotification = (await sendVehicleIntakeRejectionNotice({ email: enquiry.person.email, name: enquiry.person.name, registration: vehicle.registration, reason })).status; } catch { sellerNotification = 'failed'; } }
    res.json({ intake, sellerNotification });
  } catch (error) { next(error); }
});
router.post('/vehicle-intakes/:id/photos', permit('parking:move'), upload.array('photos', 10), async (req, res, next) => {
  try {
    const intake = await VehicleIntake.findOne(tenantFilter(req, { _id: req.params.id, status: { $in: ['Completed', 'In Progress'] } }));
    if (!intake) throw httpError(404, 'Physical intake not found');
    const categories = z.array(z.enum(['number-plate', 'odometer', 'front-exterior', 'rear-exterior', 'left-side', 'right-side', 'interior', 'existing-damage', 'road-test'])).parse(JSON.parse(req.body.categories || '[]'));
    if (!req.files?.length || req.files.length !== categories.length) throw httpError(400, 'Choose one category for every vehicle photo');
    const saved = await Promise.all(req.files.map(async (file, index) => ({ category: categories[index], ...(await savePrivateImage(file.buffer)), originalName: file.originalname.replace(/[\\/]/g, '_').slice(0, 180), size: file.size })));
    intake.photos.push(...saved); await intake.save(); res.status(201).json(intake.photos);
  } catch (error) { next(error); }
});
router.get('/vehicle-intakes/:id/photos/:index/file', permit('vehicles:view'), async (req, res, next) => {
  try {
    const intake = await VehicleIntake.findOne(tenantFilter(req, { _id: req.params.id }));
    if (!intake) throw httpError(404, 'Physical intake not found');
    const photo = intake.photos[Number(req.params.index)];
    if (!photo) throw httpError(404, 'Vehicle evidence photo not found');
    const file = await readPrivateDocument(photo.storageKey);
    res.type(photo.mimeType || 'image/jpeg').set('Content-Disposition', `inline; filename="${photo.originalName || photo.storageKey}"`).send(file);
  } catch (error) { next(error); }
});

export default router;
