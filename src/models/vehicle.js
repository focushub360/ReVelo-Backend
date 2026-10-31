import mongoose from 'mongoose';
import { stamped, activitySchema } from './activity.js';
export const Vehicle = mongoose.model(
  'Vehicle',
  new mongoose.Schema(
    {
      dealership: { type: mongoose.Schema.Types.ObjectId, ref: 'Dealership', index: true },
      vehicleCode: { type: String, unique: true },
      registration: { type: String, index: true },
      vin: { type: String, index: true },
      chassis: String,
      engine: String,
      make: String,
      model: String,
      variant: String,
      year: Number,
      fuelType: String,
      transmission: String,
      odometer: Number,
      lifecycle: { type: String, default: 'Enquiry Created', index: true },
      currentLocation: { type: mongoose.Schema.Types.ObjectId, ref: 'ParkingSlot' },
      images: [
        {
          storageKey: { type: String, required: true },
          originalName: { type: String, required: true },
          mimeType: { type: String, required: true },
          size: { type: Number, required: true },
          uploadedAt: { type: Date, default: Date.now },
        },
      ],
      activities: [activitySchema],
    },
    stamped
  )
);
