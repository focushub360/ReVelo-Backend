import mongoose from 'mongoose';
import { stamped } from './activity.js';
export const Notification = mongoose.model(
  'Notification',
  new mongoose.Schema(
    {
      recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
      event: { type: String, required: true, index: true },
      title: String,
      body: String,
      link: String,
      entityType: String,
      entityId: String,
      read: { type: Boolean, default: false, index: true },
      readAt: Date,
    },
    stamped
  )
);
