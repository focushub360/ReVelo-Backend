import { can } from '../config/permissions.js';

export const permit = (resource) => (req, res, next) =>
  can(req.user, resource)
    ? next()
    : res.status(403).json({ error: { message: 'Insufficient permission' } });
