import mongoose from 'mongoose';
import { stamped } from './activity.js';
const schema = new mongoose.Schema(
  {
    code: { type: String, unique: true, required: true },
    zone: { type: String, required: true, index: true },
    section: String,
    row: { type: String, required: true },
    number: Number,
    type: {
      type: String,
      enum: ['parking', 'inspection', 'road-test', 'workshop', 'delivery'],
      default: 'parking',
    },
    status: {
      type: String,
      enum: ['Available', 'Reserved', 'Occupied', 'Blocked', 'Maintenance'],
      default: 'Available',
      index: true,
    },
    capacity: { type: Number, default: 1, min: 1 },
    vehicleConstraints: [String],
    activeVehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' },
    reservationVehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' },
    reservedUntil: Date,
    occupiedAt: Date,
    enabled: { type: Boolean, default: true },
  },
  stamped
);
schema.index({ zone: 1, row: 1, number: 1 }, { unique: true });
export const ParkingSlot = mongoose.model('ParkingSlot', schema);
