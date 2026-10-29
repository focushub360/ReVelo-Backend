import mongoose from 'mongoose';
import { stamped, activitySchema } from './activity.js';
const expenseSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Parts', 'Labour', 'Other'], required: true },
    description: String,
    amount: { type: Number, required: true, min: 0 },
    reference: String,
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);
export const WorkOrder = mongoose.model(
  'WorkOrder',
  new mongoose.Schema(
    {
      workOrderCode: { type: String, required: true, unique: true },
      vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true, index: true },
      acquisition: { type: mongoose.Schema.Types.ObjectId, ref: 'Acquisition' },
      inspection: { type: mongoose.Schema.Types.ObjectId, ref: 'Inspection' },
      fault: String,
      title: { type: String, required: true },
      description: String,
      priority: { type: String, enum: ['Low', 'Medium', 'High', 'Critical'], default: 'Medium' },
      assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      status: {
        type: String,
        enum: [
          'Open',
          'Assigned',
          'In Progress',
          'Waiting for Parts',
          'Completed',
          'Rework Required',
          'Cancelled',
        ],
        default: 'Open',
        index: true,
      },
      estimatedLabour: { type: Number, default: 0 },
      estimatedParts: { type: Number, default: 0 },
      actualLabour: { type: Number, default: 0 },
      actualParts: { type: Number, default: 0 },
      expenses: [expenseSchema],
      startedAt: Date,
      completedAt: Date,
      notes: String,
      evidence: [String],
      reinspectionRequired: { type: Boolean, default: false },
      scopeChanges: [
        {
          reason: String,
          description: String,
          authorisedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          at: { type: Date, default: Date.now },
        },
      ],
      history: [activitySchema],
    },
    stamped
  )
);
