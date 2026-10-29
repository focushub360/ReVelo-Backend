import { Router } from 'express';
import { z } from 'zod';
import { WorkOrder } from '../models/workOrder.js';
import { QualityCheck } from '../models/qualityCheck.js';
import { Inspection } from '../models/inspection.js';
import { Acquisition } from '../models/acquisition.js';
import { Vehicle } from '../models/vehicle.js';
import { permit } from '../middleware/permit.js';
import { id, httpError } from '../utils/core.js';
import { paginatedQuery } from '../utils/pagination.js';
const router = Router();
const statuses = [
  'Open',
  'Assigned',
  'In Progress',
  'Waiting for Parts',
  'Completed',
  'Rework Required',
  'Cancelled',
];
const workOrderInput = z.object({
  vehicle: z.string(),
  acquisition: z.string().optional(),
  inspection: z.string().optional(),
  fault: z.string().optional(),
  title: z.string().min(2),
  description: z.string().optional(),
  priority: z.enum(['Low', 'Medium', 'High', 'Critical']).optional(),
  assignedTo: z.string().optional(),
  estimatedLabour: z.coerce.number().min(0).optional(),
  estimatedParts: z.coerce.number().min(0).optional(),
  notes: z.string().optional(),
  reinspectionRequired: z.boolean().optional(),
});
router.get('/work-orders', permit('workorders'), paginatedQuery(WorkOrder));
router.post('/work-orders', permit('workorders'), async (req, res, next) => {
  try {
    const input = workOrderInput.parse(req.body);
    const acquisition = await Acquisition.findOne({ vehicle: input.vehicle, status: 'Purchased' });
    if (!acquisition) throw httpError(400, 'Work orders require purchased inventory');
    const workOrder = await WorkOrder.create({
      ...input,
      acquisition: input.acquisition || acquisition.id,
      workOrderCode: id('WO'),
      status: input.assignedTo ? 'Assigned' : 'Open',
      history: [{ type: 'created', message: 'Work order created', actor: req.user.id }],
    });
    await Vehicle.findByIdAndUpdate(input.vehicle, { lifecycle: 'Under Refurbishment' });
    res.status(201).json(workOrder);
  } catch (error) {
    next(error);
  }
});
router.post('/work-orders/from-inspection/:inspectionId', permit('workorders'), async (req, res, next) => {
  try {
    const inspection = await Inspection.findById(req.params.inspectionId);
    if (!inspection) throw httpError(404, 'Inspection not found');
    const acquisition = await Acquisition.findOne({ vehicle: inspection.vehicle, status: 'Purchased' });
    if (!acquisition) throw httpError(400, 'Vehicle has not been purchased');
    const created = [];
    for (const finding of inspection.findings.filter((f) => ['Fail', 'Critical'].includes(f.result))) {
      created.push(
        await WorkOrder.create({
          workOrderCode: id('WO'),
          vehicle: inspection.vehicle,
          acquisition: acquisition.id,
          inspection: inspection.id,
          fault: finding.title,
          title: finding.recommendedAction || `Repair: ${finding.title}`,
          description: finding.notes,
          priority: finding.result === 'Critical' ? 'Critical' : 'High',
          estimatedParts: finding.estimatedRepairCost || 0,
          reinspectionRequired: finding.result === 'Critical',
          history: [{ type: 'created', message: 'Generated from inspection finding', actor: req.user.id }],
        })
      );
    }
    await Vehicle.findByIdAndUpdate(inspection.vehicle, { lifecycle: 'Under Refurbishment' });
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});
router.get('/work-orders/:id', permit('workorders'), async (req, res, next) => {
  try {
    const workOrder = await WorkOrder.findById(req.params.id).populate(
      'vehicle acquisition inspection assignedTo'
    );
    if (!workOrder) throw httpError(404, 'Work order not found');
    res.json(workOrder);
  } catch (error) {
    next(error);
  }
});
router.patch('/work-orders/:id', permit('workorders'), async (req, res, next) => {
  try {
    const body = z
      .object({
        assignedTo: z.string().optional(),
        status: z.enum(statuses).optional(),
        notes: z.string().optional(),
        evidence: z.array(z.string()).optional(),
        reinspectionRequired: z.boolean().optional(),
      })
      .parse(req.body);
    const workOrder = await WorkOrder.findById(req.params.id);
    if (!workOrder) throw httpError(404, 'Work order not found');
    Object.assign(workOrder, body);
    if (body.status === 'In Progress' && !workOrder.startedAt) workOrder.startedAt = new Date();
    if (body.status === 'Completed') workOrder.completedAt = new Date();
    workOrder.history.push({
      type: 'updated',
      message: `Work order updated${body.status ? `: ${body.status}` : ''}`,
      actor: req.user.id,
    });
    await workOrder.save();
    res.json(workOrder);
  } catch (error) {
    next(error);
  }
});
router.post('/work-orders/:id/expenses', permit('workorders'), async (req, res, next) => {
  try {
    const expense = z
      .object({
        type: z.enum(['Parts', 'Labour', 'Other']),
        description: z.string().min(2),
        amount: z.coerce.number().min(0),
        reference: z.string().optional(),
      })
      .parse(req.body);
    const workOrder = await WorkOrder.findById(req.params.id);
    if (!workOrder) throw httpError(404, 'Work order not found');
    workOrder.expenses.push({ ...expense, recordedBy: req.user.id });
    if (expense.type === 'Labour') workOrder.actualLabour += expense.amount;
    if (expense.type === 'Parts') workOrder.actualParts += expense.amount;
    workOrder.history.push({
      type: 'expense',
      message: `${expense.type} expense recorded`,
      actor: req.user.id,
    });
    await workOrder.save();
    res.status(201).json(workOrder);
  } catch (error) {
    next(error);
  }
});
router.post('/work-orders/:id/scope', permit('workorders'), async (req, res, next) => {
  try {
    const change = z
      .object({
        reason: z.string().min(3),
        description: z.string().min(3),
        estimatedLabour: z.coerce.number().min(0).optional(),
        estimatedParts: z.coerce.number().min(0).optional(),
      })
      .parse(req.body);
    const workOrder = await WorkOrder.findById(req.params.id);
    if (!workOrder) throw httpError(404, 'Work order not found');
    if (change.estimatedLabour !== undefined) workOrder.estimatedLabour = change.estimatedLabour;
    if (change.estimatedParts !== undefined) workOrder.estimatedParts = change.estimatedParts;
    workOrder.scopeChanges.push({
      reason: change.reason,
      description: change.description,
      authorisedBy: req.user.id,
    });
    workOrder.history.push({ type: 'scope change', message: change.reason, actor: req.user.id });
    await workOrder.save();
    res.json(workOrder);
  } catch (error) {
    next(error);
  }
});
router.get('/quality-checks', permit('quality'), paginatedQuery(QualityCheck));
router.post('/quality-checks', permit('quality'), async (req, res, next) => {
  try {
    const body = z
      .object({
        vehicle: z.string(),
        assignedTo: z.string(),
        checks: z.array(z.object({ title: z.string().min(2), required: z.boolean().optional() })).min(1),
      })
      .parse(req.body);
    const incomplete = await WorkOrder.exists({
      vehicle: body.vehicle,
      status: { $nin: ['Completed', 'Cancelled'] },
    });
    if (incomplete)
      throw httpError(400, 'Complete or cancel all applicable work orders before final quality control');
    res.status(201).json(
      await QualityCheck.create({
        ...body,
        history: [{ type: 'assigned', message: 'Final quality control assigned', actor: req.user.id }],
      })
    );
  } catch (error) {
    next(error);
  }
});
router.patch('/quality-checks/:id', permit('quality'), async (req, res, next) => {
  try {
    const body = z
      .object({
        checks: z
          .array(
            z.object({
              title: z.string(),
              required: z.boolean().optional(),
              passed: z.boolean(),
              notes: z.string().optional(),
              evidence: z.array(z.string()).optional(),
            })
          )
          .optional(),
        status: z.enum(['In Progress']).optional(),
      })
      .parse(req.body);
    const qa = await QualityCheck.findById(req.params.id);
    if (!qa) throw httpError(404, 'Quality check not found');
    Object.assign(qa, body);
    await qa.save();
    res.json(qa);
  } catch (error) {
    next(error);
  }
});
router.post('/quality-checks/:id/decision', permit('quality'), async (req, res, next) => {
  try {
    const { passed, note } = z
      .object({ passed: z.boolean(), note: z.string().max(2000).optional() })
      .parse(req.body);
    const qa = await QualityCheck.findById(req.params.id);
    if (!qa) throw httpError(404, 'Quality check not found');
    const open = await WorkOrder.exists({
      vehicle: qa.vehicle,
      status: { $nin: ['Completed', 'Cancelled'] },
    });
    const critical = await WorkOrder.exists({
      vehicle: qa.vehicle,
      priority: 'Critical',
      status: { $ne: 'Completed' },
    });
    const failedRequired = qa.checks.some((c) => c.required && !c.passed);
    if (passed && (open || critical || failedRequired))
      throw httpError(400, 'Required work orders and quality checks must pass');
    qa.status = passed ? 'Pass' : 'Rework Required';
    qa.workOrdersClosed = !open;
    qa.criticalFaultsResolved = !critical;
    qa.safetyChecksPassed = !failedRequired;
    qa.reviewedBy = req.user.id;
    qa.reviewedAt = new Date();
    qa.history.push({
      type: 'decision',
      message: passed ? 'Quality control passed' : `Quality control failed${note ? `: ${note}` : ''}`,
      actor: req.user.id,
    });
    await qa.save();
    await Vehicle.findByIdAndUpdate(qa.vehicle, {
      lifecycle: passed ? 'Ready for Sale' : 'Under Refurbishment',
    });
    if (!passed)
      await WorkOrder.updateMany(
        { vehicle: qa.vehicle, status: 'Completed', reinspectionRequired: true },
        { $set: { status: 'Rework Required' } }
      );
    res.json(qa);
  } catch (error) {
    next(error);
  }
});
export default router;
