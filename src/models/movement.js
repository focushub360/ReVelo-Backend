import mongoose from 'mongoose';
import { stamped } from './activity.js';
export const Movement = mongoose.model(
  'Movement',
  new mongoose.Schema(
    {
      dealership: { type: mongoose.Schema.Types.ObjectId, ref: 'Dealership', index: true },
      vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true, index: true },
      from: { type: mongoose.Schema.Types.ObjectId, ref: 'ParkingSlot' },
      to: { type: mongoose.Schema.Types.ObjectId, ref: 'ParkingSlot' },
      action: { type: String, required: true },
      reason: String,
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      physicalConfirmation: { type: Boolean, default: false },
    },
    stamped
  )
);
