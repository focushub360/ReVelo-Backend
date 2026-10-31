import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import {
  Dealership, User, Session, Person, Vehicle, Enquiry, Document, Inspection, ParkingSlot, ParkingZone,
  Movement, Acquisition, AcquisitionOffer, WorkOrder, QualityCheck, Sale, Notification, Negotiation,
  Appointment, Audit,
} from '../models/index.js';
import { permit } from '../middleware/permit.js';
import { audit, httpError, token } from '../utils/core.js';
import { sendDealerInvitation } from '../services/emailService.js';

const router = Router();

router.get('/dealers', permit('dealers:view'), async (q, s, n) => {
  try { s.json(await Dealership.find().sort({ createdAt: -1 }).lean()); } catch (e) { n(e); }
});
router.post('/dealers', permit('dealers:create'), async (q, s, n) => {
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
router.post('/dealers/:id/resend-invitation', permit('dealers:update'), async (q, s, n) => {
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
router.patch('/dealers/:id', permit('dealers:update'), async (q, s, n) => {
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
router.delete('/dealers/:id', permit('dealers:update'), async (q, s, n) => {
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
router.patch('/dealers/:id/status', permit('dealers:update'), async (q, s, n) => {
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

export default router;
