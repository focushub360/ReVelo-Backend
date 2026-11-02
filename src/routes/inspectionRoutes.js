import { Router } from 'express';
import { z } from 'zod';
import { Inspection } from '../models/inspection.js';
import { InspectionTemplate } from '../models/inspectionTemplate.js';
import { Vehicle } from '../models/vehicle.js';
import { User } from '../models/user.js';
import { Notification } from '../models/notification.js';
import { VehicleIntake } from '../models/vehicleIntake.js';
import { Acquisition } from '../models/acquisition.js';
import { Enquiry } from '../models/enquiry.js';
import { permit } from '../middleware/permit.js';
import { httpError } from '../utils/core.js';
import { paginatedQuery } from '../utils/pagination.js';
import { tenantFilter, ownOrDealer } from '../middleware/tenant.js';

const router = Router();
const findings = z.array(
  z.object({
    questionId: z.string().optional(),
    category: z.string().optional(),
    title: z.string().min(1),
    required: z.boolean().optional(),
    result: z.enum(['Inspected', 'Not Inspected']),
    severity: z.enum(['Low', 'Medium', 'High', 'Critical']).optional(),
    notes: z.string().optional(),
    photos: z.array(z.string()).optional(),
    recommendedAction: z.string().optional(),
    estimatedRepairCost: z.coerce.number().min(0).optional(),
  })
);
router.get('/inspection-templates', permit('inspections:view_assigned'), async (req, res, next) => {
  try {
    res.json(await InspectionTemplate.find(tenantFilter(req, { enabled: true })).sort({ kind: 1, name: 1 }));
  } catch (error) {
    next(error);
  }
});
router.post('/inspection-templates', permit('settings'), async (req, res, next) => {
  try {
    const input = z
      .object({
        name: z.string().min(3),
        kind: z.enum(['mechanical', 'structural']),
        questions: z
          .array(
            z.object({
              questionId: z.string().min(1),
              category: z.string().min(1),
              title: z.string().min(1),
              required: z.boolean().optional(),
              guidance: z.string().optional(),
            })
          )
          .min(1),
      })
      .parse(req.body);
    res.status(201).json(await InspectionTemplate.create({ ...input, dealership: req.tenantId }));
  } catch (error) {
    next(error);
  }
});
router.get('/inspections', permit('inspections:view_assigned'), paginatedQuery(Inspection, (req) =>
  req.user.role === 'Dealer Admin' ? {} : { assignedTo: req.user.id }
));
router.get('/technical-inspections', permit('inspections:view_assigned'), async (req, res, next) => {
  try {
    const scope = req.user.role === 'Dealer Admin' ? {} : { assignedTo: req.user.id };
    const inspections = await Inspection.find(tenantFilter(req, { ...scope, kind: 'mechanical' }))
      .populate('vehicle', 'registration make model year odometer currentLocation')
      .populate('assignedBy', 'name')
      .sort({ assignedAt: 1 })
      .lean();
    const intakes = await VehicleIntake.find(tenantFilter(req, { vehicle: { $in: inspections.map((report) => report.vehicle?._id || report.vehicle) } }))
      .populate('parkingSlot', 'code type')
      .sort({ createdAt: -1 }).lean();
    const byVehicle = new Map();
    for (const intake of intakes) if (!byVehicle.has(String(intake.vehicle))) byVehicle.set(String(intake.vehicle), intake);
    res.json(inspections.map((report) => ({ report, intake: byVehicle.get(String(report.vehicle?._id || report.vehicle)) || null })));
  } catch (error) { next(error); }
});
router.post('/inspections', permit('inspections:assign'), async (req, res, next) => {
  try {
    const input = z
      .object({
        vehicle: z.string(),
        kind: z.enum(['intake', 'mechanical', 'structural']).default('intake'),
        assignedTo: z.string().optional(),
        template: z.string().optional(),
        dueDate: z.coerce.date().optional(),
        roadTest: z
          .object({
            authorised: z.boolean().optional(),
            driver: z.string().optional(),
            startMileage: z.coerce.number().optional(),
          })
          .optional(),
      })
      .parse(req.body);
    const vehicle = await Vehicle.findOne(tenantFilter(req, { _id: input.vehicle }));
    if (!vehicle) throw httpError(404, 'Vehicle not found');
    const assignedTechnician = input.kind === 'intake' ? req.user : input.assignedTo
      ? await User.findOne(tenantFilter(req, { _id: input.assignedTo, active: true, operationalProfile: 'Senior Technician / Vehicle Inspector' }))
      : await User.findOne(tenantFilter(req, { active: true, operationalProfile: 'Senior Technician / Vehicle Inspector' })).sort({ createdAt: 1 });
    if (!assignedTechnician) throw httpError(400, 'Add an active Senior Technician before assigning a technical inspection');
    let template;
    let reportFindings = [];
    if (input.template) {
      template = await InspectionTemplate.findOne(tenantFilter(req, { _id: input.template, kind: input.kind, enabled: true }));
      if (!template) throw httpError(400, 'Inspection template is unavailable');
      reportFindings = template.questions.map((question) => ({
        questionId: question.questionId,
        category: question.category,
        title: question.title,
        required: question.required,
      }));
    }
    const inspection = await Inspection.create({
      ...input, assignedTo: assignedTechnician.id, dealership: req.tenantId,
      assignedBy: req.user.id,
      roadTest: { ...input.roadTest, authorisedBy: input.roadTest?.authorised ? req.user.id : undefined },
      findings: reportFindings,
      history: [{ type: 'assigned', message: `${input.kind} inspection assigned`, actor: req.user.id }],
    });
    res.status(201).json(inspection);
  } catch (error) {
    next(error);
  }
});
router.post('/inspections/:id/handoff-to-technician', permit('inspections:assign'), async (req, res, next) => {
  try {
    const intake = await Inspection.findOne(tenantFilter(req, { _id: req.params.id, kind: 'intake' }));
    if (!intake) throw httpError(404, 'Physical intake report not found');
    if (!ownOrDealer(req, intake.assignedTo)) throw httpError(403, 'Only the assigned Service Advisor can hand off this intake');
    if (intake.status !== 'Submitted') throw httpError(409, 'Complete and submit the physical intake before handing it to a Senior Technician');
    const existing = await Inspection.findOne(tenantFilter(req, { parentReport: intake.id, kind: 'mechanical' }));
    if (existing) return res.json(existing);
    const technician = await User.findOne(tenantFilter(req, { active: true, operationalProfile: 'Senior Technician / Vehicle Inspector' })).sort({ createdAt: 1 });
    if (!technician) throw httpError(400, 'Add an active Senior Technician before handoff');
    const technicalInspection = await Inspection.create({ dealership: req.tenantId, vehicle: intake.vehicle, kind: 'mechanical', assignedTo: technician.id, assignedBy: req.user.id, parentReport: intake.id, status: 'Assigned', history: [{ type: 'handoff', message: 'Physical intake submitted and handed to Senior Technician', actor: req.user.id }] });
    await Notification.create({ dealership: req.tenantId, recipient: technician.id, event: 'technical-inspection-assigned', title: 'Vehicle ready for technical inspection', body: 'Service Advisor completed physical intake. Perform engine, mechanical, structural, and road-test checks.', entityType: 'Inspection', entityId: String(technicalInspection.id) });
    res.status(201).json(technicalInspection);
  } catch (error) { next(error); }
});
router.get('/inspections/:id', permit('inspections:view_assigned'), async (req, res, next) => {
  try {
    const report = await Inspection.findOne(tenantFilter(req, { _id: req.params.id })).populate(
      'vehicle assignedTo assignedBy reviewer template parentReport'
    );
    if (!report) throw httpError(404, 'Inspection not found');
    if (!ownOrDealer(req, report.assignedTo)) throw httpError(403, 'Only the assigned employee may view this report');
    const revisions = await Inspection.find(tenantFilter(req, {
      $or: [{ _id: report.id }, { parentReport: report.parentReport || report.id }],
    }))
      .select('revision status revisionReason createdAt submittedAt reviewer')
      .sort({ revision: 1 });
    res.json({ report, revisions });
  } catch (error) {
    next(error);
  }
});
router.patch('/inspections/:id', permit('inspections:manage_assigned'), async (req, res, next) => {
  try {
    const input = z
      .object({
        findings: findings.optional(),
        roadTest: z
          .object({
            authorised: z.boolean().optional(),
            driver: z.string().optional(),
            startMileage: z.coerce.number().optional(),
            endMileage: z.coerce.number().optional(),
            observations: z.string().optional(),
          })
          .optional(),
        diagnostics: z
          .object({
            source: z.string().optional(),
            faultCodes: z.array(z.string()).optional(),
            notes: z.string().optional(),
          })
          .optional(),
        recommendation: z.enum(['Suitable to Acquire', 'Manager Review Required', 'Not Suitable']).optional(),
        status: z.enum(['In Progress']).optional(),
      })
      .parse(req.body);
    const report = await Inspection.findOne(tenantFilter(req, { _id: req.params.id }));
    if (!report) throw httpError(404, 'Inspection not found');
    if (!ownOrDealer(req, report.assignedTo)) throw httpError(403, 'Only the assigned employee may update this report');
    if (['Submitted', 'Reviewed'].includes(report.status))
      throw httpError(409, 'Create a revision to alter a submitted report');
    Object.assign(report, input);
    if (input.status === 'In Progress' && !report.startedAt) report.startedAt = new Date();
    report.history.push({ type: 'updated', message: 'Inspection findings updated', actor: req.user.id });
    await report.save();
    res.json(report);
  } catch (error) {
    next(error);
  }
});
router.post('/inspections/:id/submit', permit('inspections:manage_assigned'), async (req, res, next) => {
  try {
    const report = await Inspection.findOne(tenantFilter(req, { _id: req.params.id }));
    if (!report) throw httpError(404, 'Inspection not found');
    if (!ownOrDealer(req, report.assignedTo)) throw httpError(403, 'Only the assigned employee may submit this report');
    if (report.status === 'Submitted') return res.json(report);
    const unanswered = report.findings.filter((f) => f.required && f.result === 'Not Inspected');
    if (unanswered.length)
      throw httpError(400, `${unanswered.length} required inspection items remain uninspected`);
    report.status = 'Submitted';
    report.submittedAt = new Date();
    report.history.push({
      type: 'submitted',
      message: 'Inspection report submitted for review',
      actor: req.user.id,
    });
    await report.save();
    if (report.kind === 'mechanical') {
      let acquisition = await Acquisition.findOne(tenantFilter(req, { vehicle: report.vehicle }));
      if (!acquisition) {
        const enquiry = await Enquiry.findOne(tenantFilter(req, { vehicle: report.vehicle, type: 'seller' })).sort({ createdAt: -1 });
        acquisition = await Acquisition.create({
          dealership: req.tenantId,
          vehicle: report.vehicle,
          enquiry: enquiry?.id,
          proposedPrice: 0,
          expectedResale: 0,
          status: 'Valuation Requested',
          history: [{ type: 'technical-report-received', message: 'Senior Technician report submitted; Manager valuation required', actor: req.user.id }],
        });
      }
      const manager = await User.findOne(tenantFilter(req, { active: true, operationalProfile: 'Dealership Manager' })).sort({ createdAt: 1 });
      if (manager) await Notification.create({ dealership: req.tenantId, recipient: manager.id, event: 'technical-inspection-submitted', title: 'Seller vehicle ready for purchase decision', body: `Technical report submitted: ${report.recommendation || 'Manager Review Required'}. A manager acquisition case has been created.`, entityType: 'Acquisition', entityId: String(acquisition.id) });
    }
    res.json(report);
  } catch (error) {
    next(error);
  }
});
router.post('/inspections/:id/review', permit('inspections:review'), async (req, res, next) => {
  try {
    const { approved, note } = z
      .object({ approved: z.boolean(), note: z.string().max(2000).optional() })
      .parse(req.body);
    const report = await Inspection.findOne(tenantFilter(req, { _id: req.params.id }));
    if (!report) throw httpError(404, 'Inspection not found');
    if (report.status !== 'Submitted') throw httpError(400, 'Only submitted reports can be reviewed');
    report.status = approved ? 'Reviewed' : 'Reinspection Required';
    report.reviewer = req.user.id;
    report.reviewedAt = new Date();
    report.reviewNote = note;
    report.history.push({
      type: 'review',
      message: approved ? 'Inspection report reviewed' : 'Reinspection required',
      actor: req.user.id,
    });
    await report.save();
    res.json(report);
  } catch (error) {
    next(error);
  }
});
router.post('/inspections/:id/revision', permit('inspections:assign'), async (req, res, next) => {
  try {
    const { reason } = z.object({ reason: z.string().min(3).max(2000) }).parse(req.body);
    const previous = await Inspection.findOne(tenantFilter(req, { _id: req.params.id }));
    if (!previous) throw httpError(404, 'Inspection not found');
    const rootReport = previous.parentReport || previous.id;
    const latest = await Inspection.findOne(tenantFilter(req, {
      $or: [{ _id: rootReport }, { parentReport: rootReport }],
    })).sort({ revision: -1 });
    if (!latest || !['Submitted', 'Reviewed', 'Reinspection Required'].includes(latest.status))
      throw httpError(400, 'Only reviewed or submitted reports can be revised');
    const revision = await Inspection.create({
      ...latest.toObject(),
      _id: undefined,
      id: undefined,
      createdAt: undefined,
      updatedAt: undefined,
      status: 'Assigned',
      revision: latest.revision + 1,
      parentReport: rootReport,
      revisionReason: reason,
      assignedBy: req.user.id,
      assignedAt: new Date(),
      startedAt: undefined,
      submittedAt: undefined,
      reviewedAt: undefined,
      reviewer: undefined,
      reviewNote: undefined,
      history: [
        {
          type: 'revision',
          message: `Revision ${latest.revision + 1} created: ${reason}`,
          actor: req.user.id,
        },
      ],
    });
    res.status(201).json(revision);
  } catch (error) {
    next(error);
  }
});
export default router;
