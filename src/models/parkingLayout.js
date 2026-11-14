import mongoose from 'mongoose';
import { stamped } from './activity.js';

const roadSchema = new mongoose.Schema({
  roadId: { type: String, required: true },
  points: { type: [[Number]], required: true },
  width: { type: Number, min: 10, max: 600, default: 100 },
  color: { type: String, default: '#334155', maxlength: 20 },
  label: { type: String, maxlength: 80 },
}, { _id: false });

// The layout stores only drawing geometry. ParkingSlot._id stays the permanent
// operational reference for bookings, vehicle movements, and audit history.
export const ParkingLayout = mongoose.model('ParkingLayout', new mongoose.Schema({
  dealership: { type: mongoose.Schema.Types.ObjectId, ref: 'Dealership', required: true, index: true },
  name: { type: String, default: 'Main Parking Lot', maxlength: 120 },
  canvas: { width: { type: Number, min: 600, max: 10000, default: 2000 }, height: { type: Number, min: 400, max: 10000, default: 1200 }, gridSize: { type: Number, min: 5, max: 200, default: 20 } },
  roads: { type: [roadSchema], default: [] },
  publishedAt: Date,
  publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, stamped));
ParkingLayout.schema.index({ dealership: 1, name: 1 }, { unique: true });
