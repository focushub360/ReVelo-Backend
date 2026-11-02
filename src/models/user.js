import mongoose from 'mongoose';
import { stamped } from './activity.js';
export const User = mongoose.model(
  'User',
  new mongoose.Schema(
    {
      name: { type: String, required: true },
      email: { type: String, required: true, unique: true, lowercase: true },
      passwordHash: { type: String, required: true },
      role: { type: String, required: true, enum: ['Super Admin', 'Dealer Admin', 'Technician & Service Advisor', 'Buyer & Seller'] },
      dealership: { type: mongoose.Schema.Types.ObjectId, ref: 'Dealership', index: true },
      operationalProfile: { type: String, enum: ['Service Advisor', 'Senior Technician / Vehicle Inspector', 'Parking Manager', 'Refurbishment Technician'] },
      partyType: { type: String, enum: ['Buyer', 'Seller', 'Buyer and Seller'] },
      party: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', index: true },
      phone: String, photoUrl: String, inviteTokenHash: String, inviteExpiresAt: Date,
      passwordChangeRequired: { type: Boolean, default: false }, lastLoginAt: Date, lastActiveAt: Date,
      active: { type: Boolean, default: true },
      sessionVersion: { type: Number, default: 0 },
    },
    stamped
  )
);
