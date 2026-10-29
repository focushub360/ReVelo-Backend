import mongoose from 'mongoose';
import { stamped } from './activity.js';
export const Dealership = mongoose.model('Dealership', new mongoose.Schema({
  name: { type: String, required: true, trim: true }, code: { type: String, required: true, uppercase: true, unique: true },
  contact: { name: String, email: String, phone: String }, address: { line1: String, city: String, state: String, postalCode: String, country: String },
  business: { legalName: String, taxId: String },
  subscription: { plan: { type: String, default: 'Starter' }, status: { type: String, enum: ['Trial', 'Active', 'Suspended', 'Deactivated'], default: 'Trial' }, maxUsers: { type: Number, default: 10 }, maxVehicles: { type: Number, default: 250 } },
  onboardingStatus: { type: String, enum: ['Draft', 'Invited', 'Active', 'Suspended'], default: 'Draft' }, active: { type: Boolean, default: true },
}, stamped));
