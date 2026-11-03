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
      publicListing: {
        status: { type: String, enum: ['Draft', 'Published', 'Paused', 'Reserved', 'Sold', 'Withdrawn'], default: 'Draft', index: true },
        price: Number,
        summary: { type: String, maxlength: 1200 },
        publishedAt: Date,
      },
      lifecycle: { type: String, default: 'Enquiry Created', index: true },
      currentLocation: { type: mongoose.Schema.Types.ObjectId, ref: 'ParkingSlot' },
      activities: [activitySchema],
    },
    stamped
  )
);
