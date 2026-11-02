import mongoose from 'mongoose';
import { stamped } from './activity.js';
const schema = new mongoose.Schema(
    {
      dealership: { type: mongoose.Schema.Types.ObjectId, ref: 'Dealership', required: true, index: true },
      name: { type: String, required: true },
      category: { type: String, required: true },
      description: String,
      requiredForAcquisition: { type: Boolean, default: true },
      requiresExpiry: { type: Boolean, default: false },
      enabled: { type: Boolean, default: true },
      applicableFuelTypes: [String],
      applicableTransactionTypes: [String],
    },
    stamped
);
schema.index({ dealership: 1, category: 1 }, { unique: true });
export const DocumentRequirement = mongoose.model('DocumentRequirement', schema);
