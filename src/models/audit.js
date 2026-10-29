import mongoose from 'mongoose';
import { stamped } from './activity.js';
export const Audit = mongoose.model(
  'Audit',
  new mongoose.Schema(
    {
      actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      action: String,
      entity: String,
      entityId: String,
      data: mongoose.Schema.Types.Mixed,
    },
    stamped
  )
);
