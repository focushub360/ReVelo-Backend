import { httpError } from '../utils/core.js';
export function tenantContext(req, res, next) {
  if (!req.user) return next();
  if (req.user.role === 'Super Admin') return next();
  if (!req.user.dealership) return next(httpError(403, 'This account is not associated with an active dealership'));
  req.tenantId = req.user.dealership;
  next();
}
export function requireTenant(req, res, next) {
  if (!req.tenantId) return next(httpError(403, 'A dealership workspace is required for this operation'));
  next();
}
// Platform users must use explicit platform routes; ordinary dealer-workflow routes never become global queries.
export const tenantFilter = (req, filter = {}) =>
  req.tenantId ? { ...filter, dealership: req.tenantId } : { ...filter, $expr: { $eq: [1, 0] } };
export const ownOrDealer = (req, ownerId) => req.user.role === 'Dealer Admin' || String(ownerId) === String(req.user.id);
