import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { Acquisition } from '../models/acquisition.js';
import { AcquisitionOffer } from '../models/acquisitionOffer.js';
import { Enquiry } from '../models/enquiry.js';
import { Vehicle } from '../models/vehicle.js';
import { Document } from '../models/document.js';
import { Inspection } from '../models/inspection.js';
import { ParkingSlot } from '../models/parkingSlot.js';
import { VehicleIntake } from '../models/vehicleIntake.js';
import { permit } from '../middleware/permit.js';
import { id, httpError } from '../utils/core.js';
import { paginatedQuery } from '../utils/pagination.js';
import { documentEligibility } from '../services/lifecycleService.js';
import { tenantFilter } from '../middleware/tenant.js';
import { sendSellerMeetingScheduled } from '../services/emailService.js';
import { storageProvider } from '../storage/privateStorage.js';
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const money = z.coerce.number().min(0);
const input = z.object({
  vehicle: z.string(),
  enquiry: z.string().optional(),
  proposedPrice: money,
  refurbishmentEstimate: money.optional(),
  transactionCosts: money.optional(),
  holdingCosts: money.optional(),
  expectedResale: money,
  financeClearanceRequired: z.boolean().optional(),
});
async function eligibility(vehicle, req) {
  const [documents, inspections] = await Promise.all([
    documentEligibility(vehicle, req?.tenantId),
    Inspection.find(tenantFilter(req, { vehicle, status: 'Reviewed' })),
  ]);
  const criticalFaults = inspections.flatMap((i) => i.findings.filter((f) => f.severity === 'Critical'));
  return {
    documentEligible: documents.eligible,
    missingDocuments: documents.missing,
    criticalFaults,
    inspections,
  };
}
function snapshot(acquisition, check, user, reason) {
  const expectedPurchasePrice = acquisition.proposedPrice || 0,
    estimatedRepairs = acquisition.refurbishmentEstimate || 0,
    transactionCosts = acquisition.transactionCosts || 0,
    holdingCosts = acquisition.holdingCosts || 0,
    expectedResale = acquisition.expectedResale || 0,
    estimatedTotalCost = expectedPurchasePrice + estimatedRepairs + transactionCosts + holdingCosts;
  return {
    expectedPurchasePrice,
    estimatedRepairs,
    transactionCosts,
    holdingCosts,
    expectedResale,
    estimatedTotalCost,
    projectedProfit: expectedResale - estimatedTotalCost,
    criticalFaultCount: check.criticalFaults.length,
    documentEligible: check.documentEligible,
    createdBy: user,
    reason,
  };
}
router.get('/acquisitions', permit('acquisitions'), paginatedQuery(Acquisition));
router.get('/acquisition-offers', permit('acquisitions'), async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 100, 100);
    const filter = tenantFilter(req);
    const [items, total] = await Promise.all([
      AcquisitionOffer.find(filter)
        .populate({
          path: 'acquisition',
          select: 'vehicle status',
          populate: { path: 'vehicle', select: 'registration vehicleCode make model' },
        })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      AcquisitionOffer.countDocuments(filter),
    ]);
    res.json({ items, page, total, pages: Math.ceil(total / limit) });
  } catch (error) {
    next(error);
  }
});
router.get('/seller-discussions', permit('acquisitions'), async (req, res, next) => {
  try {
    // Correct legacy discussion records where "Closed" was used before a purchase.
    // A case is only closed after payment has recorded a completed purchase.
    await Acquisition.updateMany(tenantFilter(req, { sellerOutcome: 'Closed', status: { $ne: 'Purchased' } }), { $set: { sellerOutcome: 'Open' } });
    const submittedReports = await Inspection.find(tenantFilter(req, { kind: 'mechanical', status: 'Submitted' })).select('vehicle').lean();
    for (const report of submittedReports) {
      const exists = await Acquisition.exists(tenantFilter(req, { vehicle: report.vehicle }));
      if (exists) continue;
      const enquiry = await Enquiry.findOne(tenantFilter(req, { vehicle: report.vehicle, type: 'seller' })).sort({ createdAt: -1 });
      if (enquiry) await Acquisition.create({ dealership: req.tenantId, vehicle: report.vehicle, enquiry: enquiry.id, proposedPrice: 0, expectedResale: 0, status: 'Valuation Requested', history: [{ type: 'technical-report-backfilled', message: 'Manager purchase case created from submitted technical report', actor: req.user.id }] });
    }
    const cases = await Acquisition.find(tenantFilter(req))
      .populate('vehicle', 'registration make model')
      .populate({ path: 'enquiry', populate: { path: 'person', select: 'name phone email' } })
      .sort({ updatedAt: -1 }).lean();
    res.json(cases);
  } catch (error) { next(error); }
});
router.post('/acquisitions/:id/seller-meetings', permit('acquisitions'), async (req, res, next) => {
  try {
    const meeting = z.object({ kind: z.enum(['Price Discussion', 'Document Collection', 'Purchase Discussion']), scheduledAt: z.coerce.date(), location: z.string().max(160).optional(), agenda: z.string().min(3).max(2000) }).parse(req.body);
    if (meeting.scheduledAt <= new Date()) throw httpError(400, 'Choose a future date and time');
    const acquisition = await Acquisition.findOne(tenantFilter(req, { _id: req.params.id })).populate({ path: 'enquiry', populate: { path: 'person vehicle' } });
    if (!acquisition) throw httpError(404, 'Purchase decision not found');
    if (['Accepted', 'Closed', 'Declined'].includes(acquisition.sellerOutcome)) throw httpError(409, 'This seller case is already finalised and cannot be scheduled again');
    acquisition.sellerMeetings.push({ ...meeting, createdBy: req.user.id });
    acquisition.history.push({ type: 'seller-meeting-scheduled', message: `${meeting.kind} scheduled for ${meeting.scheduledAt.toLocaleString()}`, actor: req.user.id });
    await acquisition.save();
    const seller = acquisition.enquiry?.person; const registration = acquisition.enquiry?.vehicle?.registration;
    let emailDelivery = 'not_applicable'; if (seller?.email) { try { emailDelivery = (await sendSellerMeetingScheduled({ email: seller.email, name: seller.name, registration, ...meeting })).status; } catch { emailDelivery = 'failed'; } }
    res.status(201).json({ acquisition, emailDelivery });
  } catch (error) { next(error); }
});
router.patch('/acquisitions/:id/seller-meetings/:meetingId', permit('acquisitions'), async (req, res, next) => {
  try {
    const nextMeeting = z.object({ kind: z.enum(['Price Discussion', 'Document Collection', 'Purchase Discussion']), scheduledAt: z.coerce.date(), location: z.string().min(2).max(160), agenda: z.string().min(3).max(2000) });
    const input = z.object({ outcome: z.string().min(3).max(4000), sellerOutcome: z.enum(['Open', 'Accepted', 'Declined']).optional(), agreedPrice: money.optional(), nextMeeting: nextMeeting.optional() }).parse(req.body);
    if (input.nextMeeting && input.nextMeeting.scheduledAt <= new Date()) throw httpError(400, 'Choose a future date and time for the next seller meeting');
    const acquisition = await Acquisition.findOne(tenantFilter(req, { _id: req.params.id }));
    const meeting = acquisition?.sellerMeetings.id(req.params.meetingId);
    if (!meeting) throw httpError(404, 'Seller meeting not found');
    meeting.status = 'Completed'; meeting.outcome = input.outcome; meeting.completedAt = new Date();
    if (input.sellerOutcome === 'Accepted') {
      if (meeting.kind !== 'Purchase Discussion') throw httpError(400, 'The seller can only accept after the Purchase Discussion');
      if (!input.agreedPrice || input.agreedPrice <= 0) throw httpError(400, 'Enter the agreed purchase price before moving to Purchase Decisions');
      acquisition.sellerOutcome = 'Accepted';
      acquisition.status = 'Offer Accepted';
      acquisition.agreedPrice = input.agreedPrice;
    } else if (input.sellerOutcome) acquisition.sellerOutcome = input.sellerOutcome;
    if (input.nextMeeting) acquisition.sellerMeetings.push({ ...input.nextMeeting, createdBy: req.user.id });
    acquisition.history.push({ type: 'seller-meeting-completed', message: input.nextMeeting ? `${meeting.kind} recorded; ${input.nextMeeting.kind} scheduled` : `${meeting.kind} recorded`, actor: req.user.id });
    await acquisition.save(); res.json(acquisition);
  } catch (error) { next(error); }
});
router.post('/acquisitions', permit('acquisitions'), async (req, res, next) => {
  try {
    const data = input.parse(req.body);
    if (!(await Vehicle.exists(tenantFilter(req, { _id: data.vehicle })))) throw httpError(404, 'Vehicle not found');
    if (data.enquiry && !(await Enquiry.exists(tenantFilter(req, { _id: data.enquiry, vehicle: data.vehicle, type: 'seller' })))) throw httpError(400, 'Seller enquiry does not belong to this vehicle');
    const existing = await Acquisition.findOne(tenantFilter(req, { vehicle: data.vehicle }));
    if (existing) throw httpError(409, 'An acquisition already exists for this vehicle');
    const check = await eligibility(data.vehicle, req);
    const acquisition = await Acquisition.create({
      ...data, dealership: req.tenantId,
      status: 'Valuation Requested',
      valuationSnapshots: [snapshot(data, check, req.user.id, 'Initial valuation')],
      history: [{ type: 'created', message: 'Acquisition valuation created', actor: req.user.id }],
    });
    res.status(201).json({ acquisition, eligibility: check });
  } catch (error) {
    next(error);
  }
});
router.get('/acquisitions/:id', permit('acquisitions'), async (req, res, next) => {
  try {
    const acquisition = await Acquisition.findOne(tenantFilter(req, { _id: req.params.id }))
      .populate('vehicle')
      .populate({ path: 'enquiry', populate: { path: 'person vehicle' } });
    if (!acquisition) throw httpError(404, 'Acquisition not found');
    const [check, offers, documents, reports, intake] = await Promise.all([
      eligibility(acquisition.vehicle.id, req),
      AcquisitionOffer.find({ dealership: req.tenantId, acquisition: acquisition.id }).sort({ createdAt: -1 }),
      Document.find(tenantFilter(req, { vehicle: acquisition.vehicle.id })).select('category originalName status submittedAt reviewReason').sort({ submittedAt: -1 }).lean(),
      Inspection.find(tenantFilter(req, { vehicle: acquisition.vehicle.id, kind: { $in: ['mechanical', 'structural'] } })).select('kind status recommendation findings diagnostics submittedAt assignedBy').populate('assignedBy', 'name').sort({ submittedAt: -1 }).lean(),
      VehicleIntake.findOne(tenantFilter(req, { vehicle: acquisition.vehicle.id })).populate('advisor', 'name').populate('parkingSlot', 'code').sort({ createdAt: -1 }).lean(),
    ]);
    res.json({ acquisition, eligibility: check, offers, sellerDocuments: documents, technicalReports: reports, physicalIntake: intake });
  } catch (error) {
    next(error);
  }
});
router.delete('/acquisitions/:id', permit('acquisitions'), async (req, res, next) => {
  try {
    const acquisition = await Acquisition.findOne(tenantFilter(req, { _id: req.params.id }));
    if (!acquisition) throw httpError(404, 'Acquisition not found');
    if (['Offer Accepted', 'Purchase Pending', 'Purchased'].includes(acquisition.status))
      throw httpError(409, 'An accepted or completed purchase cannot be deleted');
    const hasOffers = await AcquisitionOffer.exists({
      dealership: req.tenantId,
      acquisition: acquisition.id,
    });
    if (hasOffers || acquisition.payments.length)
      throw httpError(409, 'An acquisition with offers or payments cannot be deleted');
    await acquisition.deleteOne();
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
router.post('/acquisitions/:id/valuation', permit('acquisitions'), async (req, res, next) => {
  try {
    const values = z
      .object({
        proposedPrice: money,
        refurbishmentEstimate: money,
        transactionCosts: money,
        holdingCosts: money,
        expectedResale: money,
        reason: z.string().min(3),
      })
      .parse(req.body);
    const acquisition = await Acquisition.findOne(tenantFilter(req, { _id: req.params.id }));
    if (!acquisition) throw httpError(404, 'Acquisition not found');
    if (!['Valuation Requested', 'On Hold', 'Reinspection Requested', 'Revised Valuation Requested', 'Approved for Negotiation'].includes(acquisition.status))
      throw httpError(409, 'Valuation cannot be edited after negotiation or purchase begins');
    if (await AcquisitionOffer.exists({ dealership: req.tenantId, acquisition: acquisition.id }))
      throw httpError(409, 'Valuation cannot be edited after an offer has been created');
    Object.assign(acquisition, values);
    if (acquisition.status !== 'Valuation Requested') acquisition.status = 'Revised Valuation Requested';
    const check = await eligibility(acquisition.vehicle, req);
    acquisition.valuationSnapshots.push(snapshot(acquisition, check, req.user.id, values.reason));
    acquisition.history.push({
      type: 'valuation',
      message: `Valuation snapshot recorded: ${values.reason}`,
      actor: req.user.id,
    });
    await acquisition.save();
    res.json({ acquisition, eligibility: check });
  } catch (error) {
    next(error);
  }
});
router.post('/acquisitions/:id/decision', permit('acquisitions'), async (req, res, next) => {
  try {
    const { action, reason } = z
      .object({
        action: z.enum(['approve', 'reject', 'hold', 'reinspection', 'revalue']),
        reason: z.string().min(3).max(2000),
      })
      .parse(req.body);
    const acquisition = await Acquisition.findOne(tenantFilter(req, { _id: req.params.id }));
    if (!acquisition) throw httpError(404, 'Acquisition not found');
    const map = {
      approve: 'Approved for Negotiation',
      reject: 'Rejected',
      hold: 'On Hold',
      reinspection: 'Reinspection Requested',
      revalue: 'Revised Valuation Requested',
    };
    acquisition.status = map[action];
    acquisition.decisionReason = reason;
    acquisition.history.push({ type: 'decision', message: `${map[action]}: ${reason}`, actor: req.user.id });
    await acquisition.save();
    if (action === 'reject')
      await Vehicle.findOneAndUpdate(tenantFilter(req, { _id: acquisition.vehicle }), { lifecycle: 'Acquisition Rejected' });
    res.json(acquisition);
  } catch (error) {
    next(error);
  }
});
router.post('/acquisitions/:id/offers', permit('acquisitions'), async (req, res, next) => {
  try {
    const { amount, expiresAt } = z
      .object({ amount: money, expiresAt: z.coerce.date().optional() })
      .parse(req.body);
    const acquisition = await Acquisition.findOne(tenantFilter(req, { _id: req.params.id }));
    if (!acquisition || acquisition.status !== 'Approved for Negotiation')
      throw httpError(400, 'Acquisition is not approved for negotiation');
    const previous = await AcquisitionOffer.findOne({
      dealership: req.tenantId, acquisition: acquisition.id,
      status: { $in: ['Draft', 'Sent'] },
    }).sort({ createdAt: -1 });
    if (previous) {
      previous.status = 'Withdrawn';
      await previous.save();
    }
    const offer = await AcquisitionOffer.create({
      dealership: req.tenantId,
      acquisition: acquisition.id,
      amount,
      expiresAt,
      status: 'Sent',
      createdBy: req.user.id,
      previousOffer: previous?.id,
      history: [{ type: 'sent', message: 'Offer sent to seller', actor: req.user.id }],
    });
    acquisition.history.push({ type: 'offer', message: `Offer created: ${amount}`, actor: req.user.id });
    await acquisition.save();
    res.status(201).json(offer);
  } catch (error) {
    next(error);
  }
});
router.post('/acquisition-offers/:id/respond', permit('acquisitions'), async (req, res, next) => {
  try {
    const { accepted, note } = z
      .object({ accepted: z.boolean(), note: z.string().max(2000).optional() })
      .parse(req.body);
    const offer = await AcquisitionOffer.findOne({ _id: req.params.id, dealership: req.tenantId });
    if (!offer || offer.status !== 'Sent') throw httpError(400, 'Offer cannot be responded to');
    offer.status = accepted ? 'Accepted' : 'Rejected';
    offer.sellerResponseAt = new Date();
    offer.responseNote = note;
    offer.history.push({
      type: 'response',
      message: accepted ? 'Seller accepted offer' : 'Seller rejected offer',
      actor: req.user.id,
    });
    await offer.save();
    const acquisition = await Acquisition.findOne(tenantFilter(req, { _id: offer.acquisition }));
    if (!acquisition) throw httpError(404, 'Offer not found');
    acquisition.status = accepted ? 'Offer Accepted' : 'Approved for Negotiation';
    if (accepted) acquisition.agreedPrice = offer.amount;
    acquisition.history.push({
      type: 'offer response',
      message: offer.history.at(-1).message,
      actor: req.user.id,
    });
    await acquisition.save();
    res.json({ offer, acquisition });
  } catch (error) {
    next(error);
  }
});
router.post('/acquisitions/:id/purchase', permit('acquisitions'), async (req, res, next) => {
  try {
    const body = z
      .object({
        paymentReference: z.string().min(2),
        paymentAmount: money,
        paymentMethod: z.enum(['Cash', 'Online Transfer', 'Bank Transfer']),
        paymentProofReference: z.string().max(200).optional(),
        paymentProof: z.object({ storageKey: z.string().min(4), originalName: z.string().min(1).max(180), mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']), size: z.number().int().positive().max(10 * 1024 * 1024) }),
        financeClearanceConfirmed: z.boolean().optional(),
        purchaseAgreementConfirmed: z.boolean(),
        idempotencyKey: z.string().min(8).max(100),
      })
      .parse(req.body);
    const acquisition = await Acquisition.findOne(tenantFilter(req, { _id: req.params.id }));
    if (!acquisition) throw httpError(404, 'Acquisition not found');
    if (acquisition.status === 'Purchased') {
      if (acquisition.purchaseReference === body.idempotencyKey) return res.json(acquisition);
      throw httpError(409, 'Purchase already completed');
    }
    if (acquisition.status !== 'Offer Accepted') throw httpError(400, 'Seller offer acceptance is required');
    const check = await eligibility(acquisition.vehicle, req);
    if (!check.documentEligible)
      throw httpError(400, `Required documents are incomplete: ${check.missingDocuments.join(', ')}`);
    if (acquisition.financeClearanceRequired) {
      const clearance = await Document.exists({
        ...tenantFilter(req), vehicle: acquisition.vehicle,
        status: 'Verified',
        category: /clearance|noc|hypothecation/i,
      });
      if (!body.financeClearanceConfirmed || !clearance)
        throw httpError(400, 'Verified finance-clearance evidence and confirmation are required');
    }
    if (!body.purchaseAgreementConfirmed) throw httpError(400, 'Purchase agreement confirmation is required');
    acquisition.financeClearanceConfirmed = !!body.financeClearanceConfirmed;
    acquisition.purchaseAgreementConfirmed = true;
    acquisition.status = 'Purchased';
    acquisition.sellerOutcome = 'Closed';
    acquisition.purchaseDate = new Date();
    acquisition.purchaseReference = body.idempotencyKey;
    acquisition.payments.push({
      amount: body.paymentAmount,
      reference: body.paymentReference,
      method: body.paymentMethod,
      proofReference: body.paymentProofReference,
      proof: body.paymentProof,
      by: req.user.id,
    });
    acquisition.history.push({ type: 'purchase', message: 'Purchase completed', actor: req.user.id });
    await acquisition.save();
    await Vehicle.findOneAndUpdate(tenantFilter(req, { _id: acquisition.vehicle }), { lifecycle: 'Purchased Inventory' });
    res.json(acquisition);
  } catch (error) {
    next(error);
  }
});
router.post('/acquisitions/:id/payment-proof', permit('acquisitions'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'Upload a payment receipt as a PDF, JPEG, or PNG file');
    const acquisition = await Acquisition.findOne(tenantFilter(req, { _id: req.params.id }));
    if (!acquisition || acquisition.status !== 'Offer Accepted') throw httpError(400, 'Payment proof can only be uploaded for an accepted seller offer');
    const saved = await storageProvider.save(req.file.buffer);
    res.status(201).json({ proof: { ...saved, originalName: req.file.originalname.replace(/[\\/]/g, '_').slice(0, 180), size: req.file.size } });
  } catch (error) { next(error); }
});
router.get('/acquisitions/:id/payment-proof', permit('acquisitions'), async (req, res, next) => {
  try {
    const acquisition = await Acquisition.findOne(tenantFilter(req, { _id: req.params.id })).select('payments');
    const proof = acquisition?.payments?.at(-1)?.proof;
    if (!proof?.storageKey) throw httpError(404, 'Payment proof is not available');
    const file = await storageProvider.read(proof.storageKey);
    res.type(proof.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${String(proof.originalName || 'payment-proof').replace(/[\r\n"]/g, '_')}"`);
    res.send(file);
  } catch (error) { next(error); }
});
router.post('/acquisitions/:id/handover', permit('acquisitions'), async (req, res, next) => {
  try {
    const { notes, releaseParking } = z
      .object({ notes: z.string().min(3), releaseParking: z.boolean().optional() })
      .parse(req.body);
    const acquisition = await Acquisition.findOne(tenantFilter(req, { _id: req.params.id }));
    if (!acquisition || acquisition.status !== 'Rejected')
      throw httpError(400, 'Only rejected acquisitions can be handed over');
    acquisition.handover = { completed: true, notes, at: new Date(), by: req.user.id };
    await acquisition.save();
    if (releaseParking) {
      const vehicle = await Vehicle.findOne(tenantFilter(req, { _id: acquisition.vehicle }));
      if (vehicle?.currentLocation) {
        await ParkingSlot.findOneAndUpdate(tenantFilter(req, { _id: vehicle.currentLocation }), {
          $set: { status: 'Available' },
          $unset: { activeVehicle: 1, occupiedAt: 1 },
        });
        await Vehicle.findOneAndUpdate(tenantFilter(req, { _id: vehicle.id }), { $unset: { currentLocation: 1 } });
      }
    }
    res.json(acquisition);
  } catch (error) {
    next(error);
  }
});
export default router;
