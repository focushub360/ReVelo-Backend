import { Router } from 'express';
import { z } from 'zod';
import { DealerApplication, Document, Enquiry, Person, Vehicle } from '../models/index.js';
import { storageProvider } from '../storage/privateStorage.js';
import { httpError, id } from '../utils/core.js';

const router = Router();
const listingFilter = {
  lifecycle: 'Ready for Sale',
  $or: [{ 'publicListing.status': 'Published' }, { publicListing: { $exists: false } }, { 'publicListing.status': { $exists: false } }],
};
const listingDto = async (vehicle) => {
  const image = await Document.findOne({ vehicle: vehicle._id, status: 'Verified', mimeType: { $in: ['image/jpeg', 'image/png'] } }).sort({ createdAt: 1 }).select('_id');
  return {
    id: String(vehicle._id), make: vehicle.make, model: vehicle.model, variant: vehicle.variant,
    year: vehicle.year, fuelType: vehicle.fuelType, transmission: vehicle.transmission, odometer: vehicle.odometer,
    price: vehicle.publicListing?.price, summary: vehicle.publicListing?.summary,
    imageUrl: image ? `/api/public/vehicles/${vehicle._id}/image/${image._id}` : null,
  };
};
router.get('/vehicles', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const filter = { ...listingFilter };
    if (q) filter.$and = [{ $or: ['make', 'model', 'variant', 'fuelType', 'transmission'].map((field) => ({ [field]: { $regex: q, $options: 'i' } })) }];
    const vehicles = await Vehicle.find(filter).sort({ 'publicListing.publishedAt': -1, updatedAt: -1 }).limit(60);
    res.json({ items: await Promise.all(vehicles.map(listingDto)) });
  } catch (error) { next(error); }
});
router.get('/vehicles/:id', async (req, res, next) => {
  try {
    const vehicle = await Vehicle.findOne({ ...listingFilter, _id: req.params.id });
    if (!vehicle) throw httpError(404, 'This vehicle is no longer publicly available');
    res.json({ vehicle: await listingDto(vehicle) });
  } catch (error) { next(error); }
});
router.get('/vehicles/:id/image/:documentId', async (req, res, next) => {
  try {
    const vehicle = await Vehicle.exists({ ...listingFilter, _id: req.params.id });
    if (!vehicle) throw httpError(404, 'Vehicle not found');
    const document = await Document.findOne({ _id: req.params.documentId, vehicle: req.params.id, status: 'Verified', mimeType: { $in: ['image/jpeg', 'image/png'] } });
    if (!document) throw httpError(404, 'Image not found');
    res.set({ 'Cache-Control': 'public, max-age=3600', 'Content-Disposition': 'inline' }).type(document.mimeType).send(await storageProvider.read(document.storageKey));
  } catch (error) { next(error); }
});
router.post('/buyer-enquiries', async (req, res, next) => {
  try {
    const body = z.object({ vehicleId: z.string(), name: z.string().min(2).max(100), phone: z.string().min(7).max(30), email: z.string().email().optional(), message: z.string().max(1500).optional() }).parse(req.body);
    const vehicle = await Vehicle.findOne({ ...listingFilter, _id: body.vehicleId });
    if (!vehicle) throw httpError(404, 'This vehicle is no longer publicly available');
    const person = await Person.create({ dealership: vehicle.dealership, kind: 'buyer', name: body.name, phone: body.phone, email: body.email });
    const enquiry = await Enquiry.create({ dealership: vehicle.dealership, enquiryCode: id('BUY'), type: 'buyer', vehicle: vehicle.id, person: person.id, source: 'Public marketplace', notes: body.message, history: [{ type: 'public-submission', message: 'Buyer submitted a marketplace enquiry' }] });
    res.status(201).json({ reference: enquiry.enquiryCode, message: 'Your enquiry has been sent to the vehicle team.' });
  } catch (error) { next(error); }
});
router.post('/dealer-applications', async (req, res, next) => {
  try {
    const body = z.object({ businessName: z.string().min(2).max(150), contactName: z.string().min(2).max(100), email: z.string().email(), phone: z.string().min(7).max(30), city: z.string().min(2).max(80), state: z.string().min(2).max(80), fleetSize: z.coerce.number().int().min(0).max(100000).optional(), message: z.string().max(2000).optional() }).parse(req.body);
    const application = await DealerApplication.create(body);
    res.status(201).json({ reference: String(application._id), message: 'Your dealer application has been received for platform review.' });
  } catch (error) { next(error); }
});
export default router;
