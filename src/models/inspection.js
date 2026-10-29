import mongoose from 'mongoose';
import { stamped, activitySchema } from './activity.js';
const { Schema } = mongoose;
const findingSchema = new Schema(
  {
    questionId: String,
    category: String,
    title: { type: String, required: true },
    required: { type: Boolean, default: false },
    result: {
      type: String,
      enum: ['Pass', 'Advisory', 'Fail', 'Critical', 'Not Inspected'],
      default: 'Not Inspected',
    },
    severity: { type: String, enum: ['Low', 'Medium', 'High', 'Critical'] },
    notes: String,
    photos: [String],
    recommendedAction: String,
    estimatedRepairCost: { type: Number, default: 0 },
  },
  { _id: true }
);
export const Inspection = mongoose.model(
  'Inspection',
  new Schema(
    {
      dealership: { type: Schema.Types.ObjectId, ref: 'Dealership', index: true },
      vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true, index: true },
      kind: { type: String, enum: ['mechanical', 'structural', 'quality'], required: true },
      template: { type: Schema.Types.ObjectId, ref: 'InspectionTemplate' },
      assignedTo: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      assignedAt: { type: Date, default: Date.now },
      dueDate: Date,
      status: {
        type: String,
        enum: ['Assigned', 'In Progress', 'Submitted', 'Reviewed', 'Reinspection Required'],
        default: 'Assigned',
        index: true,
      },
      startedAt: Date,
      submittedAt: Date,
      reviewedAt: Date,
      reviewer: { type: Schema.Types.ObjectId, ref: 'User' },
      reviewNote: String,
      revision: { type: Number, default: 1 },
      revisionReason: String,
      parentReport: { type: Schema.Types.ObjectId, ref: 'Inspection' },
      findings: [findingSchema],
      roadTest: {
        authorised: { type: Boolean, default: false },
        authorisedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        driver: String,
        startMileage: Number,
        endMileage: Number,
        observations: String,
      },
      diagnostics: { source: { type: String, default: 'Manual entry' }, faultCodes: [String], notes: String },
      history: [activitySchema],
    },
    stamped
  )
);
