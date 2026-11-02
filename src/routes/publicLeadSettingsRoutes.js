import { Router } from 'express';
import { z } from 'zod';
import { Dealership, PublicLeadConfiguration, Audit } from '../models/index.js';
import { permit } from '../middleware/permit.js';
import { audit, httpError } from '../utils/core.js';
import { publicLeadConfig, configuredPublicFields, DEFAULT_PUBLIC_FIELDS, requirePlatformAdmin } from '../services/publicLeadService.js';

const router = Router();

router.get('/public-lead-settings', permit('settings'), async (req, res, next) => {
  try {
    requirePlatformAdmin(req);
    const config = await publicLeadConfig();
    const dealerships = await Dealership.find().select('name code active subscription.status address.city address.state').sort({ name: 1 }).lean();
    res.json({ locations: config?.locations || [], fields: configuredPublicFields(config), dealerships });
  } catch (error) { next(error); }
});
router.put('/public-lead-settings', permit('settings'), async (req, res, next) => {
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

export default router;
