import { Session } from '../models/session.js';

export async function authenticate(req, res, next) {
  try {
    const token = req.cookies.rv_session;
    if (!token) return res.status(401).json({ error: { message: 'Authentication required' } });
    const session = await Session.findOne({ token, expiresAt: { $gt: new Date() } }).populate('user');
    if (!session || !session.user?.active || session.sessionVersion !== session.user.sessionVersion)
      return res.status(401).json({ error: { message: 'Session expired' } });
    req.user = session.user;
    req.session = session;
    next();
  } catch (error) {
    next(error);
  }
}
