import { Router } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { z } from 'zod';
import { VerificationRequest, Document, Enquiry, Audit } from '../models/index.js';
import { storageProvider } from '../storage/privateStorage.js';
import { audit, httpError } from '../utils/core.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const requestFor = (raw) => VerificationRequest.findOne({ tokenHash: crypto.createHash('sha256').update(raw).digest('hex'), expiresAt: { $gt: new Date() }, status: { $in: ['Requested', 'Documents Submitted'] } });

router.get('/public/verification/:token', async (req, res, next) => {
  try {
    const request = await requestFor(req.params.token);
    if (!request) throw httpError(404, 'This verification link is invalid or has expired');
    const documents = await Document.find({ enquiry: request.enquiry }).select('category status originalName submittedAt expiryDate reviewReason').sort({ createdAt: -1 }).lean();
    res.json({ request: { status: request.status, expiresAt: request.expiresAt, requirements: request.requirements, declaration: request.declaration || {} }, documents });
  } catch (error) { next(error); }
});
router.post('/public/verification/:token/documents', upload.single('file'), async (req, res, next) => {
  try {
    const request = await requestFor(req.params.token);
    if (!request) throw httpError(404, 'This verification link is invalid or has expired');
    if (!req.file) throw httpError(400, 'Choose a PDF, JPEG, or PNG document to upload');
    const input = z.object({ category: z.string().min(2).max(120), expiryDate: z.coerce.date().optional(), consent: z.literal('true') }).parse(req.body);
    const requirement = request.requirements.find((item) => item.category === input.category);
    if (!requirement) throw httpError(400, 'That document is not requested for this verification');
    const file = await storageProvider.save(req.file.buffer);
    const document = await Document.create({ dealership: request.dealership, vehicle: request.vehicle, enquiry: request.enquiry, person: request.person, category: input.category, ...file, originalName: req.file.originalname.replace(/[\\/]/g, '_').slice(0, 180), size: req.file.size, expiryDate: input.expiryDate, consentRecorded: true, history: [{ type: 'public-verification-upload', message: 'Customer submitted through secure verification link' }] });
    request.status = 'Documents Submitted'; await request.save();
    await Enquiry.updateOne({ _id: request.enquiry }, { $set: { 'publicSubmission.proofStatus': 'Submitted' }, $push: { history: { type: 'proof-submitted', message: `Customer submitted ${input.category} through secure link`, at: new Date() } } });
    await audit(Audit, undefined, 'PUBLIC_VERIFICATION_UPLOAD', 'Document', document.id, { enquiry: request.enquiry, category: document.category, dealership: request.dealership });
    res.status(201).json({ document: { category: document.category, status: document.status, submittedAt: document.submittedAt } });
  } catch (error) { next(error); }
});
router.put('/public/verification/:token/details', async (req, res, next) => {
  try {
    const request = await requestFor(req.params.token);
    if (!request) throw httpError(404, 'This verification link is invalid or has expired');
    const input = z.object({
      hasLoan: z.boolean(),
      loanProvider: z.string().trim().max(120).optional().or(z.literal('')),
      loanReference: z.string().trim().max(120).optional().or(z.literal('')),
      outstandingAmount: z.coerce.number().min(0).optional().nullable(),
      previousOwners: z.array(z.object({ name: z.string().trim().max(120).optional().or(z.literal('')), phone: z.string().trim().max(30).optional().or(z.literal('')), address: z.string().trim().max(300).optional().or(z.literal('')) })).max(5),
    }).parse(req.body);
    request.declaration = {
      hasLoan: input.hasLoan,
      loanProvider: input.hasLoan ? input.loanProvider || undefined : undefined,
      loanReference: input.hasLoan ? input.loanReference || undefined : undefined,
      outstandingAmount: input.hasLoan ? input.outstandingAmount ?? undefined : undefined,
      previousOwners: input.previousOwners.filter((owner) => owner.name || owner.phone || owner.address),
      submittedAt: new Date(),
    };
    await request.save();
    res.json({ declaration: request.declaration });
  } catch (error) { next(error); }
});

export default router;
