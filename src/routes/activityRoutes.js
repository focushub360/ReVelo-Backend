import { Router } from 'express';
import { Audit } from '../models/index.js';
import { permit } from '../middleware/permit.js';
import { tenantFilter } from '../middleware/tenant.js';

const router = Router();

router.get('/activity', permit('audit:view'), async (q, s, n) => { try { s.json(await Audit.find(tenantFilter(q)).sort({ createdAt: -1 }).limit(100).lean()); } catch (e) { n(e); } });

export default router;
