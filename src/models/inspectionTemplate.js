import mongoose from 'mongoose';
import { stamped } from './activity.js';
const { Schema } = mongoose;
const questionSchema = new Schema(
  {
    questionId: { type: String, required: true },
    category: { type: String, required: true },
    title: { type: String, required: true },
    required: { type: Boolean, default: true },
    guidance: String,
  },
  { _id: false }
);
export const InspectionTemplate = mongoose.model(
  'InspectionTemplate',
  new Schema(
    {
      name: { type: String, required: true },
      kind: { type: String, enum: ['mechanical', 'structural'], required: true },
      enabled: { type: Boolean, default: true },
      questions: [questionSchema],
    },
    stamped
  )
);
