import mongoose from 'mongoose';
import { stamped } from './activity.js';
export const OwnershipPeriod = mongoose.model(
  'OwnershipPeriod',
  new mongoose.Schema(
    {
      vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true, index: true },
      owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true },
      startDate: Date,
      endDate: Date,
      source: { type: String, default: 'Seller declared' },
      verified: { type: Boolean, default: false },
      notes: String,
    },
    stamped
  )
);
