import mongoose from 'mongoose';
import { stamped } from './activity.js';

export const DealerApplication = mongoose.model('DealerApplication', new mongoose.Schema({
  legalName: { type: String, required: true, trim: true },
  contactName: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  phone: { type: String, required: true, trim: true },
  address: { line1: String, city: String, state: String },
  businessType: String,
  notes: String,
  consent: { type: Boolean, required: true },
  status: { type: String, enum: ['Submitted', 'Under Review', 'Approved', 'Rejected'], default: 'Submitted', index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: Date,
  decisionNote: String,
}, stamped));
