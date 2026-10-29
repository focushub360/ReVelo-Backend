import mongoose from 'mongoose';
import { stamped, activitySchema } from './activity.js';
export const QualityCheck = mongoose.model(
  'QualityCheck',
  new mongoose.Schema(
    {
      dealership: { type: mongoose.Schema.Types.ObjectId, ref: 'Dealership', index: true },
      vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true, index: true },
      assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      status: {
        type: String,
        enum: ['Assigned', 'In Progress', 'Pass', 'Fail', 'Rework Required', 'Reinspection'],
        default: 'Assigned',
      },
      checks: [
        {
          title: String,
          required: { type: Boolean, default: true },
          passed: Boolean,
          notes: String,
          evidence: [String],
        },
      ],
      criticalFaultsResolved: { type: Boolean, default: false },
      workOrdersClosed: { type: Boolean, default: false },
      safetyChecksPassed: { type: Boolean, default: false },
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      reviewedAt: Date,
      history: [activitySchema],
    },
    stamped
  )
);
