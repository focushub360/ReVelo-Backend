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
      dealership: { type: mongoose.Schema.Types.ObjectId, ref: 'Dealership', index: true },
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
          'Estimate Submitted',
          'Estimate Revision Requested',
          'Manager Approved',
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
      technicianEstimate: {
        diagnosis: String,
        repairPlan: String,
        partsRequired: String,
        estimatedDays: Number,
        safetyNotes: String,
        submittedAt: Date,
        submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      },
      managerEstimateReview: {
        decision: { type: String, enum: ['Approved', 'Revision Requested', 'Cancelled'] },
        reason: String,
        reviewedAt: Date,
        reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      },
      technicianCompletion: {
        workCompleted: String,
        completionNotes: String,
        readyForManager: { type: Boolean, default: false },
        submittedAt: Date,
        submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      },
      managerHandover: {
        sellingSlot: { type: mongoose.Schema.Types.ObjectId, ref: 'ParkingSlot' },
        allocatedAt: Date,
        allocatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        qualityStatus: { type: String, enum: ['Pending', 'Passed'], default: 'Pending' },
        qualityCheckedAt: Date,
        qualityCheckedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      },
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
