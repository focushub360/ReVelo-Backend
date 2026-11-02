import { Router } from 'express';
import { z } from 'zod';
import { Appointment, Enquiry, Negotiation, Person, Vehicle } from '../models/index.js';
import { httpError } from '../utils/core.js';
import { tenantFilter } from '../middleware/tenant.js';
const router = Router();
const external = (req) => req.user.role === 'Buyer & Seller';
async function partyFor(req) {
  if (!external(req)) return null;
  const party = req.user.party ? await Person.findOne(tenantFilter(req, { _id: req.user.party })) : await Person.findOne(tenantFilter(req, { email: req.user.email }));
  if (!party) throw httpError(403, 'No authorized external party profile is linked to this account');
  return party;
}
function externalOnly(req) { if (!external(req)) throw httpError(403, 'External portal access required'); }
router.get('/portal/enquiries', async (req, res, next) => { try { externalOnly(req); const party = await partyFor(req); res.json(await Enquiry.find(tenantFilter(req, { person: party.id })).populate('vehicle').select('-notes -history')); } catch (e) { next(e); } });
router.get('/portal/appointments', async (req, res, next) => { try { externalOnly(req); const party = await partyFor(req); res.json(await Appointment.find(tenantFilter(req, { party: party.id })).populate('vehicle').select('-notes')); } catch (e) { next(e); } });
router.post('/portal/appointments', async (req, res, next) => { try { externalOnly(req); const party = await partyFor(req); const body = z.object({ vehicle: z.string(), type: z.enum(['Viewing', 'Test Drive']), startsAt: z.coerce.date(), endsAt: z.coerce.date() }).parse(req.body); if (body.endsAt <= body.startsAt) throw httpError(400, 'Appointment end must be after start'); const vehicle = await Vehicle.findOne(tenantFilter(req, { _id: body.vehicle, lifecycle: 'Ready for Sale' })); if (!vehicle) throw httpError(404, 'Available vehicle not found'); const record = await Appointment.create({ ...body, dealership: req.tenantId, party: party.id }); res.status(201).json(record); } catch (e) { next(e); } });
router.patch('/portal/appointments/:id', async (req, res, next) => { try { externalOnly(req); const party = await partyFor(req); const body = z.object({ startsAt: z.coerce.date().optional(), endsAt: z.coerce.date().optional(), status: z.enum(['Cancelled']).optional(), cancellationReason: z.string().min(2).optional() }).parse(req.body); const appointment = await Appointment.findOne(tenantFilter(req, { _id: req.params.id, party: party.id })); if (!appointment) throw httpError(404, 'Appointment not found'); if (appointment.status === 'Completed' || appointment.status === 'Cancelled') throw httpError(409, 'Appointment is closed'); if (body.status === 'Cancelled' && !body.cancellationReason) throw httpError(400, 'Cancellation reason is required'); Object.assign(appointment, body); if (appointment.endsAt <= appointment.startsAt) throw httpError(400, 'Appointment end must be after start'); await appointment.save(); res.json(appointment); } catch (e) { next(e); } });
router.get('/portal/negotiations', async (req, res, next) => { try { externalOnly(req); const party = await partyFor(req); res.json(await Negotiation.find(tenantFilter(req, { buyer: party.id })).populate('vehicle').select('-responsibleUser')); } catch (e) { next(e); } });
router.post('/portal/negotiations/:id/offers', async (req, res, next) => { try { externalOnly(req); const party = await partyFor(req); const { amount, terms } = z.object({ amount: z.coerce.number().positive(), terms: z.string().max(1000).optional() }).parse(req.body); const negotiation = await Negotiation.findOne(tenantFilter(req, { _id: req.params.id, buyer: party.id, status: 'Open' })); if (!negotiation) throw httpError(404, 'Open negotiation not found'); negotiation.offers.push({ amount, terms, kind: 'Offer', actor: req.user.id }); await negotiation.save(); res.status(201).json(negotiation); } catch (e) { next(e); } });
export default router;
