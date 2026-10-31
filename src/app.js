import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
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
  PublicLeadConfiguration,
} from './models/index.js';
import { ROLES, OPERATIONAL_PROFILES, PARTY_TYPES } from './config/permissions.js';
import { authenticate, csrf, permit, tenantContext, tenantFilter, requireTenant } from './middleware/index.js';
import { id, token, audit, httpError } from './utils/core.js';
import { paginatedQuery } from './utils/pagination.js';
import { storageProvider } from './storage/privateStorage.js';
import healthRoutes from './routes/healthRoutes.js';
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
import { sendDealerInvitation } from './services/emailService.js';
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 5 } });
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
const publicLeadConfig = () => PublicLeadConfiguration.findOne({ key: 'seller-form' });
const DEFAULT_PUBLIC_FIELDS = [
  ['name', 'Full name', 'text', true, true], ['phone', 'Mobile number', 'tel', true, true], ['email', 'Email address', 'email'],
  ['line1', 'Address line', 'text', true, true], ['locality', 'Area / locality', 'text', true, true], ['city', 'City', 'text', true, true], ['state', 'State', 'text', true, true], ['postalCode', 'Pincode', 'text', true, true],
  ['registration', 'Car registration number', 'text', true, true], ['make', 'Make', 'text', true, true], ['model', 'Model', 'text', true, true], ['year', 'Year', 'number'], ['odometer', 'Approximate odometer (km)', 'number'],
  ['ownerCount', 'How many owners has the car had?', 'select', false, false, ['1', '2', '3', '4 or more']], ['isFirstOwner', 'Are you the first owner?', 'boolean'], ['rcAvailable', 'Is the RC book available?', 'boolean'], ['insuranceRenewalDate', 'Insurance renewal / expiry date', 'date'], ['previousAccidents', 'Previous accident or major repair history', 'textarea'], ['hasActiveLoan', 'Is there an active loan or hypothecation?', 'boolean'], ['loanProvider', 'Loan provider / bank', 'text'],
].map(([key, label, type, required = false, system = false, options = []]) => ({ key, label, type, required, system, options }));
const configuredPublicFields = (config) => config?.fields?.length ? config.fields : DEFAULT_PUBLIC_FIELDS;
const requirePlatformAdmin = (req) => {
  if (req.user?.role !== 'Super Admin') throw httpError(403, 'Only a platform administrator can manage public form locations');
};
// Public seller lead capture. An opaque location value is resolved server-side to an active dealership;
// dealership identity is never rendered on the public page.
app.get('/api/public/sell-locations', async (req, res, next) => {
  try {
    const config = await publicLeadConfig();
    const configured = (config?.locations || []).filter((location) => location.active);
    const dealerships = await Dealership.find({
      _id: { $in: configured.map((location) => location.dealership) },
      active: true,
      'subscription.status': 'Active',
    }).select('address.city address.state address.country').lean();
    const activeDealers = new Map(dealerships.map((dealership) => [String(dealership._id), dealership]));
    res.json({
      fields: configuredPublicFields(config),
      locations: configured.flatMap((location) => {
        const dealership = activeDealers.get(String(location.dealership));
        return dealership ? [{
          id: String(location._id), label: location.label,
          city: dealership.address?.city || location.label,
          state: dealership.address?.state || '', country: dealership.address?.country || 'India',
        }] : [];
      }),
    });
  } catch (error) {
    next(error);
  }
});
app.post(
  '/api/public/seller-enquiries',
  rateLimit({ windowMs: 60 * 60e3, max: 5, standardHeaders: true }),
  async (req, res, next) => {
    try {
      const input = z
        .object({
          locationId: z.string().regex(/^[a-f\d]{24}$/i),
          answers: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
          consentToContact: z.literal(true),
          website: z.string().max(0).optional(),
        })
        .parse(req.body);
      const config = await publicLeadConfig();
      const fields = configuredPublicFields(config);
      const answer = (key) => input.answers[key];
      const textAnswer = (key) => String(answer(key) ?? '').trim();
      const booleanAnswer = (key) => answer(key) === undefined || answer(key) === '' ? undefined : answer(key) === true || answer(key) === 'true';
      for (const field of fields) {
        if (field.required && !textAnswer(field.key)) throw httpError(400, `${field.label} is required`);
      }
      if (!/^[+0-9 ()-]{7,30}$/.test(textAnswer('phone'))) throw httpError(400, 'Enter a valid mobile number');
      if (!/^\d{6}$/.test(textAnswer('postalCode'))) throw httpError(400, 'Enter a valid 6-digit pincode');
      if (textAnswer('email') && !z.string().email().safeParse(textAnswer('email')).success) throw httpError(400, 'Enter a valid email address');
      const selectedLocation = (config?.locations || []).find((location) => String(location._id) === input.locationId && location.active);
      if (!selectedLocation) throw httpError(400, 'The selected location is not currently available');
      const dealership = await Dealership.findOne({
        _id: selectedLocation.dealership,
        active: true,
        'subscription.status': 'Active',
      });
      if (!dealership) throw httpError(400, 'The selected location is not currently available');
      const normalizedRegistration = textAnswer('registration').toUpperCase().replace(/\s+/g, '');
      let vehicle = await Vehicle.findOne({ dealership: dealership.id, registration: normalizedRegistration });
      if (!vehicle) {
        vehicle = await Vehicle.create({
          make: textAnswer('make'), model: textAnswer('model'),
          year: answer('year') ? Number(answer('year')) : undefined,
          odometer: answer('odometer') ? Number(answer('odometer')) : undefined,
          registration: normalizedRegistration,
          dealership: dealership.id,
          vehicleCode: id('VEH'),
          lifecycle: 'Enquiry Created',
          activities: [{ type: 'public-enquiry', message: 'Vehicle submitted through public seller form' }],
        });
      }
      const seller = await Person.create({
        dealership: dealership.id,
        customerReference: id('SEL'),
        name: textAnswer('name'), phone: textAnswer('phone'), email: textAnswer('email') || undefined,
        kind: 'seller',
      });
      const enquiry = await Enquiry.create({
        dealership: dealership.id,
        enquiryCode: id('ENQ'),
        type: 'seller',
        vehicle: vehicle.id,
        person: seller.id,
        source: 'Public sell-your-car form',
        declaredAccidentHistory: textAnswer('previousAccidents') || undefined,
        history: [{ type: 'public-submission', message: 'Seller submitted initial vehicle details', at: new Date() }],
        publicSubmission: {
          nearestLocation: { city: selectedLocation.label, state: dealership.address?.state },
          address: { line1: textAnswer('line1'), locality: textAnswer('locality'), city: textAnswer('city'), state: textAnswer('state'), postalCode: textAnswer('postalCode') },
          ownerCount: answer('ownerCount') ? Number(answer('ownerCount')) || undefined : undefined,
          isFirstOwner: booleanAnswer('isFirstOwner'),
          rcAvailable: booleanAnswer('rcAvailable'),
          insuranceRenewalDate: answer('insuranceRenewalDate') ? new Date(answer('insuranceRenewalDate')) : undefined,
          hasActiveLoan: booleanAnswer('hasActiveLoan'),
          loanProvider: textAnswer('loanProvider') || undefined,
          customFields: fields.filter((field) => !DEFAULT_PUBLIC_FIELDS.some((standard) => standard.key === field.key)).map((field) => ({ fieldId: String(field._id), label: field.label, value: answer(field.key) })).filter((field) => field.value !== undefined && field.value !== ''),
          consentToContact: true,
          proofStatus: 'Not Requested',
        },
      });
      await OwnershipPeriod.create({ vehicle: vehicle.id, owner: seller.id, source: 'Public seller declaration' });
      await audit(Audit, undefined, 'PUBLIC_SELLER_ENQUIRY', 'Enquiry', enquiry.id, {
        dealership: dealership.id,
        sellerReference: seller.customerReference,
        location: dealership.address?.city,
      });
      res.status(201).json({
        sellerReference: seller.customerReference,
        enquiryReference: enquiry.enquiryCode,
        message: 'Your details have been received. The nearby team will contact you to request proof documents.',
      });
    } catch (error) {
      next(error);
    }
  }
);
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
app.post('/api/auth/invitations/accept', rateLimit({ windowMs: 60 * 60e3, max: 8, standardHeaders: true }), async (q, s, n) => {
  try {
    const body = z.object({ token: z.string().min(32), password: z.string().min(12).max(200) }).parse(q.body);
    const tokenHash = crypto.createHash('sha256').update(body.token).digest('hex');
    const user = await User.findOne({ inviteTokenHash: tokenHash, inviteExpiresAt: { $gt: new Date() }, active: true });
    if (!user) throw httpError(400, 'This invitation is invalid or has expired');
    user.passwordHash = await bcrypt.hash(body.password, 12);
    user.passwordChangeRequired = false;
    user.inviteTokenHash = undefined;
    user.inviteExpiresAt = undefined;
    await user.save();
    if (user.dealership) await Dealership.updateOne({ _id: user.dealership }, { $set: { onboardingStatus: 'Active' } });
    await audit(Audit, user.id, 'ACCEPT_INVITATION', 'User', user.id, {}, { dealership: user.dealership, requestId: q.requestId });
    s.status(204).end();
  } catch (error) { n(error); }
});
app.use('/api', (req, res, next) =>
  ['/auth/password-reset/request', '/auth/password-reset/confirm', '/auth/invitations/accept'].includes(req.path)
    ? next()
    : authenticate(req, res, (error) => (error ? next(error) : csrf(req, res, next)))
);
app.use('/api', tenantContext);
app.use('/api', (req, res, next) => {
  if (!req.user) return next();
  const platformRoute =
    req.path === '/dealers' || req.path.startsWith('/dealers/') ||
    req.path === '/users' || req.path.startsWith('/users/') ||
    req.path === '/activity' || req.path === '/public-lead-settings';
  if (req.user.role === 'Super Admin' && platformRoute) return next();
  return requireTenant(req, res, next);
});
app.get('/api/public-lead-settings', permit('settings'), async (req, res, next) => {
  try {
    requirePlatformAdmin(req);
    const config = await publicLeadConfig();
    const dealerships = await Dealership.find().select('name code active subscription.status address.city address.state').sort({ name: 1 }).lean();
    res.json({ locations: config?.locations || [], fields: configuredPublicFields(config), dealerships });
  } catch (error) { next(error); }
});
app.put('/api/public-lead-settings', permit('settings'), async (req, res, next) => {
  try {
    requirePlatformAdmin(req);
    const input = z.object({ locations: z.array(z.object({
      _id: z.string().regex(/^[a-f\d]{24}$/i).optional(),
      label: z.string().trim().min(2).max(100),
      dealership: z.string().regex(/^[a-f\d]{24}$/i),
      active: z.boolean(),
    })).max(50), fields: z.array(z.object({
      _id: z.string().regex(/^[a-f\d]{24}$/i).optional(),
      key: z.string().trim().regex(/^[a-z][a-zA-Z0-9_]{0,79}$/),
      label: z.string().trim().min(2).max(120),
      type: z.enum(['text', 'email', 'tel', 'number', 'date', 'textarea', 'select', 'boolean']),
      required: z.boolean(), options: z.array(z.string().trim().min(1).max(80)).max(30).default([]), system: z.boolean().optional(),
    })).max(60) }).parse(req.body);
    const dealerIds = [...new Set(input.locations.map((location) => location.dealership))];
    const validDealers = await Dealership.countDocuments({ _id: { $in: dealerIds } });
    if (validDealers !== dealerIds.length) throw httpError(400, 'One or more selected dealerships no longer exist');
    const locations = input.locations.map((location) => ({ ...(location._id ? { _id: location._id } : {}), label: location.label, dealership: location.dealership, active: location.active }));
    const suppliedKeys = new Set(input.fields.map((field) => field.key));
    const missingSystemFields = DEFAULT_PUBLIC_FIELDS.filter((field) => field.system && !suppliedKeys.has(field.key));
    if (missingSystemFields.length) throw httpError(400, `These required fields cannot be removed: ${missingSystemFields.map((field) => field.label).join(', ')}`);
    if (new Set(input.fields.map((field) => field.key)).size !== input.fields.length) throw httpError(400, 'Each form field needs a unique key');
    const fields = input.fields.map((field) => ({ ...(field._id ? { _id: field._id } : {}), key: field.key, label: field.label, type: field.type, required: field.required || DEFAULT_PUBLIC_FIELDS.some((standard) => standard.key === field.key && standard.system), options: field.type === 'select' ? field.options : [], system: DEFAULT_PUBLIC_FIELDS.some((standard) => standard.key === field.key && standard.system) }));
    if (fields.some((field) => field.type === 'select' && !field.options.length)) throw httpError(400, 'Every dropdown needs at least one option');
    const config = await PublicLeadConfiguration.findOneAndUpdate({ key: 'seller-form' }, { $set: { locations, fields } }, { new: true, upsert: true, runValidators: true });
    await audit(Audit, req.user.id, 'UPDATE_PUBLIC_LEAD_SETTINGS', 'PublicLeadConfiguration', config.id, { locationCount: locations.length, fieldCount: fields.length }, { actorName: req.user.name, role: req.user.role, requestId: req.requestId });
    res.json({ locations: config.locations, fields: config.fields });
  } catch (error) { next(error); }
});
app.get('/api/dealers', permit('dealers:view'), async (q, s, n) => {
  try { s.json(await Dealership.find().sort({ createdAt: -1 }).lean()); } catch (e) { n(e); }
});
app.post('/api/dealers', permit('dealers:create'), async (q, s, n) => {
  try {
    const body = z.object({ name: z.string().min(2), code: z.string().min(2).max(20), contact: z.object({ name: z.string().min(2), email: z.string().email(), phone: z.string().min(5) }), address: z.object({ line1: z.string().min(2), city: z.string().min(2), state: z.string().optional(), postalCode: z.string().optional(), country: z.string().optional() }), subscription: z.object({ plan: z.string().min(2), maxUsers: z.coerce.number().int().min(1), maxVehicles: z.coerce.number().int().min(1) }), admin: z.object({ name: z.string().min(2), email: z.string().email(), phone: z.string().optional() }).optional() }).parse(q.body);
    const dealer = await Dealership.create({ ...body, code: body.code.toUpperCase(), onboardingStatus: 'Invited', subscription: { ...body.subscription, status: 'Active' } });
    let admin; let raw;
    let inviteDelivery;
    if (body.admin) {
      raw = token();
      admin = await User.create({ name: body.admin.name, email: body.admin.email.toLowerCase(), phone: body.admin.phone, role: 'Dealer Admin', dealership: dealer.id, passwordHash: await bcrypt.hash(token(), 12), inviteTokenHash: crypto.createHash('sha256').update(raw).digest('hex'), inviteExpiresAt: new Date(Date.now() + 72 * 3600e3), passwordChangeRequired: true });
      try { inviteDelivery = await sendDealerInvitation({ email: admin.email, name: admin.name, dealershipName: dealer.name, token: raw }); }
      catch (error) { inviteDelivery = { status: 'failed' }; console.error(JSON.stringify({ level: 'error', event: 'dealer_invitation_email_failed', dealer: dealer.id, message: error.message })); }
    }
    await audit(Audit, q.user.id, 'CREATE_DEALER', 'Dealership', dealer.id, { dealerAdmin: admin?.id }, { actorName: q.user.name, role: q.user.role, requestId: q.requestId });
    s.status(201).json({ dealer, dealerAdmin: admin ? { id: admin.id, email: admin.email } : undefined, inviteDelivery: inviteDelivery?.status, invitationUrl: inviteDelivery?.invitationUrl });
  } catch (e) { n(e); }
});
app.post('/api/dealers/:id/resend-invitation', permit('dealers:update'), async (q, s, n) => {
  try {
    if (q.user.role !== 'Super Admin') throw httpError(403, 'Only a platform administrator can resend dealer invitations');
    const dealer = await Dealership.findById(q.params.id);
    const admin = await User.findOne({ dealership: q.params.id, role: 'Dealer Admin', active: true }).sort({ createdAt: 1 });
    if (!dealer || !admin) throw httpError(404, 'Active dealer administrator not found');
    const raw = token();
    admin.inviteTokenHash = crypto.createHash('sha256').update(raw).digest('hex');
    admin.inviteExpiresAt = new Date(Date.now() + 72 * 3600e3);
    admin.passwordChangeRequired = true;
    await admin.save();
    let delivery;
    try { delivery = await sendDealerInvitation({ email: admin.email, name: admin.name, dealershipName: dealer.name, token: raw }); }
    catch (error) { console.error(JSON.stringify({ level: 'error', event: 'dealer_invitation_email_failed', dealer: dealer.id, message: error.message })); throw httpError(502, 'Invitation could not be delivered. Check SMTP settings and try again.'); }
    await audit(Audit, q.user.id, 'RESEND_DEALER_INVITATION', 'User', admin.id, {}, { dealership: dealer.id, actorName: q.user.name, role: q.user.role, requestId: q.requestId });
    s.json({ inviteDelivery: delivery.status, invitationUrl: delivery.invitationUrl });
  } catch (error) { n(error); }
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
app.use('/api', inspectionRoutes);
app.use('/api', parkingRoutes);
app.use('/api', acquisitionRoutes);
app.use('/api', refurbishmentRoutes);
app.use('/api', resaleRoutes);
app.use('/api', reportingRoutes);
app.use('/api', lifecycleRoutes);
app.use('/api', portalRoutes);
app.use('/api', profileRoutes);
app.get('/api/users', permit('users'), async (q, s, n) => {
  try {
    s.json(await User.find(q.user.role === 'Super Admin' ? {} : { dealership: q.tenantId }).select('-passwordHash -sessionVersion -inviteTokenHash').sort({ name: 1 }).lean());
  } catch (e) {
    n(e);
  }
});
app.post('/api/users', permit('users'), async (q, s, n) => {
  try {
    const b = z
      .object({
        name: z.string().min(2).max(100),
        email: z.string().email(),
        password: z.string().min(12).max(128).optional(),
        role: z.enum(ROLES).optional(), operationalProfile: z.enum(OPERATIONAL_PROFILES).optional(), partyType: z.enum(PARTY_TYPES).optional(), phone: z.string().max(30).optional(),
        dealership: z.string().optional(),
        active: z.boolean().optional(),
      })
      .parse(q.body);
    const targetRole = q.user.role === 'Super Admin' ? b.role : 'Technician & Service Advisor';
    if (!targetRole || (targetRole === 'Technician & Service Advisor' && !b.operationalProfile)) throw httpError(400, 'An operational profile is required for employee accounts');
    if (q.user.role !== 'Super Admin' && (b.role || b.partyType || b.dealership)) throw httpError(403, 'Dealer Admins can only provision operational employees');
    if (q.user.role === 'Super Admin' && targetRole !== 'Dealer Admin') throw httpError(403, 'Platform administrators can provision Dealer Admin accounts only through this endpoint');
    if (q.user.role === 'Super Admin' && (!b.dealership || !(await Dealership.exists({ _id: b.dealership, active: true })))) throw httpError(400, 'Select an active dealership for the Dealer Admin');
    const email = b.email.toLowerCase();
    if (await User.exists({ email })) throw httpError(409, 'An account with this email already exists');
    const u = await User.create({
      ...b,
      role: targetRole, dealership: q.user.role === 'Super Admin' ? b.dealership : q.tenantId,
      email,
      passwordHash: await bcrypt.hash(b.password || token(), 12), passwordChangeRequired: !b.password,
    });
    await audit(Audit, q.user.id, 'CREATE', 'User', u.id, { role: u.role, active: u.active });
    s.status(201).json({ id: u.id });
  } catch (e) {
    if (e?.code === 11000) {
      next(httpError(409, 'An account with this email already exists'));
      return;
    }
    next(e);
  }
});
app.patch('/api/users/:id', permit('users'), async (q, s, n) => {
  try {
    const b = z
      .object({
        name: z.string().min(2).max(100).optional(),
        email: z.string().email().optional(),
        operationalProfile: z.enum(OPERATIONAL_PROFILES).optional(),
        active: z.boolean().optional(),
      })
      .refine((x) => Object.keys(x).length > 0)
      .parse(q.body);
    const u = await User.findById(q.params.id);
    if (!u) throw httpError(404, 'User not found');
    if (q.user.role !== 'Super Admin' && String(u.dealership) !== String(q.tenantId)) throw httpError(404, 'User not found');
    if (String(u.id) === String(q.user.id) && b.active === false)
      throw httpError(400, 'You cannot deactivate your own account');
    if (b.active === true && u.role === 'Dealer Admin' &&
      !(await Dealership.exists({ _id: u.dealership, active: true }))) {
      throw httpError(409, 'Activate the dealership before activating its Dealer Admin account');
    }
    const changedRole = false,
      changedAccess = b.active !== undefined && b.active !== u.active;
    Object.assign(u, b, b.email ? { email: b.email.toLowerCase() } : {});
    if (changedRole || changedAccess) u.sessionVersion += 1;
    await u.save();
    if (changedRole || changedAccess) await Session.deleteMany({ user: u.id });
    await audit(Audit, q.user.id, 'UPDATE', 'User', u.id, {
      ...b,
      roleChanged: changedRole,
      accessChanged: changedAccess,
    });
    s.json({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active });
  } catch (e) {
    next(e);
  }
});
app.delete('/api/users/:id', permit('users'), async (q, s, n) => {
  try {
    if (q.user.role !== 'Super Admin') throw httpError(403, 'Only platform administrators can delete Dealer Admin accounts');
    const user = await User.findById(q.params.id);
    if (!user || user.role !== 'Dealer Admin') throw httpError(404, 'Dealer Admin not found');
    await audit(Audit, q.user.id, 'DELETE', 'User', user.id, {
      name: user.name,
      email: user.email,
      role: user.role,
      dealership: user.dealership,
    }, { actorName: q.user.name, role: q.user.role, requestId: q.requestId });
    await Promise.all([
      Session.deleteMany({ user: user.id }),
      PasswordReset.deleteMany({ user: user.id }),
    ]);
    await User.deleteOne({ _id: user.id });
    s.status(204).end();
  } catch (e) {
    n(e);
  }
});
app.post('/api/users/:id/revoke-sessions', permit('users'), async (q, s, n) => {
  try {
    const u = await User.findById(q.params.id);
    if (!u) throw httpError(404, 'User not found');
    if (q.user.role !== 'Super Admin' && String(u.dealership) !== String(q.tenantId))
      throw httpError(404, 'User not found');
    u.sessionVersion += 1;
    await u.save();
    const result = await Session.deleteMany({ user: u.id });
    await audit(Audit, q.user.id, 'REVOKE_SESSIONS', 'User', u.id, { count: result.deletedCount });
    s.json({ revoked: result.deletedCount });
  } catch (e) {
    next(e);
  }
});
const managedRecords = {
  users: { Model: User, fields: ['name', 'email', 'phone', 'operationalProfile', 'active'] },
  vehicles: { Model: Vehicle, fields: ['registration', 'make', 'model', 'year', 'fuelType', 'transmission', 'odometer', 'lifecycle'] },
  enquiries: { Model: Enquiry, fields: ['status', 'askingPrice', 'source', 'followUp', 'nextAction', 'notes'] },
  inspections: { Model: Inspection, fields: ['dueDate', 'assignedTo', 'status'] },
  'parking-slots': { Model: ParkingSlot, fields: ['code', 'zone', 'row', 'number', 'type', 'status', 'enabled'] },
  'work-orders': { Model: WorkOrder, fields: ['title', 'description', 'priority', 'assignedTo', 'status', 'notes'] },
  sales: { Model: Sale, fields: ['targetPrice', 'agreedPrice', 'status', 'reservedUntil'] },
};
app.patch('/api/records/:resource/:id', permit('users'), async (q, s, n) => {
  try {
    const config = managedRecords[q.params.resource];
    if (!config) throw httpError(404, 'Record type not found');
    const changes = Object.fromEntries(Object.entries(q.body || {}).filter(([key]) => config.fields.includes(key)));
    if (!Object.keys(changes).length) throw httpError(400, 'Provide at least one editable field');
    const record = await config.Model.findOneAndUpdate(tenantFilter(q, { _id: q.params.id }), changes, { new: true, runValidators: true });
    if (!record) throw httpError(404, 'Record not found');
    await audit(Audit, q.user.id, 'UPDATE', config.Model.modelName, record.id, changes, { dealership: q.tenantId, actorName: q.user.name, role: q.user.role, requestId: q.requestId });
    s.json(record);
  } catch (e) { n(e); }
});
app.delete('/api/records/:resource/:id', permit('users'), async (q, s, n) => {
  try {
    const config = managedRecords[q.params.resource];
    if (!config) throw httpError(404, 'Record type not found');
    const record = await config.Model.findOneAndDelete(tenantFilter(q, { _id: q.params.id }));
    if (!record) throw httpError(404, 'Record not found');
    await audit(Audit, q.user.id, 'DELETE', config.Model.modelName, record.id, {}, { dealership: q.tenantId, actorName: q.user.name, role: q.user.role, requestId: q.requestId });
    s.status(204).end();
  } catch (e) { n(e); }
});
app.post(
  '/api/auth/password-reset/request',
  rateLimit({ windowMs: 60 * 60e3, max: 5, standardHeaders: true }),
  async (q, s, n) => {
    try {
      const { email } = z.object({ email: z.string().email() }).parse(q.body);
      const u = await User.findOne({ email: email.toLowerCase(), active: true });
      if (u) {
        const raw = token();
        await PasswordReset.deleteMany({ user: u.id });
        await PasswordReset.create({
          tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
          user: u.id,
          expiresAt: new Date(Date.now() + 3600e3),
        });
        await audit(Audit, u.id, 'PASSWORD_RESET_REQUEST', 'User', u.id);
        if (process.env.NODE_ENV === 'development')
          console.log(
            JSON.stringify({ level: 'info', event: 'dev_password_reset_token', email: u.email, token: raw })
          );
      }
      s.status(202).json({ message: 'If the account exists, reset instructions have been queued.' });
    } catch (e) {
      next(e);
    }
  }
);
app.post(
  '/api/auth/password-reset/confirm',
  rateLimit({ windowMs: 60 * 60e3, max: 8, standardHeaders: true }),
  async (q, s, n) => {
    try {
      const { token: raw, password } = z
        .object({ token: z.string().min(32), password: z.string().min(12).max(128) })
        .parse(q.body);
      const reset = await PasswordReset.findOne({
        tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
        expiresAt: { $gt: new Date() },
        usedAt: null,
      });
      if (!reset) throw httpError(400, 'The reset token is invalid or expired');
      const u = await User.findById(reset.user);
      u.passwordHash = await bcrypt.hash(password, 12);
      u.sessionVersion += 1;
      await u.save();
      reset.usedAt = new Date();
      await reset.save();
      await Session.deleteMany({ user: u.id });
      await audit(Audit, u.id, 'PASSWORD_RESET', 'User', u.id);
      s.status(204).end();
    } catch (e) {
      next(e);
    }
  }
);
const page = paginatedQuery;
app.get('/api/vehicles', permit('vehicles'), page(Vehicle));
app.post('/api/vehicles', permit('vehicles'), async (q, s, n) => {
  try {
    const input = z.object({ registration: z.string().min(2).max(30), make: z.string().min(1).max(80), model: z.string().min(1).max(80), year: z.coerce.number().int().min(1900).max(2100).optional(), fuelType: z.string().max(40).optional(), transmission: z.string().max(40).optional(), odometer: z.coerce.number().min(0).optional() }).parse(q.body);
    const exists = await Vehicle.exists(tenantFilter(q, { registration: input.registration }));
    if (exists) throw httpError(409, 'A vehicle with this registration already exists in this dealership');
    const vehicle = await Vehicle.create({ ...input, dealership: q.tenantId, vehicleCode: id('VEH'), lifecycle: 'Vehicle Registered', activities: [{ type: 'created', message: 'Vehicle manually added', actor: q.user.id }] });
    await audit(Audit, q.user.id, 'CREATE', 'Vehicle', vehicle.id, { registration: vehicle.registration });
    s.status(201).json(vehicle);
  } catch (e) { n(e); }
});
app.get('/api/vehicles/:id', permit('vehicles'), async (q, s, n) => {
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
const enquiryInput = z.object({
  seller: z.object({
    name: z.string().min(2),
    phone: z.string().max(30).optional(),
    email: z.string().email().optional(),
  }),
  vehicle: z.object({
    registration: z.string().max(30).optional(),
    vin: z.string().max(80).optional(),
    chassis: z.string().max(80).optional(),
    engine: z.string().max(80).optional(),
    make: z.string().max(80).optional(),
    model: z.string().max(80).optional(),
    variant: z.string().max(80).optional(),
    year: z.coerce.number().int().min(1900).max(2100).optional(),
    fuelType: z.string().max(40).optional(),
    transmission: z.string().max(40).optional(),
    odometer: z.coerce.number().min(0).optional(),
  }),
  askingPrice: z.coerce.number().min(0).optional(),
  source: z.string().max(80).optional(),
  receivedAt: z.coerce.date().optional(),
  declaredAccidentHistory: z.string().max(3000).optional(),
  serviceHistory: z.string().max(3000).optional(),
  initialCondition: z.string().max(3000).optional(),
  assignedTo: z.string().optional(),
  followUp: z.coerce.date().optional(),
  nextAction: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
  photos: z.array(z.string().max(500)).max(10).optional(),
});
app.post('/api/enquiries', permit('enquiries'), async (q, s, n) => {
  try {
    const b = enquiryInput.parse(q.body);
    const identifiers = [
      ...(b.vehicle.vin ? [{ vin: b.vehicle.vin }] : []),
      ...(b.vehicle.chassis ? [{ chassis: b.vehicle.chassis }] : []),
      ...(b.vehicle.registration ? [{ registration: b.vehicle.registration }] : []),
    ];
    let vehicle = identifiers.length ? await Vehicle.findOne(tenantFilter(q, { $or: identifiers })) : null;
    const duplicate = !!vehicle;
    if (!vehicle)
      vehicle = await Vehicle.create({
        ...b.vehicle,
        dealership: q.tenantId,
        vehicleCode: id('VEH'),
        activities: [{ type: 'created', message: 'Vehicle master created', actor: q.user.id }],
      });
    const person = await Person.create({ ...b.seller, dealership: q.tenantId, kind: 'seller' });
    await OwnershipPeriod.create({
      vehicle: vehicle.id,
      owner: person.id,
      startDate: b.receivedAt,
      source: 'Seller declared',
    });
    const enq = await Enquiry.create({
      dealership: q.tenantId,
      enquiryCode: id('ENQ'),
      vehicle: vehicle.id,
      person: person.id,
      askingPrice: b.askingPrice,
      source: b.source,
      receivedAt: b.receivedAt,
      declaredAccidentHistory: b.declaredAccidentHistory,
      serviceHistory: b.serviceHistory,
      initialCondition: b.initialCondition,
      photos: b.photos,
      assignedTo: b.assignedTo || q.user.id,
      followUp: b.followUp,
      nextAction: b.nextAction,
      notes: b.notes,
      history: [
        {
          type: 'created',
          message: duplicate
            ? 'Seller enquiry linked to possible matching vehicle'
            : 'Seller enquiry created',
          actor: q.user.id,
        },
      ],
    });
    await audit(Audit, q.user.id, 'CREATE', 'Enquiry', enq.id, { duplicate, vehicle: vehicle.id });
    s.status(201).json({
      enquiry: enq,
      vehicle,
      possibleDuplicate: duplicate,
      duplicateReviewRequired: duplicate,
    });
  } catch (e) {
    n(e);
  }
});
app.get('/api/enquiries', permit('enquiries'), page(Enquiry));
app.get('/api/enquiries/:id', permit('enquiries'), async (q, s, n) => {
  try {
    const enquiry = await Enquiry.findOne(tenantFilter(q, { _id: q.params.id })).populate('vehicle person assignedTo');
    if (!enquiry) throw httpError(404, 'Enquiry not found');
    const [ownership, related] = await Promise.all([
      OwnershipPeriod.find({ vehicle: enquiry.vehicle.id }).populate('owner'),
      Enquiry.find(tenantFilter(q, { vehicle: enquiry.vehicle.id })).populate('person assignedTo').sort({ createdAt: -1 }),
    ]);
    s.json({ enquiry, ownership, related });
  } catch (e) {
    n(e);
  }
});
app.patch('/api/enquiries/:id', permit('enquiries'), async (q, s, n) => {
  try {
    const changes = z
      .object({
        status: z.enum(['Open', 'Contacted', 'On Hold', 'Rejected', 'Closed']).optional(),
        askingPrice: z.coerce.number().min(0).optional(),
        source: z.string().max(80).optional(),
        assignedTo: z.string().optional(),
        followUp: z.coerce.date().nullable().optional(),
        nextAction: z.string().max(500).optional(),
        notes: z.string().max(5000).optional(),
        declaredAccidentHistory: z.string().max(3000).optional(),
        serviceHistory: z.string().max(3000).optional(),
        initialCondition: z.string().max(3000).optional(),
        reason: z.string().max(1000).optional(),
      })
      .parse(q.body);
    const enquiry = await Enquiry.findOne(tenantFilter(q, { _id: q.params.id }));
    if (!enquiry) throw httpError(404, 'Enquiry not found');
    const previous = enquiry.status;
    Object.assign(enquiry, changes);
    delete enquiry.reason;
    if (changes.status && changes.status !== previous)
      enquiry.history.push({
        type: 'status',
        message: `Status changed from ${previous} to ${changes.status}${changes.reason ? `: ${changes.reason}` : ''}`,
        actor: q.user.id,
      });
    else enquiry.history.push({ type: 'updated', message: 'Enquiry details updated', actor: q.user.id });
    await enquiry.save();
    await audit(Audit, q.user.id, 'UPDATE', 'Enquiry', enquiry.id, {
      status: changes.status,
      reason: changes.reason,
    });
    s.json(enquiry);
  } catch (e) {
    n(e);
  }
});
app.post('/api/enquiries/:id/notes', permit('enquiries'), async (q, s, n) => {
  try {
    const { note } = z.object({ note: z.string().min(1).max(3000) }).parse(q.body);
    const enquiry = await Enquiry.findOneAndUpdate(
      tenantFilter(q, { _id: q.params.id }),
      { $push: { history: { type: 'note', message: note, actor: q.user.id, at: new Date() } } },
      { new: true }
    );
    if (!enquiry) throw httpError(404, 'Enquiry not found');
    s.status(201).json(enquiry.history.at(-1));
  } catch (e) {
    n(e);
  }
});
const documentStatuses = [
  'Not Submitted',
  'Submitted',
  'Under Review',
  'Verified',
  'Mismatch',
  'Expired',
  'Rejected',
  'On Hold',
];
async function findVehicleByReference(reference, req) {
  const value = reference.trim();
  const matches = [{ vehicleCode: value }, { registration: value }];
  if (/^[a-f\d]{24}$/i.test(value)) matches.unshift({ _id: value });
  return Vehicle.findOne(tenantFilter(req, { $or: matches }));
}
app.get('/api/documents', permit('documents:view'), async (q, s, n) => {
  try {
    if (q.tenantId) {
      const vehicleIds = await Vehicle.distinct('_id', { dealership: q.tenantId });
      await Document.updateMany(
        { dealership: { $in: [null] }, vehicle: { $in: vehicleIds } },
        { $set: { dealership: q.tenantId } }
      );
    }
    await page(Document)(q, s, n);
  } catch (e) {
    n(e);
  }
});
app.get('/api/documents/requirements', permit('documents:view'), async (q, s, n) => {
  try {
    s.json(await DocumentRequirement.find(tenantFilter(q, { enabled: true })).sort({ name: 1 }));
  } catch (e) {
    n(e);
  }
});
app.post('/api/documents/requirements', permit('settings:manage'), async (q, s, n) => {
  try {
    const body = z
      .object({
        name: z.string().min(2),
        category: z.string().min(2),
        description: z.string().optional(),
        requiredForAcquisition: z.boolean().optional(),
        requiresExpiry: z.boolean().optional(),
        applicableFuelTypes: z.array(z.string()).optional(),
        applicableTransactionTypes: z.array(z.string()).optional(),
      })
      .parse(q.body);
    s.status(201).json(await DocumentRequirement.create({ ...body, dealership: q.tenantId }));
  } catch (e) {
    n(e);
  }
});
app.get('/api/vehicles/:vehicleId/documents', permit('documents:view'), async (q, s, n) => {
  try {
    const vehicle = await findVehicleByReference(q.params.vehicleId, q);
    if (!vehicle) throw httpError(404, 'Vehicle not found. Use a valid vehicle ID, registration, or vehicle code.');
    const [docs, requirements] = await Promise.all([
      Document.find(tenantFilter(q, { vehicle: vehicle.id }))
        .populate('person submittedBy reviewer')
        .sort({ createdAt: -1 }),
      DocumentRequirement.find(tenantFilter(q, { enabled: true })),
    ]);
    const now = new Date();
    const normalized = docs.map((d) =>
      d.expiryDate && d.expiryDate < now && d.status === 'Verified'
        ? { ...d.toObject(), status: 'Expired' }
        : d
    );
    const required = requirements.filter((r) => r.requiredForAcquisition);
    const missing = required
      .filter((r) => !normalized.some((d) => d.category === r.category && d.status === 'Verified'))
      .map((r) => r.category);
    s.json({
      documents: normalized,
      requirements,
      completeness: {
        required: required.length,
        verified: required.length - missing.length,
        missing,
        eligible: missing.length === 0,
      },
    });
  } catch (e) {
    n(e);
  }
});
app.post('/api/documents', permit('documents:upload'), upload.single('file'), async (q, s, n) => {
  try {
    if (!q.file) throw httpError(400, 'A PDF, JPEG, or PNG file is required');
    const input = z
      .object({
        vehicle: z.string(),
        enquiry: z.string().optional(),
        person: z.string().optional(),
        category: z.string().min(2),
        expiryDate: z.coerce.date().optional(),
        consentRecorded: z.enum(['true', 'false']).optional(),
      })
      .parse(q.body);
    const vehicle = await findVehicleByReference(input.vehicle, q);
    if (!vehicle) throw httpError(404, 'Vehicle not found. Use a valid vehicle ID, registration, or vehicle code.');
    const file = await storageProvider.save(q.file.buffer);
    const doc = await Document.create({
      ...input,
      dealership: q.tenantId,
      vehicle: vehicle.id,
      ...file,
      originalName: q.file.originalname.replace(/[\\/]/g, '_').slice(0, 180),
      size: q.file.size,
      submittedBy: q.user.id,
      consentRecorded: input.consentRecorded === 'true',
      history: [
        { type: 'submitted', message: 'Document submitted for manual verification', actor: q.user.id },
      ],
    });
    await audit(Audit, q.user.id, 'UPLOAD', 'Document', doc.id, {
      vehicle: doc.vehicle,
      category: doc.category,
      storage: storageProvider.kind,
    });
    s.status(201).json(doc);
  } catch (e) {
    n(e);
  }
});
app.patch('/api/documents/:id/review', permit('documents:verify'), async (q, s, n) => {
  try {
    const body = z
      .object({
        status: z.enum(documentStatuses),
        reason: z.string().max(2000).optional(),
        verificationSource: z.string().max(500).optional(),
        verificationEvidence: z.string().max(2000).optional(),
        followUpAction: z.string().max(1000).optional(),
      })
      .parse(q.body);
    if (['Mismatch', 'Rejected', 'On Hold'].includes(body.status) && !body.reason)
      throw httpError(400, 'A reason is required for this review outcome');
    const d = await Document.findOne(tenantFilter(q, { _id: q.params.id }));
    if (!d) throw httpError(404, 'Document not found');
    d.status = body.status;
    d.reviewer = q.user.id;
    d.reviewedAt = new Date();
    d.reviewReason = body.reason;
    d.verificationSource = body.verificationSource;
    d.verificationEvidence = body.verificationEvidence;
    d.followUpAction = body.followUpAction;
    d.history.push({
      type: 'review',
      message: `Manual verification: ${body.status}${body.reason ? ` — ${body.reason}` : ''}`,
      actor: q.user.id,
    });
    await d.save();
    await audit(Audit, q.user.id, 'REVIEW', 'Document', d.id, { status: body.status });
    s.json(d);
  } catch (e) {
    n(e);
  }
});
app.get('/api/documents/:id/file', permit('documents:view'), async (q, s, n) => {
  try {
    const d = await Document.findOne(tenantFilter(q, { _id: q.params.id }));
    if (!d) throw httpError(404, 'Document not found');
    await audit(Audit, q.user.id, 'READ_PRIVATE_DOCUMENT', 'Document', d.id, { vehicle: d.vehicle });
    s.set({
      'Content-Disposition': `inline; filename="${d.originalName.replace(/"/g, '')}"`,
      'Cache-Control': 'private, no-store',
    })
      .type(d.mimeType)
      .send(await storageProvider.read(d.storageKey));
  } catch (e) {
    n(e);
  }
});
const simple = (base, Model, resource) => {
  app.get(`/api/${base}`, permit(resource), page(Model));
  app.post(`/api/${base}`, permit(resource), async (q, s, n) => {
    try {
      const x = await Model.create(q.body);
      s.status(201).json(x);
    } catch (e) {
      n(e);
    }
  });
  app.patch(`/api/${base}/:id`, permit(resource), async (q, s, n) => {
    try {
      const x = await Model.findByIdAndUpdate(q.params.id, q.body, { new: true });
      if (!x) throw httpError(404, 'Record not found');
      s.json(x);
    } catch (e) {
      n(e);
    }
  });
};
app.use('/api', dashboardRoutes);
app.use((e, q, s, n) => {
  const status = e.status || (['ZodError', 'CastError', 'ValidationError'].includes(e.name) ? 400 : 500);
  console.error(JSON.stringify({ level: 'error', requestId: q.requestId, status, message: e.message }));
  s.status(status).json({
    error: {
      message: status === 500 ? 'Unexpected server error' : e.message || 'Request failed',
      requestId: q.requestId,
    },
  });
});
export default app;
