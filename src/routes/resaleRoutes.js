import { Router } from 'express';
import { z } from 'zod';
import { Vehicle } from '../models/vehicle.js';
import { Enquiry } from '../models/enquiry.js';
import { Person } from '../models/person.js';
import { Acquisition } from '../models/acquisition.js';
import { WorkOrder } from '../models/workOrder.js';
import { Sale } from '../models/sale.js';
import { ParkingSlot } from '../models/parkingSlot.js';
import { Movement } from '../models/movement.js';
import { permit } from '../middleware/permit.js';
import { httpError } from '../utils/core.js';
import { paginatedQuery } from '../utils/pagination.js';
const router = Router();
const money = z.coerce.number().min(0);
async function inventoryRecord(vehicle) {
  const [acquisition, orders] = await Promise.all([
    Acquisition.findOne({ vehicle: vehicle.id, status: 'Purchased' }),
    WorkOrder.find({ vehicle: vehicle.id }),
  ]);
  const refurbishmentCost = orders.reduce(
    (sum, o) =>
      sum +
      (o.actualLabour || 0) +
      (o.actualParts || 0) +
      o.expenses.reduce((x, e) => x + (e.type === 'Other' ? e.amount : 0), 0),
    0
  );
  return {
    vehicle,
    acquisition,
    refurbishmentCost,
    targetPrice: acquisition?.expectedResale,
    currentLocation: vehicle.currentLocation,
  };
}
router.get('/inventory', permit('sales'), async (req, res, next) => {
  try {
    const filter = { lifecycle: 'Ready for Sale' };
    if (req.query.search)
      filter.$or = ['registration', 'vehicleCode', 'make', 'model'].map((field) => ({
        [field]: { $regex: req.query.search, $options: 'i' },
      }));
    const vehicles = await Vehicle.find(filter)
      .populate('currentLocation')
      .sort({ updatedAt: -1 })
      .limit(Math.min(Number(req.query.limit) || 50, 100));
    res.json({ items: await Promise.all(vehicles.map(inventoryRecord)), total: vehicles.length });
  } catch (error) {
    next(error);
  }
});
router.get('/buyer-enquiries', permit('sales'), async (req, res, next) => {
  try {
    const filter = { type: 'buyer' };
    if (req.query.status) filter.status = req.query.status;
    res.json(await Enquiry.find(filter).populate('vehicle person assignedTo').sort({ createdAt: -1 }));
  } catch (error) {
    next(error);
  }
});
router.post('/buyer-enquiries', permit('sales'), async (req, res, next) => {
  try {
    const body = z
      .object({
        vehicle: z.string(),
        buyer: z.object({
          name: z.string().min(2),
          phone: z.string().optional(),
          email: z.string().email().optional(),
        }),
        source: z.string().optional(),
        budget: money.optional(),
        offer: money.optional(),
        appointment: z.coerce.date().optional(),
        testDrive: z
          .object({
            authorised: z.boolean().optional(),
            driver: z.string().optional(),
            at: z.coerce.date().optional(),
          })
          .optional(),
        followUp: z.coerce.date().optional(),
        notes: z.string().optional(),
      })
      .parse(req.body);
    const vehicle = await Vehicle.findOne({ _id: body.vehicle, lifecycle: 'Ready for Sale' });
    if (!vehicle) throw httpError(400, 'Only ready-for-sale inventory can receive buyer enquiries');
    const person = await Person.create({ ...body.buyer, kind: 'buyer' });
    const enquiry = await Enquiry.create({
      enquiryCode: `BUY-${Date.now().toString(36)}`.toUpperCase(),
      type: 'buyer',
      vehicle: vehicle.id,
      person: person.id,
      status: 'Open',
      source: body.source,
      askingPrice: body.budget,
      offer: body.offer,
      assignedTo: req.user.id,
      followUp: body.followUp,
      notes: JSON.stringify({ notes: body.notes, appointment: body.appointment, testDrive: body.testDrive }),
      history: [{ type: 'created', message: 'Buyer enquiry created', actor: req.user.id }],
    });
    res.status(201).json(enquiry);
  } catch (error) {
    next(error);
  }
});
router.patch('/buyer-enquiries/:id', permit('sales'), async (req, res, next) => {
  try {
    const body = z
      .object({
        status: z.enum(['Open', 'Contacted', 'On Hold', 'Rejected', 'Closed']).optional(),
        offer: money.optional(),
        followUp: z.coerce.date().nullable().optional(),
        notes: z.string().optional(),
        outcomeReason: z.string().optional(),
      })
      .parse(req.body);
    const enquiry = await Enquiry.findOne({ _id: req.params.id, type: 'buyer' });
    if (!enquiry) throw httpError(404, 'Buyer enquiry not found');
    Object.assign(enquiry, body);
    enquiry.history.push({
      type: 'updated',
      message: body.outcomeReason || 'Buyer enquiry updated',
      actor: req.user.id,
    });
    await enquiry.save();
    res.json(enquiry);
  } catch (error) {
    next(error);
  }
});
router.get('/sales', permit('sales'), paginatedQuery(Sale));
router.post('/sales', permit('sales'), async (req, res, next) => {
  try {
    const body = z
      .object({ vehicle: z.string(), buyerEnquiry: z.string().optional(), targetPrice: money.optional() })
      .parse(req.body);
    const vehicle = await Vehicle.findOne({ _id: body.vehicle, lifecycle: 'Ready for Sale' });
    if (!vehicle) throw httpError(400, 'Vehicle is not eligible inventory');
    const existing = await Sale.findOne({ vehicle: body.vehicle, status: { $nin: ['Closed', 'Cancelled'] } });
    if (existing) throw httpError(409, 'An active sale already exists for this vehicle');
    const sale = await Sale.create({
      ...body,
      targetPrice: body.targetPrice,
      status: 'Draft',
      transferTasks: [{ title: 'Ownership transfer paperwork' }, { title: 'Insurance handover' }],
      deliveryChecklist: [
        { title: 'Vehicle inspection at delivery' },
        { title: 'Keys handed over' },
        { title: 'Buyer acknowledgement' },
      ],
      history: [{ type: 'created', message: 'Sale transaction created', actor: req.user.id }],
    });
    res.status(201).json(sale);
  } catch (error) {
    next(error);
  }
});
router.post('/sales/:id/offers', permit('sales'), async (req, res, next) => {
  try {
    const { amount, note } = z.object({ amount: money, note: z.string().optional() }).parse(req.body);
    const sale = await Sale.findById(req.params.id);
    if (!sale) throw httpError(404, 'Sale not found');
    sale.offers.push({ amount, note, by: req.user.id });
    sale.agreedPrice = amount;
    sale.status = 'Offer Sent';
    sale.history.push({ type: 'offer', message: `Buyer offer recorded: ${amount}`, actor: req.user.id });
    await sale.save();
    res.json(sale);
  } catch (error) {
    next(error);
  }
});
router.post('/sales/:id/reserve', permit('sales'), async (req, res, next) => {
  try {
    const { until } = z.object({ until: z.coerce.date() }).parse(req.body);
    const sale = await Sale.findById(req.params.id);
    if (!sale || !sale.agreedPrice) throw httpError(400, 'An agreed offer is required before reservation');
    const vehicle = await Vehicle.findOne({ _id: sale.vehicle, lifecycle: 'Ready for Sale' });
    if (!vehicle) throw httpError(409, 'Vehicle is no longer available');
    sale.status = 'Reserved';
    sale.reservedUntil = until;
    sale.history.push({ type: 'reserved', message: 'Vehicle reserved for buyer', actor: req.user.id });
    await sale.save();
    await Vehicle.findByIdAndUpdate(vehicle.id, { lifecycle: 'Sale Negotiation' });
    res.json(sale);
  } catch (error) {
    next(error);
  }
});
router.post('/sales/:id/payments', permit('sales'), async (req, res, next) => {
  try {
    const payment = z
      .object({ amount: money, reference: z.string().min(2), confirmed: z.boolean() })
      .parse(req.body);
    const sale = await Sale.findById(req.params.id);
    if (!sale) throw httpError(404, 'Sale not found');
    sale.payments.push({ ...payment, recordedBy: req.user.id });
    sale.history.push({
      type: 'payment',
      message: `Payment recorded (${payment.confirmed ? 'confirmed' : 'unconfirmed'})`,
      actor: req.user.id,
    });
    await sale.save();
    res.status(201).json(sale);
  } catch (error) {
    next(error);
  }
});
router.patch('/sales/:id/tasks', permit('sales'), async (req, res, next) => {
  try {
    const body = z
      .object({
        buyerDocumentsComplete: z.boolean().optional(),
        transferTasks: z
          .array(
            z.object({ title: z.string(), completed: z.boolean(), completedAt: z.coerce.date().optional() })
          )
          .optional(),
        deliveryChecklist: z
          .array(
            z.object({ title: z.string(), completed: z.boolean(), completedAt: z.coerce.date().optional() })
          )
          .optional(),
        handoverNote: z.string().optional(),
      })
      .parse(req.body);
    const sale = await Sale.findByIdAndUpdate(req.params.id, body, { new: true });
    if (!sale) throw httpError(404, 'Sale not found');
    res.json(sale);
  } catch (error) {
    next(error);
  }
});
router.post('/sales/:id/close', permit('sales'), async (req, res, next) => {
  try {
    const sale = await Sale.findById(req.params.id);
    if (!sale) throw httpError(404, 'Sale not found');
    const confirmed = sale.payments.filter((p) => p.confirmed).reduce((sum, p) => sum + p.amount, 0);
    if (!sale.agreedPrice || confirmed < sale.agreedPrice)
      throw httpError(400, 'Confirmed payments must cover the agreed sale price');
    if (
      !sale.buyerDocumentsComplete ||
      sale.transferTasks.some((t) => !t.completed) ||
      sale.deliveryChecklist.some((t) => !t.completed)
    )
      throw httpError(400, 'Buyer documents, transfer tasks, and delivery checklist must be complete');
    const acquisition = await Acquisition.findOne({ vehicle: sale.vehicle, status: 'Purchased' });
    const orders = await WorkOrder.find({ vehicle: sale.vehicle });
    const repairs = orders.reduce(
      (sum, o) =>
        sum +
        (o.actualLabour || 0) +
        (o.actualParts || 0) +
        o.expenses.filter((e) => e.type === 'Other').reduce((x, e) => x + e.amount, 0),
      0
    );
    sale.deliveryConfirmed = true;
    sale.status = 'Closed';
    sale.closedAt = new Date();
    sale.actualProfit =
      confirmed -
      ((acquisition?.agreedPrice || acquisition?.proposedPrice || 0) +
        repairs +
        (acquisition?.transactionCosts || 0) +
        (acquisition?.holdingCosts || 0));
    sale.history.push({ type: 'closed', message: 'Sale completed and delivered', actor: req.user.id });
    await sale.save();
    const vehicle = await Vehicle.findByIdAndUpdate(
      sale.vehicle,
      { lifecycle: 'Sold / Delivered' },
      { new: true }
    );
    if (vehicle.currentLocation) {
      await ParkingSlot.findByIdAndUpdate(vehicle.currentLocation, {
        $set: { status: 'Available' },
        $unset: { activeVehicle: 1, occupiedAt: 1 },
      });
      await Vehicle.findByIdAndUpdate(vehicle.id, { $unset: { currentLocation: 1 } });
      await Movement.create({
        vehicle: vehicle.id,
        from: vehicle.currentLocation,
        action: 'Delivery release',
        reason: 'Sale delivered',
        by: req.user.id,
        physicalConfirmation: true,
      });
    }
    res.json(sale);
  } catch (error) {
    next(error);
  }
});
export default router;
