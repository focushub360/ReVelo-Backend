import mongoose from 'mongoose';
import { stamped, activitySchema } from './activity.js';
const paymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    reference: String,
    confirmed: { type: Boolean, default: false },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);
export const Sale = mongoose.model(
  'Sale',
  new mongoose.Schema(
    {
      vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true, index: true },
      buyerEnquiry: { type: mongoose.Schema.Types.ObjectId, ref: 'Enquiry' },
      status: {
        type: String,
        enum: ['Draft', 'Offer Sent', 'Reserved', 'Sale Pending', 'Delivered', 'Closed', 'Cancelled'],
        default: 'Draft',
        index: true,
      },
      targetPrice: Number,
      agreedPrice: Number,
      reservedUntil: Date,
      offers: [
        {
          amount: Number,
          note: String,
          at: { type: Date, default: Date.now },
          by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        },
      ],
      payments: [paymentSchema],
      buyerDocumentsComplete: { type: Boolean, default: false },
      transferTasks: [{ title: String, completed: { type: Boolean, default: false }, completedAt: Date }],
      deliveryChecklist: [{ title: String, completed: { type: Boolean, default: false }, completedAt: Date }],
      deliveryConfirmed: { type: Boolean, default: false },
      handoverNote: String,
      actualProfit: Number,
      closedAt: Date,
      history: [activitySchema],
    },
    stamped
  )
);
