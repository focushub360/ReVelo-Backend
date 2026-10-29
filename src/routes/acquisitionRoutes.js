import { Router } from 'express';
import { z } from 'zod';
import { Acquisition } from '../models/acquisition.js';
import { AcquisitionOffer } from '../models/acquisitionOffer.js';
import { Enquiry } from '../models/enquiry.js';
import { Vehicle } from '../models/vehicle.js';
import { Document } from '../models/document.js';
import { Inspection } from '../models/inspection.js';
import { ParkingSlot } from '../models/parkingSlot.js';
import { permit } from '../middleware/permit.js';
import { id, httpError } from '../utils/core.js';
import { paginatedQuery } from '../utils/pagination.js';
import { documentEligibility } from '../services/lifecycleService.js';
const router = Router();
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
async function eligibility(vehicle) {
  const [documents, inspections] = await Promise.all([
    documentEligibility(vehicle),
    Inspection.find({ vehicle, status: 'Reviewed' }),
  ]);
  const criticalFaults = inspections.flatMap((i) => i.findings.filter((f) => f.result === 'Critical'));
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
router.post('/acquisitions', permit('acquisitions'), async (req, res, next) => {
  try {
    const data = input.parse(req.body);
    if (!(await Vehicle.exists({ _id: data.vehicle }))) throw httpError(404, 'Vehicle not found');
    const existing = await Acquisition.findOne({ vehicle: data.vehicle });
    if (existing) throw httpError(409, 'An acquisition already exists for this vehicle');
    const check = await eligibility(data.vehicle);
    const acquisition = await Acquisition.create({
      ...data,
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
    const acquisition = await Acquisition.findById(req.params.id).populate('vehicle enquiry');
    if (!acquisition) throw httpError(404, 'Acquisition not found');
    const [check, offers] = await Promise.all([
      eligibility(acquisition.vehicle.id),
      AcquisitionOffer.find({ acquisition: acquisition.id }).sort({ createdAt: -1 }),
    ]);
    res.json({ acquisition, eligibility: check, offers });
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
    const acquisition = await Acquisition.findById(req.params.id);
    if (!acquisition) throw httpError(404, 'Acquisition not found');
    Object.assign(acquisition, values);
    const check = await eligibility(acquisition.vehicle);
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
    const acquisition = await Acquisition.findById(req.params.id);
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
      await Vehicle.findByIdAndUpdate(acquisition.vehicle, { lifecycle: 'Acquisition Rejected' });
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
    const acquisition = await Acquisition.findById(req.params.id);
    if (!acquisition || acquisition.status !== 'Approved for Negotiation')
      throw httpError(400, 'Acquisition is not approved for negotiation');
    const previous = await AcquisitionOffer.findOne({
      acquisition: acquisition.id,
      status: { $in: ['Draft', 'Sent'] },
    }).sort({ createdAt: -1 });
    if (previous) {
      previous.status = 'Withdrawn';
      await previous.save();
    }
    const offer = await AcquisitionOffer.create({
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
    const offer = await AcquisitionOffer.findById(req.params.id);
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
    const acquisition = await Acquisition.findById(offer.acquisition);
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
        financeClearanceConfirmed: z.boolean().optional(),
        purchaseAgreementConfirmed: z.boolean(),
        idempotencyKey: z.string().min(8).max(100),
      })
      .parse(req.body);
    const acquisition = await Acquisition.findById(req.params.id);
    if (!acquisition) throw httpError(404, 'Acquisition not found');
    if (acquisition.status === 'Purchased') {
      if (acquisition.purchaseReference === body.idempotencyKey) return res.json(acquisition);
      throw httpError(409, 'Purchase already completed');
    }
    if (acquisition.status !== 'Offer Accepted') throw httpError(400, 'Seller offer acceptance is required');
    const check = await eligibility(acquisition.vehicle);
    if (!check.documentEligible)
      throw httpError(400, `Required documents are incomplete: ${check.missingDocuments.join(', ')}`);
    if (acquisition.financeClearanceRequired) {
      const clearance = await Document.exists({
        vehicle: acquisition.vehicle,
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
    acquisition.purchaseDate = new Date();
    acquisition.purchaseReference = body.idempotencyKey;
    acquisition.payments.push({
      amount: body.paymentAmount,
      reference: body.paymentReference,
      by: req.user.id,
    });
    acquisition.history.push({ type: 'purchase', message: 'Purchase completed', actor: req.user.id });
    await acquisition.save();
    await Vehicle.findByIdAndUpdate(acquisition.vehicle, { lifecycle: 'Purchased Inventory' });
    res.json(acquisition);
  } catch (error) {
    next(error);
  }
});
router.post('/acquisitions/:id/handover', permit('acquisitions'), async (req, res, next) => {
  try {
    const { notes, releaseParking } = z
      .object({ notes: z.string().min(3), releaseParking: z.boolean().optional() })
      .parse(req.body);
    const acquisition = await Acquisition.findById(req.params.id);
    if (!acquisition || acquisition.status !== 'Rejected')
      throw httpError(400, 'Only rejected acquisitions can be handed over');
    acquisition.handover = { completed: true, notes, at: new Date(), by: req.user.id };
    await acquisition.save();
    if (releaseParking) {
      const vehicle = await Vehicle.findById(acquisition.vehicle);
      if (vehicle?.currentLocation) {
        await ParkingSlot.findByIdAndUpdate(vehicle.currentLocation, {
          $set: { status: 'Available' },
          $unset: { activeVehicle: 1, occupiedAt: 1 },
        });
        await Vehicle.findByIdAndUpdate(vehicle.id, { $unset: { currentLocation: 1 } });
      }
    }
    res.json(acquisition);
  } catch (error) {
    next(error);
  }
});
export default router;
