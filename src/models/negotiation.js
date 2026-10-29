import mongoose from 'mongoose';
import { stamped } from './activity.js';
const offer = new mongoose.Schema({ amount: { type: Number, required: true, min: 0 }, terms: String, kind: { type: String, enum: ['Offer', 'Counteroffer'], required: true }, actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, at: { type: Date, default: Date.now }, decision: { type: String, enum: ['Open', 'Accepted', 'Rejected', 'Withdrawn'], default: 'Open' } }, { _id: true });
const schema = new mongoose.Schema({
  dealership: { type: mongoose.Schema.Types.ObjectId, ref: 'Dealership', required: true, index: true },
  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true, index: true },
  buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true, index: true },
  enquiry: { type: mongoose.Schema.Types.ObjectId, ref: 'Enquiry', required: true, index: true },
  responsibleUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, sale: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale' },
  status: { type: String, enum: ['Open', 'Accepted', 'Rejected', 'Withdrawn', 'Closed'], default: 'Open', index: true },
  reason: String, offers: [offer],
}, stamped);
schema.index({ dealership: 1, enquiry: 1, status: 1 });
export const Negotiation = mongoose.model('Negotiation', schema);
