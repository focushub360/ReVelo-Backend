import mongoose from 'mongoose';
import { stamped } from './activity.js';

export const VerificationRequest = mongoose.model('VerificationRequest', new mongoose.Schema({
  dealership: { type: mongoose.Schema.Types.ObjectId, ref: 'Dealership', required: true, index: true },
  enquiry: { type: mongoose.Schema.Types.ObjectId, ref: 'Enquiry', required: true, index: true },
  person: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true },
  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true },
  tokenHash: { type: String, required: true, unique: true, index: true },
  expiresAt: { type: Date, required: true, index: true },
  status: { type: String, enum: ['Requested', 'Documents Submitted', 'Expired', 'Closed'], default: 'Requested', index: true },
  requirements: [{ category: String, description: String, requiresExpiry: Boolean, required: { type: Boolean, default: true } }],
  declaration: {
    hasLoan: Boolean,
    loanProvider: String,
    loanReference: String,
    outstandingAmount: Number,
    previousOwners: [{ name: String, phone: String, address: String }],
    submittedAt: Date,
  },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  requestedAt: { type: Date, default: Date.now },
  emailSentAt: Date,
}, stamped));
