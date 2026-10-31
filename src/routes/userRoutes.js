import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import {
  User, Session, PasswordReset, Dealership, Vehicle, Enquiry, Inspection, ParkingSlot, WorkOrder, Sale, Audit,
} from '../models/index.js';
import { ROLES, OPERATIONAL_PROFILES, PARTY_TYPES } from '../config/permissions.js';
import { permit } from '../middleware/permit.js';
import { tenantFilter } from '../middleware/tenant.js';
import { id, token, audit, httpError } from '../utils/core.js';

const router = Router();

router.get('/users', permit('users'), async (q, s, n) => {
  try {
    s.json(await User.find(q.user.role === 'Super Admin' ? {} : { dealership: q.tenantId }).select('-passwordHash -sessionVersion -inviteTokenHash').sort({ name: 1 }).lean());
  } catch (e) {
    n(e);
  }
});
router.post('/users', permit('users'), async (q, s, n) => {
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
router.patch('/users/:id', permit('users'), async (q, s, n) => {
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
router.delete('/users/:id', permit('users'), async (q, s, n) => {
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
router.post('/users/:id/revoke-sessions', permit('users'), async (q, s, n) => {
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
  enquiries: { Model: Enquiry, fields: ['status', 'askingPrice', 'source', 'followUp', 'nextAction', 'notes', 'vehicle'] },
  inspections: { Model: Inspection, fields: ['dueDate', 'assignedTo', 'status'] },
  'parking-slots': { Model: ParkingSlot, fields: ['code', 'zone', 'row', 'number', 'type', 'status', 'enabled'] },
  'work-orders': { Model: WorkOrder, fields: ['title', 'description', 'priority', 'assignedTo', 'status', 'notes'] },
  sales: { Model: Sale, fields: ['targetPrice', 'agreedPrice', 'status', 'reservedUntil'] },
};
router.patch('/records/:resource/:id', permit('users'), async (q, s, n) => {
  try {
    const config = managedRecords[q.params.resource];
    if (!config) throw httpError(404, 'Record type not found');
    const changes = Object.fromEntries(Object.entries(q.body || {}).filter(([key]) => config.fields.includes(key)));
    if (!Object.keys(changes).length) throw httpError(400, 'Provide at least one editable field');
    if (
      q.params.resource === 'enquiries' &&
      Object.prototype.hasOwnProperty.call(changes, 'vehicle')
    ) {
      const vehicleId = z.string().regex(/^[a-f\d]{24}$/i).parse(changes.vehicle);
      const vehicle = await Vehicle.findOne(tenantFilter(q, { _id: vehicleId }));
      if (!vehicle) throw httpError(404, 'Vehicle not found');
      changes.vehicle = vehicle.id;
    }
    const record = await config.Model.findOneAndUpdate(tenantFilter(q, { _id: q.params.id }), changes, { new: true, runValidators: true });
    if (!record) throw httpError(404, 'Record not found');
    await audit(Audit, q.user.id, 'UPDATE', config.Model.modelName, record.id, changes, { dealership: q.tenantId, actorName: q.user.name, role: q.user.role, requestId: q.requestId });
    s.json(record);
  } catch (e) { n(e); }
});
router.delete('/records/:resource/:id', permit('users'), async (q, s, n) => {
  try {
    const config = managedRecords[q.params.resource];
    if (!config) throw httpError(404, 'Record type not found');
    const record = await config.Model.findOneAndDelete(tenantFilter(q, { _id: q.params.id }));
    if (!record) throw httpError(404, 'Record not found');
    await audit(Audit, q.user.id, 'DELETE', config.Model.modelName, record.id, {}, { dealership: q.tenantId, actorName: q.user.name, role: q.user.role, requestId: q.requestId });
    s.status(204).end();
  } catch (e) { n(e); }
});

export default router;
