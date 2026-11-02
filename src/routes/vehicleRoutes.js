import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  Vehicle, Enquiry, Document, Inspection, WorkOrder, Movement, Acquisition, Sale, Audit,
} from '../models/index.js';
import { permit } from '../middleware/permit.js';
import { tenantFilter } from '../middleware/tenant.js';
import { id, audit, httpError } from '../utils/core.js';
import { paginatedQuery } from '../utils/pagination.js';
import { detectImage, readPrivateDocument, savePrivateImage } from '../storage/privateStorage.js';

const router = Router();
const page = paginatedQuery;
const vehicleImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 20 },
}).array('images', 20);

router.get('/vehicles', permit('vehicles'), page(Vehicle));
const vehicleInput = z.object({
  registration: z.string().min(2).max(30),
  make: z.string().min(1).max(80),
  model: z.string().min(1).max(80),
  variant: z.string().max(80).optional(),
  year: z.coerce.number().int().min(1900).max(2100).optional(),
  vin: z.string().max(80).optional(),
  chassis: z.string().max(80).optional(),
  engine: z.string().max(80).optional(),
  fuelType: z.string().max(40).optional(),
  transmission: z.string().max(40).optional(),
  odometer: z.coerce.number().min(0).optional(),
});
const vehicleImages = async (files) =>
  Promise.all(
    files.map(async (file) => {
      const { mimeType, storageKey } = await savePrivateImage(file.buffer);
      return {
        storageKey,
        mimeType,
        originalName: file.originalname.replace(/[\\/]/g, '_').slice(0, 180),
        size: file.size,
      };
    })
  );
router.post('/vehicles', permit('vehicles:manage'), vehicleImageUpload, async (q, s, n) => {
  try {
    const input = vehicleInput.parse(q.body);
    for (const file of q.files || []) detectImage(file.buffer);
    const exists = await Vehicle.exists(tenantFilter(q, { registration: input.registration }));
    if (exists) throw httpError(409, 'A vehicle with this registration already exists in this dealership');
    const images = await vehicleImages(q.files || []);
    const vehicle = await Vehicle.create({
      ...input,
      images,
      dealership: q.tenantId,
      vehicleCode: id('VEH'),
      lifecycle: 'Vehicle Registered',
      activities: [{ type: 'created', message: 'Vehicle manually added', actor: q.user.id }],
    });
    await audit(Audit, q.user.id, 'CREATE', 'Vehicle', vehicle.id, { registration: vehicle.registration });
    s.status(201).json(vehicle);
  } catch (e) { n(e); }
});
router.post('/vehicles/:id/images', permit('vehicles:manage'), vehicleImageUpload, async (q, s, n) => {
  try {
    if (!q.files?.length) throw httpError(400, 'At least one vehicle image is required');
    for (const file of q.files) detectImage(file.buffer);
    const vehicle = await Vehicle.findOne(tenantFilter(q, { _id: q.params.id }));
    if (!vehicle) throw httpError(404, 'Vehicle not found');
    vehicle.images.push(...(await vehicleImages(q.files)));
    await vehicle.save();
    await audit(Audit, q.user.id, 'UPLOAD', 'Vehicle', vehicle.id, { imageCount: q.files.length });
    s.status(201).json(vehicle.images);
  } catch (e) { n(e); }
});
router.get('/vehicles/:id/images/:imageId', permit('vehicles'), async (q, s, n) => {
  try {
    const vehicle = await Vehicle.findOne(
      tenantFilter(q, { _id: q.params.id, 'images._id': q.params.imageId })
    );
    const image = vehicle?.images.id(q.params.imageId);
    if (!image) throw httpError(404, 'Vehicle image not found');
    await audit(Audit, q.user.id, 'READ_PRIVATE_VEHICLE_IMAGE', 'Vehicle', vehicle.id, {
      image: image.id,
    });
    s.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
      .type(image.mimeType)
      .send(await readPrivateDocument(image.storageKey));
  } catch (e) {
    n(e);
  }
});
router.get('/vehicles/:id', permit('vehicles'), async (q, s, n) => {
  try {
    const v = await Vehicle.findOne(tenantFilter(q, { _id: q.params.id })).populate('currentLocation');
    if (!v) throw httpError(404, 'Vehicle not found');
    const [enquiries, docs, inspections, orders, moves, acquisition, sales] = await Promise.all([
      Enquiry.find(tenantFilter(q, { vehicle: v.id })),
      Document.find(tenantFilter(q, { vehicle: v.id })),
      Inspection.find(tenantFilter(q, { vehicle: v.id })),
      WorkOrder.find(tenantFilter(q, { vehicle: v.id })),
      Movement.find(tenantFilter(q, { vehicle: v.id })).populate('from to'),
      Acquisition.findOne(tenantFilter(q, { vehicle: v.id })),
      Sale.find(tenantFilter(q, { vehicle: v.id })),
    ]);
    s.json({ vehicle: v, enquiries, docs, inspections, orders, moves, acquisition, sales });
  } catch (e) {
    n(e);
  }
});

export default router;
