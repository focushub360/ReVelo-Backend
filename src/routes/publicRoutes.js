import { Router } from 'express';
import { z } from 'zod';
import { Dealership, DealerApplication, Document, Enquiry, Person, Vehicle } from '../models/index.js';
import { httpError, id } from '../utils/core.js';
import { storageProvider } from '../storage/privateStorage.js';

const router = Router();
// Existing Ready for Sale inventory predates the explicit listing state. Treat only
// records with no stored listing state as legacy-public; as soon as a dealer manages
// a listing, its explicit state is authoritative and must be Published.
const listingFilter = {
  lifecycle: 'Ready for Sale',
  $or: [
    { 'publicListing.status': 'Published' },
    { publicListing: { $exists: false } },
  ],
};
const dto = async (vehicle) => {
  const explicitImages = vehicle.publicListing?.images || [];
  const verifiedImages = explicitImages.length ? [] : await Document.find({
    dealership: vehicle.dealership?._id || vehicle.dealership,
    vehicle: vehicle.id,
    status: 'Verified',
    mimeType: { $in: ['image/jpeg', 'image/png'] },
  }).select('_id originalName').sort({ createdAt: 1 }).limit(12).lean();
  return {
  id: vehicle.id, make: vehicle.make, model: vehicle.model, variant: vehicle.variant, year: vehicle.year,
  fuelType: vehicle.fuelType, transmission: vehicle.transmission, odometer: vehicle.odometer,
  price: vehicle.publicListing?.price, title: vehicle.publicListing?.title,
  description: vehicle.publicListing?.description,
  images: explicitImages.length ? explicitImages : verifiedImages.map((image) => ({ url: `/api/v1/public/vehicles/${vehicle.id}/images/${image._id}`, alt: image.originalName || `${vehicle.make || 'Vehicle'} photo` })),
  highlights: vehicle.publicListing?.highlights || [],
  dealer: vehicle.dealership ? { city: vehicle.dealership.address?.city, state: vehicle.dealership.address?.state, name: vehicle.dealership.name } : undefined,
  };
};

router.get('/public/dealers', async (req, res, next) => { try {
  const dealers = await Dealership.find({ active: true, onboardingStatus: 'Active' }).select('name code address.city address.state').sort({ name: 1 }).lean();
  res.json(dealers.map((d) => ({ code: d.code, name: d.name, city: d.address?.city, state: d.address?.state })));
} catch (e) { next(e); } });

router.get('/public/vehicles', async (req, res, next) => { try {
  const query = { ...listingFilter };
  const text = String(req.query.search || '').trim();
  if (text) query.$and = [{ $or: ['make', 'model', 'variant', 'publicListing.title'].map((field) => ({ [field]: { $regex: text, $options: 'i' } })) }];
  for (const field of ['make', 'model', 'fuelType', 'transmission']) if (req.query[field]) query[field] = req.query[field];
  if (req.query.yearMin || req.query.yearMax) query.year = { ...(req.query.yearMin ? { $gte: Number(req.query.yearMin) } : {}), ...(req.query.yearMax ? { $lte: Number(req.query.yearMax) } : {}) };
  if (req.query.minPrice || req.query.maxPrice) query['publicListing.price'] = { ...(req.query.minPrice ? { $gte: Number(req.query.minPrice) } : {}), ...(req.query.maxPrice ? { $lte: Number(req.query.maxPrice) } : {}) };
  const page = Math.max(1, Number(req.query.page) || 1), limit = Math.min(40, Math.max(1, Number(req.query.limit) || 12));
  const sort = req.query.sort === 'oldest' ? { 'publicListing.publishedAt': 1 } : req.query.sort === 'priceAsc' ? { 'publicListing.price': 1 } : req.query.sort === 'priceDesc' ? { 'publicListing.price': -1 } : { 'publicListing.publishedAt': -1 };
  const [items, total] = await Promise.all([Vehicle.find(query).populate('dealership', 'name address.city address.state').sort(sort).skip((page - 1) * limit).limit(limit), Vehicle.countDocuments(query)]);
  res.json({ items: await Promise.all(items.map(dto)), total, page, pages: Math.ceil(total / limit) });
} catch (e) { next(e); } });

router.get('/public/vehicles/:id', async (req, res, next) => { try {
  const vehicle = await Vehicle.findOne({ ...listingFilter, _id: req.params.id }).populate('dealership', 'name address.city address.state');
  if (!vehicle) throw httpError(404, 'Published listing not found');
  res.json(await dto(vehicle));
} catch (e) { next(e); } });

router.get('/public/vehicles/:vehicleId/images/:documentId', async (req, res, next) => { try {
  const vehicle = await Vehicle.findOne({ ...listingFilter, _id: req.params.vehicleId });
  if (!vehicle) throw httpError(404, 'Published listing not found');
  const image = await Document.findOne({ _id: req.params.documentId, dealership: vehicle.dealership, vehicle: vehicle.id, status: 'Verified', mimeType: { $in: ['image/jpeg', 'image/png'] } });
  if (!image) throw httpError(404, 'Published vehicle image not found');
  res.set('Cache-Control', 'public, max-age=3600').type(image.mimeType).send(await storageProvider.read(image.storageKey));
} catch (e) { next(e); } });

router.post('/public/seller-enquiries', async (req, res, next) => { try {
  const body = z.object({ dealershipCode: z.string().min(2).max(20), seller: z.object({ name: z.string().min(2), phone: z.string().min(5).max(30), email: z.string().email().optional(), preferredContact: z.enum(['Phone', 'Email', 'WhatsApp']).optional() }), vehicle: z.object({ registration: z.string().min(2).max(30), make: z.string().min(1).max(80), model: z.string().min(1).max(80), variant: z.string().max(80).optional(), year: z.coerce.number().int().min(1900).max(2100).optional(), fuelType: z.string().max(40).optional(), transmission: z.string().max(40).optional(), odometer: z.coerce.number().min(0).optional() }), condition: z.object({ accidentHistory: z.string().max(3000).optional(), serviceHistory: z.string().max(3000).optional(), initialCondition: z.string().max(3000).optional() }).optional(), consent: z.literal(true) }).parse(req.body);
  const dealer = await Dealership.findOne({ code: body.dealershipCode.toUpperCase(), active: true, onboardingStatus: 'Active' });
  if (!dealer) throw httpError(400, 'Select an active ReVelo dealership');
  const registration = body.vehicle.registration.replace(/\s|-/g, '').toUpperCase();
  let vehicle = await Vehicle.findOne({ dealership: dealer.id, registration });
  const possibleDuplicate = Boolean(vehicle);
  if (!vehicle) vehicle = await Vehicle.create({ ...body.vehicle, registration, dealership: dealer.id, vehicleCode: id('VEH'), lifecycle: 'Enquiry Created' });
  let person = await Person.findOne({ dealership: dealer.id, phone: body.seller.phone, kind: 'seller' });
  if (!person) person = await Person.create({ ...body.seller, dealership: dealer.id, kind: 'seller' });
  const enquiry = await Enquiry.create({ dealership: dealer.id, enquiryCode: id('ENQ'), type: 'seller', vehicle: vehicle.id, person: person.id, source: 'Public website', declaredAccidentHistory: body.condition?.accidentHistory, serviceHistory: body.condition?.serviceHistory, initialCondition: body.condition?.initialCondition, notes: `Consent recorded. Preferred contact: ${body.seller.preferredContact || 'Phone'}`, history: [{ type: 'created', message: possibleDuplicate ? 'Public seller enquiry linked to matching vehicle' : 'Public seller enquiry submitted' }] });
  res.status(201).json({ reference: enquiry.enquiryCode, possibleDuplicate });
} catch (e) { next(e); } });

router.post('/public/dealer-applications', async (req, res, next) => { try {
  const input = z.object({ legalName: z.string().min(2), contactName: z.string().min(2), email: z.string().email(), phone: z.string().min(5), address: z.object({ line1: z.string().min(2), city: z.string().min(2), state: z.string().optional() }), businessType: z.string().max(80).optional(), notes: z.string().max(3000).optional(), consent: z.literal(true) }).parse(req.body);
  const application = await DealerApplication.create(input);
  res.status(201).json({ reference: application.id, status: application.status });
} catch (e) { next(e); } });

export default router;
