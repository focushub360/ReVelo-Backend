import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { Vehicle, Person, OwnershipPeriod, Enquiry, Audit, DocumentRequirement, VerificationRequest, Document } from '../models/index.js';
import { permit } from '../middleware/permit.js';
import { tenantFilter } from '../middleware/tenant.js';
import { id, token, audit, httpError } from '../utils/core.js';
import { paginatedQuery } from '../utils/pagination.js';
import { sendVerificationRequest } from '../services/emailService.js';

const router = Router();
const page = paginatedQuery;
const standardVerificationRequirements = [
  { category: 'Seller photograph', description: 'A recent clear photograph of the seller submitting this vehicle.', required: true },
  { category: 'Aadhaar card', description: 'Aadhaar card of the registered seller, uploaded only through this secure verification link.', required: true },
  { category: 'RC book / vehicle registration proof', description: 'Clear photo or scan of the original RC book / smart card. The team will match registration, chassis, engine, owner, year, fuel type, and hypothecation details.', required: true },
  { category: 'Insurance', description: 'Current insurance policy showing policy number, vehicle details, and expiry date.', requiresExpiry: true, required: true },
  { category: 'PUC certificate', description: 'Current Pollution Under Control certificate, where applicable.', requiresExpiry: true, required: true },
  { category: 'Loan closure / hypothecation release', description: 'Only if the vehicle has a loan or hypothecation: financier NOC, loan-closure letter, and Form 35 where available.', required: false },
  { category: 'Service and vehicle history', description: 'Available service records, repair invoices, accident records, and supporting odometer history.', required: false },
  { category: 'Road tax / challan clearance evidence', description: 'Only if available: road-tax receipt or challan-clearance evidence. The dealer will independently verify challans and vehicle status.', required: false },
  { category: 'Inter-state RTO NOC', description: 'Only if the vehicle is registered in another state: RTO NOC or the applicable interstate-transfer documents.', required: false },
];

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
    const [ownership, related, verification, documents] = await Promise.all([
      OwnershipPeriod.find({ vehicle: enquiry.vehicle.id }).populate('owner'),
      Enquiry.find(tenantFilter(q, { vehicle: enquiry.vehicle.id })).populate('person assignedTo').sort({ createdAt: -1 }),
      VerificationRequest.findOne({ dealership: enquiry.dealership, enquiry: enquiry.id }).sort({ requestedAt: -1 }).select('status requestedAt emailSentAt declaration'),
      Document.find({ dealership: enquiry.dealership, enquiry: enquiry.id }).select('category originalName status submittedAt expiryDate reviewReason').sort({ createdAt: -1 }).lean(),
    ]);
    s.json({ enquiry, ownership, related, verification, documents });
  } catch (e) {
    n(e);
  }
});
router.post('/enquiries/:id/request-verification', permit('enquiries'), async (q, s, n) => {
  try {
    const body = z.object({ message: z.string().trim().max(1000).optional() }).parse(q.body);
    const enquiry = await Enquiry.findOne(tenantFilter(q, { _id: q.params.id, type: 'seller' })).populate('person vehicle');
    if (!enquiry) throw httpError(404, 'Seller enquiry not found');
    if (!enquiry.person?.email) throw httpError(400, 'The customer did not provide an email address');
    const requirements = await DocumentRequirement.find(tenantFilter(q, { enabled: true })).sort({ name: 1 }).lean();
    // Every public seller receives the core legal checklist. Tenant-defined
    // requirements are retained as additional dealership-specific requests.
    const configuredRequirements = requirements.map((item) => ({
      category: item.category,
      description: item.description,
      requiresExpiry: item.requiresExpiry,
      required: item.requiredForAcquisition !== false,
    }));
    const standardCategories = new Set([
      ...standardVerificationRequirements.map((item) => item.category.toLowerCase()),
      'registration certificate',
      'rc book',
    ]);
    const requestRequirements = [
      ...standardVerificationRequirements,
      ...configuredRequirements.filter((item) => !standardCategories.has(item.category.toLowerCase())),
    ];
    const raw = token();
    await VerificationRequest.deleteMany({ enquiry: enquiry.id, status: 'Requested' });
    const request = await VerificationRequest.create({ dealership: q.tenantId, enquiry: enquiry.id, person: enquiry.person.id, vehicle: enquiry.vehicle.id, tokenHash: crypto.createHash('sha256').update(raw).digest('hex'), expiresAt: new Date(Date.now() + 7 * 24 * 3600e3), requirements: requestRequirements, requestedBy: q.user.id });
    let delivery;
    try { delivery = await sendVerificationRequest({ email: enquiry.person.email, name: enquiry.person.name, dealershipName: q.user.dealership ? 'your ReVelo location' : 'ReVelo', token: raw, message: body.message }); }
    catch (error) { await request.deleteOne(); throw httpError(502, 'The verification email could not be delivered. Check SMTP settings and try again.'); }
    if (delivery.status !== 'sent') { await request.deleteOne(); throw httpError(503, 'SMTP email delivery is not configured'); }
    request.emailSentAt = new Date(); await request.save();
    enquiry.status = 'Contacted'; enquiry.publicSubmission.proofStatus = 'Requested'; enquiry.history.push({ type: 'proof-requested', message: 'Secure verification link emailed to customer', actor: q.user.id }); await enquiry.save();
    await audit(Audit, q.user.id, 'REQUEST_VERIFICATION', 'Enquiry', enquiry.id, { request: request.id, recipient: enquiry.person.email }, { dealership: q.tenantId, actorName: q.user.name, role: q.user.role, requestId: q.requestId });
    s.status(201).json({ expiresAt: request.expiresAt, delivery: 'sent' });
  } catch (error) { n(error); }
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
