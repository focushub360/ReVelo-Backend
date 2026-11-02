import mongoose from 'mongoose';
import { stamped } from './activity.js';

const publicLocationSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 100 },
    dealership: { type: mongoose.Schema.Types.ObjectId, ref: 'Dealership', required: true },
    active: { type: Boolean, default: true },
  },
  { _id: true }
);
const publicFieldSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 80 },
    label: { type: String, required: true, trim: true, maxlength: 120 },
    type: { type: String, enum: ['text', 'email', 'tel', 'number', 'date', 'textarea', 'select', 'boolean'], required: true },
    required: { type: Boolean, default: false },
    options: { type: [String], default: [] },
    system: { type: Boolean, default: false },
  },
  { _id: true }
);

// A single platform-level configuration controls where public seller leads may be routed.
export const PublicLeadConfiguration = mongoose.model(
  'PublicLeadConfiguration',
  new mongoose.Schema(
    {
      key: { type: String, required: true, unique: true, default: 'seller-form' },
      locations: { type: [publicLocationSchema], default: [] },
      fields: { type: [publicFieldSchema], default: [] },
    },
    stamped
  )
);
