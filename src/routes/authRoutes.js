import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { User, Session, PasswordReset, Dealership, Audit } from '../models/index.js';
import { authenticate, csrf } from '../middleware/index.js';
import { token, audit, httpError } from '../utils/core.js';

const router = Router();

router.post(
  '/auth/login',
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
router.post('/auth/logout', authenticate, csrf, async (req, res, next) => {
  try {
    await Session.deleteOne({ _id: req.session.id });
    res.clearCookie('rv_session');
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
router.get('/auth/me', authenticate, (q, s) => s.json({ user: { id: q.user.id, name: q.user.name, email: q.user.email, phone: q.user.phone, photoUrl: q.user.photoUrl, role: q.user.role, operationalProfile: q.user.operationalProfile, partyType: q.user.partyType, dealership: q.user.dealership, active: q.user.active }, csrfToken: q.session.csrfToken }));
router.post('/auth/invitations/accept', rateLimit({ windowMs: 60 * 60e3, max: 8, standardHeaders: true }), async (q, s, n) => {
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

router.post(
  '/auth/password-reset/request',
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
router.post(
  '/auth/password-reset/confirm',
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

export default router;
