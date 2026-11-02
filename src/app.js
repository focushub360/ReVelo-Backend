import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import crypto from 'crypto';
import { z } from 'zod';
import {
  User,
  Session,
  PasswordReset,
  Person,
  Vehicle,
  OwnershipPeriod,
  Enquiry,
  Document,
  DocumentRequirement,
  Inspection,
  ParkingSlot,
  Movement,
  Acquisition,
  WorkOrder,
  Sale,
  Notification,
  Audit,
  Dealership,
  ParkingZone,
  QualityCheck,
  AcquisitionOffer,
  Negotiation,
  Appointment,
  DealerApplication,
} from './models/index.js';
import { ROLES, OPERATIONAL_PROFILES, PARTY_TYPES } from './config/permissions.js';
import { authenticate, csrf, permit, tenantContext, tenantFilter } from './middleware/index.js';
import { id, token, audit, httpError } from './utils/core.js';
import { paginatedQuery } from './utils/pagination.js';
import { storageProvider } from './storage/privateStorage.js';
import healthRoutes from './routes/healthRoutes.js';
import publicSellerRoutes from './routes/publicSellerRoutes.js';
import storefrontRoutes from './routes/storefrontRoutes.js';
import authRoutes from './routes/authRoutes.js';
import publicLeadSettingsRoutes from './routes/publicLeadSettingsRoutes.js';
import dealerRoutes from './routes/dealerRoutes.js';
import activityRoutes from './routes/activityRoutes.js';
import userRoutes from './routes/userRoutes.js';
import vehicleRoutes from './routes/vehicleRoutes.js';
import enquiryRoutes from './routes/enquiryRoutes.js';
import documentRoutes from './routes/documentRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import inspectionRoutes from './routes/inspectionRoutes.js';
import parkingRoutes from './routes/parkingRoutes.js';
import acquisitionRoutes from './routes/acquisitionRoutes.js';
import refurbishmentRoutes from './routes/refurbishmentRoutes.js';
import resaleRoutes from './routes/resaleRoutes.js';
import reportingRoutes from './routes/reportingRoutes.js';
import lifecycleRoutes from './routes/lifecycleRoutes.js';
import portalRoutes from './routes/portalRoutes.js';
import profileRoutes from './routes/profileRoutes.js';
import publicRoutes from './routes/publicRoutes.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 5 } });
const app = express();
app.use((req, res, next) => {
  if (req.url === '/api/v1' || req.url.startsWith('/api/v1/')) req.url = `/api${req.url.slice(7)}` || '/api';
  next();
});
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(morgan(':method :url :status :response-time ms'));
app.use((req, res, next) => {
  req.requestId = id('REQ');
  res.set('x-request-id', req.requestId);
  next();
});

app.use('/api', healthRoutes);
// These routes intentionally run before session middleware and return only public DTOs.
app.use('/api', publicRoutes);
app.post(
  '/api/auth/login',
  rateLimit({ windowMs: 15 * 60e3, max: 8, standardHeaders: true }),
  async (req, res, next) => {
    try {
      const { email, password } = z
        .object({ email: z.string().email(), password: z.string().min(8) })
        .parse(req.body);
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash)))
        throw httpError(401, 'Invalid email or password');
      const t = token(),
        csrfToken = token();
      await Session.create({
        token: t,
        user: user._id,
        csrfToken,
        sessionVersion: user.sessionVersion,
        ipHash: crypto
          .createHash('sha256')
          .update(req.ip || '')
          .digest('hex'),
        userAgent: req.get('user-agent')?.slice(0, 256),
        expiresAt: new Date(Date.now() + 8 * 3600e3),
      });
      res.cookie('rv_session', t, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/api',
        maxAge: 8 * 3600e3,
      });
      user.lastLoginAt = new Date(); user.lastActiveAt = new Date(); await user.save();
      await audit(Audit, user.id, 'LOGIN', 'User', user.id, {}, { actorName: user.name, role: user.role, operationalProfile: user.operationalProfile, dealership: user.dealership, requestId: req.requestId });
      res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, operationalProfile: user.operationalProfile, partyType: user.partyType, dealership: user.dealership }, csrfToken });
    } catch (e) {
      next(e);
    }
  }
);
app.post('/api/auth/logout', authenticate, csrf, async (req, res, next) => {
  try {
    await Session.deleteOne({ _id: req.session.id });
    res.clearCookie('rv_session');
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
app.get('/api/auth/me', authenticate, (q, s) => s.json({ user: { id: q.user.id, name: q.user.name, email: q.user.email, phone: q.user.phone, photoUrl: q.user.photoUrl, role: q.user.role, operationalProfile: q.user.operationalProfile, partyType: q.user.partyType, dealership: q.user.dealership, active: q.user.active }, csrfToken: q.session.csrfToken }));
app.use('/api', (req, res, next) =>
  ['/auth/password-reset/request', '/auth/password-reset/confirm', '/auth/invitations/accept'].includes(req.path)
    ? next()
    : authenticate(req, res, (error) => (error ? next(error) : csrf(req, res, next)))
);
app.use('/api', tenantContext);
app.get('/api/dealers', permit('dealers:view'), async (q, s, n) => {
  try { s.json(await Dealership.find().sort({ createdAt: -1 }).lean()); } catch (e) { n(e); }
});
app.post('/api/dealers', permit('dealers:create'), async (q, s, n) => {
  try {
    const body = z.object({ name: z.string().min(2), code: z.string().min(2).max(20), contact: z.object({ name: z.string().min(2), email: z.string().email(), phone: z.string().min(5) }), address: z.object({ line1: z.string().min(2), city: z.string().min(2), state: z.string().optional(), postalCode: z.string().optional(), country: z.string().optional() }), subscription: z.object({ plan: z.string().min(2), maxUsers: z.coerce.number().int().min(1), maxVehicles: z.coerce.number().int().min(1) }), admin: z.object({ name: z.string().min(2), email: z.string().email(), phone: z.string().optional() }).optional() }).parse(q.body);
    const dealer = await Dealership.create({ ...body, code: body.code.toUpperCase(), onboardingStatus: 'Invited', subscription: { ...body.subscription, status: 'Active' } });
    let admin; let raw;
    if (body.admin) { raw = token(); admin = await User.create({ name: body.admin.name, email: body.admin.email.toLowerCase(), phone: body.admin.phone, role: 'Dealer Admin', dealership: dealer.id, passwordHash: await bcrypt.hash(token(), 12), inviteTokenHash: crypto.createHash('sha256').update(raw).digest('hex'), inviteExpiresAt: new Date(Date.now() + 72 * 3600e3), passwordChangeRequired: true }); }
    await audit(Audit, q.user.id, 'CREATE_DEALER', 'Dealership', dealer.id, { dealerAdmin: admin?.id }, { actorName: q.user.name, role: q.user.role, requestId: q.requestId });
    s.status(201).json({ dealer, dealerAdmin: admin ? { id: admin.id, email: admin.email } : undefined, invitationToken: process.env.NODE_ENV === 'development' ? raw : undefined });
  } catch (e) { n(e); }
});
app.patch('/api/dealers/:id', permit('dealers:update'), async (q, s, n) => {
  try {
    const body = z.object({
      name: z.string().min(2).max(100).optional(),
      code: z.string().min(2).max(20).optional(),
      contact: z.object({
        name: z.string().min(2).optional(),
        email: z.string().email().optional(),
        phone: z.string().min(5).optional(),
      }).partial().optional(),
      address: z.object({
        line1: z.string().min(2).optional(),
        city: z.string().min(2).optional(),
        state: z.string().optional(),
        postalCode: z.string().optional(),
        country: z.string().optional(),
      }).partial().optional(),
      subscription: z.object({
        plan: z.string().min(2).optional(),
        maxUsers: z.coerce.number().int().min(1).optional(),
        maxVehicles: z.coerce.number().int().min(1).optional(),
      }).partial().optional(),
    }).refine((value) => Object.keys(value).length > 0).parse(q.body);
    if (body.code) body.code = body.code.toUpperCase();
    const dealer = await Dealership.findByIdAndUpdate(q.params.id, { $set: body }, {
      new: true,
      runValidators: true,
    });
    if (!dealer) throw httpError(404, 'Dealership not found');
    await audit(Audit, q.user.id, 'UPDATE', 'Dealership', dealer.id, body, {
      actorName: q.user.name,
      role: q.user.role,
      requestId: q.requestId,
    });
    s.json(dealer);
  } catch (e) { n(e); }
});
app.delete('/api/dealers/:id', permit('dealers:update'), async (q, s, n) => {
  try {
    const dealer = await Dealership.findById(q.params.id);
    if (!dealer) throw httpError(404, 'Dealership not found');
    const linkedRecords = await Promise.all([
      User, Person, Vehicle, Enquiry, Document, Inspection, ParkingSlot, ParkingZone,
      Movement, Acquisition, AcquisitionOffer, WorkOrder, QualityCheck, Sale,
      Notification, Negotiation, Appointment,
    ].map((Model) => Model.exists({ dealership: dealer.id })));
    if (linkedRecords.some(Boolean)) {
      throw httpError(409, 'Cannot delete a dealership that has users or operational records. Deactivate it instead.');
    }
    await audit(Audit, q.user.id, 'DELETE', 'Dealership', dealer.id, { name: dealer.name }, {
      actorName: q.user.name,
      role: q.user.role,
      requestId: q.requestId,
    });
    await Dealership.deleteOne({ _id: dealer.id });
    s.status(204).end();
  } catch (e) { n(e); }
});
app.patch('/api/dealers/:id/status', permit('dealers:update'), async (q, s, n) => {
  try {
    const { active } = z.object({ active: z.boolean() }).parse(q.body);
    const d = await Dealership.findByIdAndUpdate(q.params.id, {
      active,
      'subscription.status': active ? 'Active' : 'Suspended',
      onboardingStatus: active ? 'Active' : 'Suspended',
    }, { new: true, runValidators: true });
    if (!d) throw httpError(404, 'Dealership not found');
    if (!active) {
      const users = await User.find({ dealership: d.id }).select('_id');
      await User.updateMany({ dealership: d.id, active: true }, { active: false, $inc: { sessionVersion: 1 } });
      await Session.deleteMany({ user: { $in: users.map((user) => user.id) } });
    }
    await audit(Audit, q.user.id, active ? 'ACTIVATE' : 'DEACTIVATE', 'Dealership', d.id, { active }, {
      actorName: q.user.name,
      role: q.user.role,
      requestId: q.requestId,
    });
    s.json(d);
  } catch (e) { n(e); }
});
app.get('/api/activity', permit('audit:view'), async (q, s, n) => { try { s.json(await Audit.find(tenantFilter(q)).sort({ createdAt: -1 }).limit(100).lean()); } catch (e) { n(e); } });
app.patch('/api/vehicles/:id/marketplace-listing', permit('sales'), async (q, s, n) => {
  try {
    const listing = z.object({
      status: z.enum(['Draft', 'Published', 'Paused', 'Reserved', 'Sold', 'Withdrawn']),
      price: z.coerce.number().min(0).optional(), title: z.string().max(160).optional(),
      description: z.string().max(5000).optional(),
      images: z.array(z.object({ url: z.string().url().max(500), alt: z.string().max(180).optional() })).max(20).optional(),
      highlights: z.array(z.string().max(240)).max(12).optional(),
    }).parse(q.body);
    const vehicle = await Vehicle.findOne(tenantFilter(q, { _id: q.params.id }));
    if (!vehicle) throw httpError(404, 'Vehicle not found');
    if (listing.status === 'Published') {
      if (vehicle.lifecycle !== 'Ready for Sale') throw httpError(409, 'Only ready-for-sale vehicles can be published');
      if (listing.price == null && vehicle.publicListing?.price == null) throw httpError(400, 'A display price is required before publication');
    }
    vehicle.publicListing = { ...(vehicle.publicListing?.toObject?.() || vehicle.publicListing || {}), ...listing, updatedBy: q.user.id, ...(listing.status === 'Published' ? { publishedAt: vehicle.publicListing?.publishedAt || new Date() } : {}) };
    await vehicle.save();
    await audit(Audit, q.user.id, 'MARKETPLACE_LISTING_UPDATE', 'Vehicle', vehicle.id, { status: listing.status }, { dealership: q.tenantId, actorName: q.user.name, role: q.user.role, requestId: q.requestId });
    s.json({ id: vehicle.id, publicListing: vehicle.publicListing });
  } catch (e) { n(e); }
});
app.use('/api', inspectionRoutes);
app.use('/api', parkingRoutes);
app.use('/api', acquisitionRoutes);
app.use('/api', refurbishmentRoutes);
app.use('/api', resaleRoutes);
app.use('/api', reportingRoutes);
app.use('/api', lifecycleRoutes);
app.use('/api', portalRoutes);
app.use('/api', profileRoutes);
app.use('/api', userRoutes);
app.use('/api', vehicleRoutes);
app.use('/api', enquiryRoutes);
app.use('/api', intakeRoutes);
app.use('/api', documentRoutes);
app.use('/api', dashboardRoutes);

app.use((error, req, res, next) => {
  const status =
    error.status ||
    error.statusCode ||
    (error.name === 'MulterError'
      ? 400
      : ['ZodError', 'CastError', 'ValidationError'].includes(error.name)
        ? 400
        : 500);
  console.error(JSON.stringify({ level: 'error', requestId: req.requestId, status, message: error.message }));
  res.status(status).json({
    error: {
      message: status === 500 ? 'Unexpected server error' : error.message || 'Request failed',
      requestId: req.requestId,
    },
  });
});

export default app;
