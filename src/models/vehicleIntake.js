import mongoose from 'mongoose';
import { stamped, activitySchema } from './activity.js';

export const VehicleIntake = mongoose.model('VehicleIntake', new mongoose.Schema({
  dealership: { type: mongoose.Schema.Types.ObjectId, ref: 'Dealership', required: true, index: true },
  enquiry: { type: mongoose.Schema.Types.ObjectId, ref: 'Enquiry', required: true, index: true },
  appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true },
  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', required: true, index: true },
  advisor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  parkingSlot: { type: mongoose.Schema.Types.ObjectId, ref: 'ParkingSlot', required: true },
  liveLocation: { latitude: Number, longitude: Number, accuracy: Number, capturedAt: Date },
  physicalChecks: { ownerIdentityMatched: Boolean, rcMatched: Boolean, chassisMatched: Boolean, engineMatched: Boolean, keysReceived: Boolean, odometerRecorded: Boolean, exteriorChecked: Boolean },
  odometer: Number,
  photos: [{
    category: { type: String, enum: ['number-plate', 'odometer', 'front-exterior', 'rear-exterior', 'left-side', 'right-side', 'interior', 'existing-damage', 'road-test'], required: true },
    storageKey: { type: String, required: true }, originalName: String, mimeType: String, size: Number, capturedAt: { type: Date, default: Date.now },
  }],
  roadTest: { completed: Boolean, durationMinutes: Number, startMileage: Number, endMileage: Number, observations: String },
  advisorNotes: String,
  status: { type: String, enum: ['In Progress', 'Completed', 'Handed to Technician', 'Rejected'], default: 'In Progress', index: true },
  rejectionReason: String,
  history: [activitySchema],
}, stamped));
