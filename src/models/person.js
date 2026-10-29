import mongoose from 'mongoose';
import { stamped } from './activity.js';
export const Person = mongoose.model(
  'Person',
  new mongoose.Schema(
    {
      dealership: { type: mongoose.Schema.Types.ObjectId, ref: 'Dealership', index: true },
      name: { type: String, required: true },
      phone: String,
      email: String,
      kind: { type: String, enum: ['seller', 'buyer'], required: true },
      maskedIdentity: String,
    },
    stamped
  )
);
