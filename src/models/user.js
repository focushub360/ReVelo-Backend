import mongoose from 'mongoose';
import { stamped } from './activity.js';
export const User = mongoose.model(
  'User',
  new mongoose.Schema(
    {
      name: { type: String, required: true },
      email: { type: String, required: true, unique: true, lowercase: true },
      passwordHash: { type: String, required: true },
      role: { type: String, required: true },
      active: { type: Boolean, default: true },
      sessionVersion: { type: Number, default: 0 },
    },
    stamped
  )
);
