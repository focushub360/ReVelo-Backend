import { Router } from 'express';
import { Dealership, Vehicle, Acquisition } from '../models/index.js';
import { readPrivateDocument } from '../storage/privateStorage.js';
import { escapeSearchTerm, toPublicVehicle } from '../services/publicCatalogService.js';

const router = Router();
const defaultPageSize = 12;
const maximumPageSize = 48;

router.get('/public/vehicles', async (req, res, next) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(Number.parseInt(req.query.limit, 10) || defaultPageSize, 1),
      maximumPageSize
    );
    const filter = { lifecycle: 'Ready for Sale' };
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    if (search) {
      const matcher = new RegExp(escapeSearchTerm(search), 'i');
      filter.$or = ['make', 'model', 'variant', 'fuelType', 'transmission'].map((field) => ({
        [field]: matcher,
      }));
    }
    const yearMin = Number.parseInt(req.query.yearMin, 10);
    const yearMax = Number.parseInt(req.query.yearMax, 10);
    if (Number.isFinite(yearMin) || Number.isFinite(yearMax)) {
      filter.year = {};
      if (Number.isFinite(yearMin)) filter.year.$gte = yearMin;
      if (Number.isFinite(yearMax)) filter.year.$lte = yearMax;
    }
    for (const field of ['fuelType', 'transmission']) {
      if (typeof req.query[field] === 'string' && req.query[field].trim()) {
        filter[field] = new RegExp(`^${escapeSearchTerm(req.query[field].trim())}$`, 'i');
      }
    }

    const activeDealerships = await Dealership.find({
      active: true,
      'subscription.status': 'Active',
    })
      .select('_id')
      .lean();
    const dealershipIds = activeDealerships.map((dealership) => dealership._id);
    filter.dealership = { $in: dealershipIds };

    const [vehicles, total] = await Promise.all([
      Vehicle.find(filter)
        .select('make model variant year fuelType transmission odometer images dealership updatedAt')
        .populate('dealership', 'name address.city address.state')
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Vehicle.countDocuments(filter),
    ]);

    const prices = await Acquisition.find({
      dealership: { $in: dealershipIds },
      vehicle: { $in: vehicles.map((vehicle) => vehicle._id) },
      status: 'Purchased',
    })
      .select('vehicle expectedResale')
      .lean();
    const priceByVehicle = new Map(prices.map((acquisition) => [String(acquisition.vehicle), acquisition.expectedResale]));

    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300').json({
      items: vehicles.map((vehicle) =>
        toPublicVehicle(vehicle, priceByVehicle.get(String(vehicle._id)))
      ),
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    next(error);
  }
});

// This DTO deliberately exposes only sale-ready vehicle fields.  It must never
// be replaced with a Vehicle document response: vehicles hold internal work,
// acquisition and private document information.
router.get('/public/vehicles/:vehicleId', async (req, res, next) => {
  try {
    const vehicle = await Vehicle.findOne({ _id: req.params.vehicleId, lifecycle: 'Ready for Sale' })
      .select('make model variant year fuelType transmission odometer images dealership')
      .populate({ path: 'dealership', match: { active: true, 'subscription.status': 'Active' }, select: 'name address.city address.state' })
      .lean();
    if (!vehicle?.dealership) return res.status(404).json({ error: { message: 'Vehicle listing not found' } });
    const purchase = await Acquisition.findOne({ dealership: vehicle.dealership._id, vehicle: vehicle._id, status: 'Purchased' })
      .select('expectedResale').lean();
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300').json(toPublicVehicle(vehicle, purchase?.expectedResale));
  } catch (error) { next(error); }
});

router.get('/public/vehicles/:vehicleId/images/:imageId', async (req, res, next) => {
  try {
    const vehicle = await Vehicle.findOne({
      _id: req.params.vehicleId,
      lifecycle: 'Ready for Sale',
    })
      .select('images dealership')
      .populate({
        path: 'dealership',
        match: { active: true, 'subscription.status': 'Active' },
        select: '_id',
      });
    const image = vehicle?.dealership && vehicle.images.id(req.params.imageId);
    if (!image) {
      return res.status(404).json({ error: { message: 'Vehicle image not found' } });
    }

    res
      .set({
        'Cache-Control': 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      })
      .type(image.mimeType)
      .send(await readPrivateDocument(image.storageKey));
  } catch (error) {
    next(error);
  }
});

export default router;
