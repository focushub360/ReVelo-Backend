import mongoose from 'mongoose';
import { stamped, activitySchema } from './activity.js';
export const AcquisitionOffer = mongoose.model(
  'AcquisitionOffer',
  new mongoose.Schema(
    {
      acquisition: { type: mongoose.Schema.Types.ObjectId, ref: 'Acquisition', required: true, index: true },
      amount: { type: Number, required: true, min: 0 },
      status: {
        type: String,
        enum: ['Draft', 'Sent', 'Accepted', 'Rejected', 'Withdrawn', 'Expired'],
        default: 'Draft',
      },
      expiresAt: Date,
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      sellerResponseAt: Date,
      responseNote: String,
      previousOffer: { type: mongoose.Schema.Types.ObjectId, ref: 'AcquisitionOffer' },
      history: [activitySchema],
    },
    stamped
  )
);
