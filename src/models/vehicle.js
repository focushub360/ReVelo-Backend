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
      // This is deliberately separate from lifecycle.  A ready vehicle is not public
      // until an authorised dealer explicitly publishes the limited public record.
      publicListing: {
        status: { type: String, enum: ['Draft', 'Published', 'Paused', 'Reserved', 'Sold', 'Withdrawn'], default: 'Draft', index: true },
        price: Number,
        title: String,
        description: String,
        images: [{ url: String, alt: String }],
        highlights: [String],
        publishedAt: Date,
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      },
      currentLocation: { type: mongoose.Schema.Types.ObjectId, ref: 'ParkingSlot' },
      activities: [activitySchema],
    },
    stamped
  )
);
