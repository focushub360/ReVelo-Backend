import mongoose from 'mongoose';
import { stamped } from './activity.js';
export const Audit = mongoose.model(
  'Audit',
  new mongoose.Schema(
    {
      actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      actorName: String, role: String, operationalProfile: String,
      dealership: { type: mongoose.Schema.Types.ObjectId, ref: 'Dealership', index: true },
      action: String,
      entity: String,
      entityId: String,
      data: mongoose.Schema.Types.Mixed,
      requestId: String,
    },
    stamped
  )
);
