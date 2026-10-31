import { Router } from 'express';
import { z } from 'zod';
import { Vehicle, Person, OwnershipPeriod, Enquiry, Audit } from '../models/index.js';
import { permit } from '../middleware/permit.js';
import { tenantFilter } from '../middleware/tenant.js';
import { id, audit, httpError } from '../utils/core.js';
import { paginatedQuery } from '../utils/pagination.js';

const router = Router();
const page = paginatedQuery;

const enquiryInput = z.object({
  seller: z.object({
    name: z.string().min(2),
    phone: z.string().max(30).optional(),
    email: z.string().email().optional(),
  }),
  vehicle: z.object({
    registration: z.string().max(30).optional(),
    vin: z.string().max(80).optional(),
    chassis: z.string().max(80).optional(),
    engine: z.string().max(80).optional(),
    make: z.string().max(80).optional(),
    model: z.string().max(80).optional(),
    variant: z.string().max(80).optional(),
    year: z.coerce.number().int().min(1900).max(2100).optional(),
    fuelType: z.string().max(40).optional(),
    transmission: z.string().max(40).optional(),
    odometer: z.coerce.number().min(0).optional(),
  }),
  askingPrice: z.coerce.number().min(0).optional(),
  source: z.string().max(80).optional(),
  receivedAt: z.coerce.date().optional(),
  declaredAccidentHistory: z.string().max(3000).optional(),
  serviceHistory: z.string().max(3000).optional(),
  initialCondition: z.string().max(3000).optional(),
  assignedTo: z.string().optional(),
  followUp: z.coerce.date().optional(),
  nextAction: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
  photos: z.array(z.string().max(500)).max(10).optional(),
});
router.post('/enquiries', permit('enquiries'), async (q, s, n) => {
  try {
    const b = enquiryInput.parse(q.body);
    const identifiers = [
      ...(b.vehicle.vin ? [{ vin: b.vehicle.vin }] : []),
      ...(b.vehicle.chassis ? [{ chassis: b.vehicle.chassis }] : []),
      ...(b.vehicle.registration ? [{ registration: b.vehicle.registration }] : []),
    ];
    let vehicle = identifiers.length ? await Vehicle.findOne(tenantFilter(q, { $or: identifiers })) : null;
    const duplicate = !!vehicle;
    if (!vehicle)
      vehicle = await Vehicle.create({
        ...b.vehicle,
        dealership: q.tenantId,
        vehicleCode: id('VEH'),
        activities: [{ type: 'created', message: 'Vehicle master created', actor: q.user.id }],
      });
    const person = await Person.create({ ...b.seller, dealership: q.tenantId, kind: 'seller' });
    await OwnershipPeriod.create({
      vehicle: vehicle.id,
      owner: person.id,
      startDate: b.receivedAt,
      source: 'Seller declared',
    });
    const enq = await Enquiry.create({
      dealership: q.tenantId,
      enquiryCode: id('ENQ'),
      vehicle: vehicle.id,
      person: person.id,
      askingPrice: b.askingPrice,
      source: b.source,
      receivedAt: b.receivedAt,
      declaredAccidentHistory: b.declaredAccidentHistory,
      serviceHistory: b.serviceHistory,
      initialCondition: b.initialCondition,
      photos: b.photos,
      assignedTo: b.assignedTo || q.user.id,
      followUp: b.followUp,
      nextAction: b.nextAction,
      notes: b.notes,
      history: [
        {
          type: 'created',
          message: duplicate
            ? 'Seller enquiry linked to possible matching vehicle'
            : 'Seller enquiry created',
          actor: q.user.id,
        },
      ],
    });
    await audit(Audit, q.user.id, 'CREATE', 'Enquiry', enq.id, { duplicate, vehicle: vehicle.id });
    s.status(201).json({
      enquiry: enq,
      vehicle,
      possibleDuplicate: duplicate,
      duplicateReviewRequired: duplicate,
    });
  } catch (e) {
    n(e);
  }
});
router.get('/enquiries', permit('enquiries'), page(Enquiry));
router.get('/enquiries/:id', permit('enquiries'), async (q, s, n) => {
  try {
    const enquiry = await Enquiry.findOne(tenantFilter(q, { _id: q.params.id })).populate('vehicle person assignedTo');
    if (!enquiry) throw httpError(404, 'Enquiry not found');
    const [ownership, related] = await Promise.all([
      OwnershipPeriod.find({ vehicle: enquiry.vehicle.id }).populate('owner'),
      Enquiry.find(tenantFilter(q, { vehicle: enquiry.vehicle.id })).populate('person assignedTo').sort({ createdAt: -1 }),
    ]);
    s.json({ enquiry, ownership, related });
  } catch (e) {
    n(e);
  }
});
router.patch('/enquiries/:id', permit('enquiries'), async (q, s, n) => {
  try {
    const changes = z
      .object({
        status: z.enum(['Open', 'Contacted', 'On Hold', 'Rejected', 'Closed']).optional(),
        askingPrice: z.coerce.number().min(0).optional(),
        source: z.string().max(80).optional(),
        assignedTo: z.string().optional(),
        followUp: z.coerce.date().nullable().optional(),
        nextAction: z.string().max(500).optional(),
        notes: z.string().max(5000).optional(),
        declaredAccidentHistory: z.string().max(3000).optional(),
        serviceHistory: z.string().max(3000).optional(),
        initialCondition: z.string().max(3000).optional(),
        reason: z.string().max(1000).optional(),
      })
      .parse(q.body);
    const enquiry = await Enquiry.findOne(tenantFilter(q, { _id: q.params.id }));
    if (!enquiry) throw httpError(404, 'Enquiry not found');
    const previous = enquiry.status;
    Object.assign(enquiry, changes);
    delete enquiry.reason;
    if (changes.status && changes.status !== previous)
      enquiry.history.push({
        type: 'status',
        message: `Status changed from ${previous} to ${changes.status}${changes.reason ? `: ${changes.reason}` : ''}`,
        actor: q.user.id,
      });
    else enquiry.history.push({ type: 'updated', message: 'Enquiry details updated', actor: q.user.id });
    await enquiry.save();
    await audit(Audit, q.user.id, 'UPDATE', 'Enquiry', enquiry.id, {
      status: changes.status,
      reason: changes.reason,
    });
    s.json(enquiry);
  } catch (e) {
    n(e);
  }
});
router.post('/enquiries/:id/notes', permit('enquiries'), async (q, s, n) => {
  try {
    const { note } = z.object({ note: z.string().min(1).max(3000) }).parse(q.body);
    const enquiry = await Enquiry.findOneAndUpdate(
      tenantFilter(q, { _id: q.params.id }),
      { $push: { history: { type: 'note', message: note, actor: q.user.id, at: new Date() } } },
      { new: true }
    );
    if (!enquiry) throw httpError(404, 'Enquiry not found');
    s.status(201).json(enquiry.history.at(-1));
  } catch (e) {
    n(e);
  }
});

export default router;
