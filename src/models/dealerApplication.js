import mongoose from 'mongoose';
import { stamped } from './activity.js';

export const DealerApplication = mongoose.model('DealerApplication', new mongoose.Schema({
  businessName: { type: String, required: true, trim: true },
  contactName: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  phone: { type: String, required: true, trim: true },
  city: { type: String, required: true, trim: true },
  state: { type: String, required: true, trim: true },
  fleetSize: Number,
  message: String,
  status: { type: String, enum: ['Submitted', 'In Review', 'Approved', 'Declined'], default: 'Submitted', index: true },
}, stamped));
