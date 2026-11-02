import mongoose from 'mongoose';
import { stamped } from './activity.js';
export const ParkingZone = mongoose.model(
  'ParkingZone',
  new mongoose.Schema(
    {
      dealership: { type: mongoose.Schema.Types.ObjectId, ref: 'Dealership', index: true },
      name: { type: String, required: true, unique: true },
      code: { type: String, required: true, unique: true },
      description: String,
      enabled: { type: Boolean, default: true },
    },
    stamped
  )
);
