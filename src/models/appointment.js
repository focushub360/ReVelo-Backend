import mongoose from 'mongoose';
import { stamped } from './activity.js';
const schema = new mongoose.Schema({
  dealership: { type: mongoose.Schema.Types.ObjectId, ref: 'Dealership', required: true, index: true },
  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true, index: true },
  party: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', index: true }, assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  type: { type: String, enum: ['Inspection', 'Service', 'Viewing', 'Test Drive'], required: true },
  startsAt: { type: Date, required: true }, endsAt: { type: Date, required: true },
  status: { type: String, enum: ['Requested', 'Confirmed', 'Completed', 'Cancelled'], default: 'Requested', index: true }, notes: String, cancellationReason: String,
}, stamped);
schema.index({ dealership: 1, assignedTo: 1, startsAt: 1, endsAt: 1 });
export const Appointment = mongoose.model('Appointment', schema);
