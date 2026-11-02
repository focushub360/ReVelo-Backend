import { Router } from 'express';
import { Audit } from '../models/index.js';
import { WorkOrder } from '../models/workOrder.js';
import { permit } from '../middleware/permit.js';
import { tenantFilter } from '../middleware/tenant.js';

const router = Router();

router.get('/activity', permit('audit:view'), async (q, s, n) => { try {
  const canSeeDealership = q.user.role === 'Dealer Admin' || q.user.operationalProfile === 'Dealership Manager';
  const technicianHandoverOnly = q.user.operationalProfile === 'Refurbishment Technician';
  const audits = await Audit.find(tenantFilter(q, canSeeDealership ? {} : { actor: q.user.id, ...(technicianHandoverOnly ? { action: 'REFURBISHMENT_HANDOVER_SUBMITTED' } : {}) })).sort({ createdAt: -1 }).limit(100).lean();
  // Surface older completion handovers too, including records created before the
  // global audit event was introduced.
  if (!canSeeDealership) {
    const handovers = await WorkOrder.find(tenantFilter(q, { 'technicianCompletion.submittedBy': q.user.id })).select('technicianCompletion completedAt title').lean();
    const derived = handovers.map((workOrder) => ({ _id: `handover-${workOrder._id}`, createdAt: workOrder.technicianCompletion?.submittedAt || workOrder.completedAt, action: 'REFURBISHMENT_HANDOVER_SUBMITTED', entity: 'WorkOrder', entityId: String(workOrder._id), data: { title: workOrder.title } }));
    const existing = new Set(audits.filter((event) => event.action === 'REFURBISHMENT_HANDOVER_SUBMITTED').map((event) => event.entityId));
    audits.push(...derived.filter((event) => !existing.has(event.entityId)));
    audits.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  s.json(audits.slice(0, 100));
} catch (e) { n(e); } });

export default router;
