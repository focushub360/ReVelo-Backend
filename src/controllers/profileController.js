import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Audit, Session, User } from '../models/index.js';
import { audit, httpError } from '../utils/core.js';

const profileInput = z.object({
  name: z.string().min(2).max(100).optional(),
  phone: z.string().max(30).optional(),
  photoUrl: z.string().url().max(500).optional().or(z.literal('')),
}).refine(value => Object.keys(value).length > 0);

const passwordInput = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(12).max(200),
});

const safeUser = user => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  photoUrl: user.photoUrl,
  role: user.role,
  operationalProfile: user.operationalProfile,
  partyType: user.partyType,
  dealership: user.dealership,
  active: user.active,
  createdAt: user.createdAt,
  lastLoginAt: user.lastLoginAt,
});

export async function getProfile(req, res, next) {
  try {
    res.json({ user: safeUser(req.user) });
  } catch (error) {
    next(error);
  }
}

export async function updateProfile(req, res, next) {
  try {
    const input = profileInput.parse(req.body);
    const user = await User.findById(req.user.id);
    if (!user) throw httpError(404, 'Account not found');
    if (input.name !== undefined) user.name = input.name;
    if (input.phone !== undefined) user.phone = input.phone;
    if (input.photoUrl !== undefined) user.photoUrl = input.photoUrl || undefined;
    await user.save();
    await audit(Audit, req.user.id, 'UPDATE_PROFILE', 'User', user.id, { fields: Object.keys(input) }, {
      actorName: user.name, role: user.role, operationalProfile: user.operationalProfile,
      dealership: user.dealership, requestId: req.requestId,
    });
    res.json({ user: safeUser(user) });
  } catch (error) {
    next(error);
  }
}

export async function updatePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = passwordInput.parse(req.body);
    const user = await User.findById(req.user.id);
    if (!user) throw httpError(404, 'Account not found');
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw httpError(401, 'Current password is incorrect');
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.passwordChangeRequired = false;
    user.sessionVersion += 1;
    await user.save();
    await Session.deleteMany({ user: user.id, _id: { $ne: req.session.id } });
    req.session.sessionVersion = user.sessionVersion;
    await req.session.save();
    await audit(Audit, req.user.id, 'UPDATE_PASSWORD', 'User', user.id, {}, {
      actorName: user.name, role: user.role, operationalProfile: user.operationalProfile,
      dealership: user.dealership, requestId: req.requestId,
    });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}
