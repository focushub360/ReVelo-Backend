import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { Vehicle, Document, DocumentRequirement, Audit } from '../models/index.js';
import { permit } from '../middleware/permit.js';
import { tenantFilter } from '../middleware/tenant.js';
import { httpError } from '../utils/core.js';
import { paginatedQuery } from '../utils/pagination.js';
import { storageProvider } from '../storage/privateStorage.js';
import { hasSubmittedRequiredDocument } from '../services/lifecycleService.js';

const router = Router();
const page = paginatedQuery;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
});

const documentStatuses = [
  'Not Submitted',
  'Submitted',
  'Under Review',
  'Verified',
  'Mismatch',
  'Expired',
  'Rejected',
  'On Hold',
];
async function findVehicleByReference(reference, req) {
  const value = reference.trim();
  const matches = [{ vehicleCode: value }, { registration: value }];
  if (/^[a-f\d]{24}$/i.test(value)) matches.unshift({ _id: value });
  return Vehicle.findOne(tenantFilter(req, { $or: matches }));
}
router.get('/documents', permit('documents:view'), async (q, s, n) => {
  try {
    if (q.tenantId) {
      const vehicleIds = await Vehicle.distinct('_id', { dealership: q.tenantId });
      await Document.updateMany(
        { dealership: { $in: [null] }, vehicle: { $in: vehicleIds } },
        { $set: { dealership: q.tenantId } }
      );
    }
    await page(Document)(q, s, n);
  } catch (e) {
    n(e);
  }
});
router.get('/documents/requirements', permit('documents:view'), async (q, s, n) => {
  try {
    s.json(await DocumentRequirement.find(tenantFilter(q, { enabled: true })).sort({ name: 1 }));
  } catch (e) {
    n(e);
  }
});
router.post('/documents/requirements', permit('settings:manage'), async (q, s, n) => {
  try {
    const body = z
      .object({
        name: z.string().min(2),
        category: z.string().min(2),
        description: z.string().optional(),
        requiredForAcquisition: z.boolean().optional(),
        requiresExpiry: z.boolean().optional(),
        applicableFuelTypes: z.array(z.string()).optional(),
        applicableTransactionTypes: z.array(z.string()).optional(),
      })
      .parse(q.body);
    s.status(201).json(await DocumentRequirement.create({ ...body, dealership: q.tenantId }));
  } catch (e) {
    n(e);
  }
});
router.get('/vehicles/:vehicleId/documents', permit('documents:view'), async (q, s, n) => {
  try {
    const vehicle = await findVehicleByReference(q.params.vehicleId, q);
    if (!vehicle) throw httpError(404, 'Vehicle not found. Use a valid vehicle ID, registration, or vehicle code.');
    const [docs, requirements] = await Promise.all([
      Document.find(tenantFilter(q, { vehicle: vehicle.id }))
        .populate('person submittedBy reviewer')
        .sort({ createdAt: -1 }),
      DocumentRequirement.find(tenantFilter(q, { enabled: true })),
    ]);
    const now = new Date();
    const normalized = docs.map((d) =>
      d.expiryDate && d.expiryDate < now && d.status === 'Verified'
        ? { ...d.toObject(), status: 'Expired' }
        : d
    );
    const required = requirements.filter((r) => r.requiredForAcquisition);
    const missing = required
      .filter((requirement) => !hasSubmittedRequiredDocument(requirement, normalized, now))
      .map((r) => r.category);
    s.json({
      documents: normalized,
      requirements,
      completeness: {
        required: required.length,
        verified: required.length - missing.length,
        missing,
        eligible: missing.length === 0,
      },
    });
  } catch (e) {
    n(e);
  }
});
router.post('/documents', permit('documents:upload'), upload.single('file'), async (q, s, n) => {
  try {
    if (!q.file) throw httpError(400, 'A PDF, JPEG, or PNG file is required');
    const input = z
      .object({
        vehicle: z.string(),
        enquiry: z.string().optional(),
        person: z.string().optional(),
        category: z.string().min(2),
        expiryDate: z.coerce.date().optional(),
        consentRecorded: z.enum(['true', 'false']).optional(),
      })
      .parse(q.body);
    const vehicle = await findVehicleByReference(input.vehicle, q);
    if (!vehicle) throw httpError(404, 'Vehicle not found. Use a valid vehicle ID, registration, or vehicle code.');
    const file = await storageProvider.save(q.file.buffer);
    const doc = await Document.create({
      ...input,
      dealership: q.tenantId,
      vehicle: vehicle.id,
      ...file,
      originalName: q.file.originalname.replace(/[\\/]/g, '_').slice(0, 180),
      size: q.file.size,
      submittedBy: q.user.id,
      consentRecorded: input.consentRecorded === 'true',
      history: [
        { type: 'submitted', message: 'Document submitted for manual verification', actor: q.user.id },
      ],
    });
    await audit(Audit, q.user.id, 'UPLOAD', 'Document', doc.id, {
      vehicle: doc.vehicle,
      category: doc.category,
      storage: storageProvider.kind,
    });
    s.status(201).json(doc);
  } catch (e) {
    n(e);
  }
});
router.patch('/documents/:id/review', permit('documents:verify'), async (q, s, n) => {
  try {
    const body = z
      .object({
        status: z.enum(documentStatuses),
        reason: z.string().max(2000).optional(),
        verificationSource: z.string().max(500).optional(),
        verificationEvidence: z.string().max(2000).optional(),
        followUpAction: z.string().max(1000).optional(),
      })
      .parse(q.body);
    if (['Mismatch', 'Rejected', 'On Hold'].includes(body.status) && !body.reason)
      throw httpError(400, 'A reason is required for this review outcome');
    const d = await Document.findOne(tenantFilter(q, { _id: q.params.id }));
    if (!d) throw httpError(404, 'Document not found');
    d.status = body.status;
    d.reviewer = q.user.id;
    d.reviewedAt = new Date();
    d.reviewReason = body.reason;
    d.verificationSource = body.verificationSource;
    d.verificationEvidence = body.verificationEvidence;
    d.followUpAction = body.followUpAction;
    d.history.push({
      type: 'review',
      message: `Manual verification: ${body.status}${body.reason ? ` — ${body.reason}` : ''}`,
      actor: q.user.id,
    });
    await d.save();
    await audit(Audit, q.user.id, 'REVIEW', 'Document', d.id, { status: body.status });
    s.json(d);
  } catch (e) {
    n(e);
  }
});
router.get('/documents/:id/file', permit('documents:view'), async (q, s, n) => {
  try {
    const d = await Document.findOne(tenantFilter(q, { _id: q.params.id }));
    if (!d) throw httpError(404, 'Document not found');
    await audit(Audit, q.user.id, 'READ_PRIVATE_DOCUMENT', 'Document', d.id, { vehicle: d.vehicle });
    s.set({
      'Content-Disposition': `inline; filename="${d.originalName.replace(/"/g, '')}"`,
      'Cache-Control': 'private, no-store',
    })
      .type(d.mimeType)
      .send(await storageProvider.read(d.storageKey));
  } catch (e) {
    n(e);
  }
});

export default router;
