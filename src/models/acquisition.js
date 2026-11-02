import mongoose from 'mongoose';
import { stamped, activitySchema } from './activity.js';
const snapshotSchema = new mongoose.Schema(
  {
    expectedPurchasePrice: Number,
    estimatedRepairs: Number,
    transactionCosts: Number,
    holdingCosts: Number,
    expectedResale: Number,
    estimatedTotalCost: Number,
    projectedProfit: Number,
    criticalFaultCount: Number,
    documentEligible: Boolean,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reason: String,
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);
export const Acquisition = mongoose.model(
  'Acquisition',
  new mongoose.Schema(
    {
      dealership: { type: mongoose.Schema.Types.ObjectId, ref: 'Dealership', index: true },
      vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true, unique: true },
      enquiry: { type: mongoose.Schema.Types.ObjectId, ref: 'Enquiry' },
      proposedPrice: Number,
      refurbishmentEstimate: { type: Number, default: 0 },
      transactionCosts: { type: Number, default: 0 },
      holdingCosts: { type: Number, default: 0 },
      expectedResale: Number,
      // Pricing is deliberately finalised after refurbishment and final QA.  The
      // legacy expectedResale field remains for older valuations, but is no
      // longer used as the operational selling price.
      pricing: {
        targetMargin: { type: Number, default: 0 },
        marketAdjustment: { type: Number, default: 0 },
        finalListingPrice: Number,
        minimumNegotiablePrice: Number,
        finalisedAt: Date,
        finalisedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      },
      status: {
        type: String,
        enum: [
          'Draft',
          'Valuation Requested',
          'Approved for Negotiation',
          'On Hold',
          'Rejected',
          'Reinspection Requested',
          'Revised Valuation Requested',
          'Offer Accepted',
          'Purchase Pending',
          'Purchased',
        ],
        default: 'Draft',
        index: true,
      },
      decisionReason: String,
      financeClearanceRequired: { type: Boolean, default: false },
      financeClearanceConfirmed: { type: Boolean, default: false },
      purchaseAgreementConfirmed: { type: Boolean, default: false },
      agreedPrice: Number,
      purchaseDate: Date,
      purchaseReference: { type: String, unique: true, sparse: true },
      handover: {
        completed: Boolean,
        notes: String,
        at: Date,
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      },
      payments: [
        {
          amount: Number,
          reference: String,
          method: { type: String, enum: ['Cash', 'Online Transfer', 'Bank Transfer'] },
          proofReference: String,
          proof: {
            storageKey: String,
            originalName: String,
            mimeType: String,
            size: Number,
          },
          status: { type: String, default: 'Recorded' },
          at: { type: Date, default: Date.now },
          by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        },
      ],
      sellerMeetings: [{
        kind: { type: String, enum: ['Price Discussion', 'Document Collection', 'Purchase Discussion'], required: true },
        scheduledAt: { type: Date, required: true },
        location: String,
        agenda: String,
        status: { type: String, enum: ['Scheduled', 'Completed', 'Cancelled'], default: 'Scheduled' },
        outcome: String,
        completedAt: Date,
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      }],
      // Closed means the purchase was completed. Accepted is deliberately separate:
      // the seller has agreed, but payment and purchase checks are still pending.
      sellerOutcome: { type: String, enum: ['Open', 'Accepted', 'Closed', 'Declined'], default: 'Open' },
      valuationSnapshots: [snapshotSchema],
      history: [activitySchema],
    },
    stamped
  )
);
