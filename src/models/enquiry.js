import mongoose from 'mongoose';
import { stamped, activitySchema } from './activity.js';
export const Enquiry = mongoose.model(
  'Enquiry',
  new mongoose.Schema(
    {
      dealership: { type: mongoose.Schema.Types.ObjectId, ref: 'Dealership', index: true },
      enquiryCode: { type: String, unique: true },
      type: { type: String, enum: ['seller', 'buyer'], default: 'seller' },
      vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true },
      person: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true },
      status: { type: String, default: 'Open', index: true },
      source: String,
      receivedAt: { type: Date, default: Date.now },
      askingPrice: Number,
      offer: Number,
      declaredAccidentHistory: String,
      serviceHistory: String,
      initialCondition: String,
      photos: [String],
      assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
      followUp: Date,
      nextAction: String,
      notes: String,
      publicSubmission: {
        nearestLocation: { city: String, state: String },
        address: { line1: String, locality: String, city: String, state: String, postalCode: String },
        ownerCount: Number,
        isFirstOwner: Boolean,
        rcAvailable: Boolean,
        insuranceRenewalDate: Date,
        hasActiveLoan: Boolean,
        loanProvider: String,
        consentToContact: Boolean,
        customFields: [{ fieldId: String, label: String, value: mongoose.Schema.Types.Mixed }],
        proofStatus: {
          type: String,
          enum: ['Not Requested', 'Requested', 'Submitted', 'Verified', 'Mismatch', 'On Hold', 'Rejected'],
          default: 'Not Requested',
        },
      },
      history: [activitySchema],
    },
    stamped
  )
);
