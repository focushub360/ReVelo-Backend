import { Router } from 'express';
import { z } from 'zod';
import { WorkOrder } from '../models/workOrder.js';
import { QualityCheck } from '../models/qualityCheck.js';
import { Inspection } from '../models/inspection.js';
import { Acquisition } from '../models/acquisition.js';
import { Vehicle } from '../models/vehicle.js';
import { ParkingSlot } from '../models/parkingSlot.js';
import { User } from '../models/user.js';
import { Notification } from '../models/notification.js';
import { Audit } from '../models/audit.js';
import { permit } from '../middleware/permit.js';
import { audit, id, httpError } from '../utils/core.js';
import { paginatedQuery } from '../utils/pagination.js';
import { tenantFilter, ownOrDealer } from '../middleware/tenant.js';
const router = Router();
const canOverseeWorkOrders = (req) => req.user.role === 'Dealer Admin' || req.user.operationalProfile === 'Dealership Manager';
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
router.get('/work-orders', permit('workorders:view_assigned'), paginatedQuery(WorkOrder, (req) =>
  canOverseeWorkOrders(req) ? {} : { assignedTo: req.user.id }
));
router.post('/work-orders/:id/manager-handover', permit('workorders:manage_assigned'), async (req, res, next) => {
  try {
    if (!canOverseeWorkOrders(req)) throw httpError(403, 'Only the Dealership Manager can complete this handover');
    const body = z.object({ phase: z.enum(['allocated', 'quality-passed']) }).parse(req.body);
    const workOrder = await WorkOrder.findOne(tenantFilter(req, { _id: req.params.id, status: 'Completed' }));
    if (!workOrder) throw httpError(404, 'Completed refurbishment handover not found');
    if (body.phase === 'allocated') {
      const vehicle = await Vehicle.findOne(tenantFilter(req, { _id: workOrder.vehicle }));
      const slot = await ParkingSlot.findOne(tenantFilter(req, { _id: vehicle?.currentLocation, type: 'selling', status: 'Occupied', activeVehicle: workOrder.vehicle }));
      if (!slot) throw httpError(400, 'Move the vehicle to an occupied Selling Slot before confirming allocation');
      workOrder.managerHandover.sellingSlot = slot.id;
      workOrder.managerHandover.allocatedAt = new Date();
      workOrder.managerHandover.allocatedBy = req.user.id;
      workOrder.managerHandover.qualityStatus = 'Pending';
    } else {
      if (!workOrder.managerHandover?.sellingSlot) throw httpError(400, 'Allocate a Selling Slot before passing final quality control');
      workOrder.managerHandover.qualityStatus = 'Passed';
      workOrder.managerHandover.qualityCheckedAt = new Date();
      workOrder.managerHandover.qualityCheckedBy = req.user.id;
    }
    await workOrder.save();
    res.json(workOrder);
  } catch (error) { next(error); }
});
router.get('/work-orders/eligible-vehicles', permit('workorders:manage_assigned'), async (req, res, next) => {
  try {
    if (!canOverseeWorkOrders(req)) throw httpError(403, 'Only a Dealership Manager can create refurbishment work orders');
    const acquisitions = await Acquisition.find(
      tenantFilter(req, { status: 'Purchased' })
    )
      .select('vehicle')
      .populate('vehicle', 'registration vehicleCode make model variant')
      .sort({ createdAt: -1 })
      .lean();
    res.json(acquisitions.map((acquisition) => acquisition.vehicle).filter(Boolean));
  } catch (error) {
    next(error);
  }
});
router.post('/work-orders', permit('workorders:manage_assigned'), async (req, res, next) => {
  try {
    if (!canOverseeWorkOrders(req)) throw httpError(403, 'Only a Dealership Manager can create refurbishment work orders');
    const input = workOrderInput.parse(req.body);
    const acquisition = await Acquisition.findOne(tenantFilter(req, { vehicle: input.vehicle, status: 'Purchased' }));
    if (!acquisition) throw httpError(400, 'Work orders require purchased inventory');
    const workOrder = await WorkOrder.create({
      ...input, dealership: req.tenantId,
      acquisition: acquisition.id,
      workOrderCode: id('WO'),
      status: input.assignedTo ? 'Assigned' : 'Open',
      history: [{ type: 'created', message: 'Work order created', actor: req.user.id }],
    });
    await Vehicle.findOneAndUpdate(tenantFilter(req, { _id: input.vehicle }), { lifecycle: 'Under Refurbishment' });
    res.status(201).json(workOrder);
  } catch (error) {
    next(error);
  }
});
router.post('/work-orders/from-inspection/:inspectionId', permit('workorders:manage_assigned'), async (req, res, next) => {
  try {
    const inspection = await Inspection.findOne(tenantFilter(req, { _id: req.params.inspectionId }));
    if (!inspection) throw httpError(404, 'Inspection not found');
    const acquisition = await Acquisition.findOne(tenantFilter(req, { vehicle: inspection.vehicle, status: 'Purchased' }));
    if (!acquisition) throw httpError(400, 'Vehicle has not been purchased');
    const created = [];
    for (const finding of inspection.findings.filter((f) => f.result === 'Inspected' && ['High', 'Critical'].includes(f.severity))) {
      created.push(
        await WorkOrder.create({
          dealership: req.tenantId, workOrderCode: id('WO'),
          vehicle: inspection.vehicle,
          acquisition: acquisition.id,
          inspection: inspection.id,
          fault: finding.title,
          title: finding.recommendedAction || `Repair: ${finding.title}`,
          description: finding.notes,
          priority: finding.severity === 'Critical' ? 'Critical' : 'High',
          estimatedParts: finding.estimatedRepairCost || 0,
          reinspectionRequired: finding.severity === 'Critical',
          history: [{ type: 'created', message: 'Generated from inspection finding', actor: req.user.id }],
        })
      );
    }
    await Vehicle.findOneAndUpdate(tenantFilter(req, { _id: inspection.vehicle }), { lifecycle: 'Under Refurbishment' });
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});
router.get('/work-orders/:id', permit('workorders:view_assigned'), async (req, res, next) => {
  try {
    const workOrder = await WorkOrder.findOne(tenantFilter(req, { _id: req.params.id })).populate(
      'vehicle acquisition inspection assignedTo'
    );
    if (!workOrder) throw httpError(404, 'Work order not found');
    if (!canOverseeWorkOrders(req) && !ownOrDealer(req, workOrder.assignedTo)) throw httpError(403, 'Only the assigned technician may view this work order');
    res.json(workOrder);
  } catch (error) {
    next(error);
  }
});
router.patch('/work-orders/:id', permit('workorders:manage_assigned'), async (req, res, next) => {
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
    const workOrder = await WorkOrder.findOne(tenantFilter(req, { _id: req.params.id }));
    if (!workOrder) throw httpError(404, 'Work order not found');
    if (!canOverseeWorkOrders(req) && !ownOrDealer(req, workOrder.assignedTo)) throw httpError(403, 'Only the assigned technician may update this work order');
    Object.assign(workOrder, body);
    if (body.status === 'In Progress' && !workOrder.startedAt) workOrder.startedAt = new Date();
    if (body.status === 'Completed') workOrder.completedAt = new Date();
    workOrder.history.push({
      type: 'updated',
      message: `Work order updated${body.status ? `: ${body.status}` : ''}`,
      actor: req.user.id,
    });
    await workOrder.save();
    await audit(Audit, req.user.id, 'REFURBISHMENT_HANDOVER_SUBMITTED', 'WorkOrder', workOrder.id, { workCompleted: body.workCompleted, readyForManager: true }, { dealership: req.tenantId, actorName: req.user.name, operationalProfile: req.user.operationalProfile, requestId: req.requestId });
    res.json(workOrder);
  } catch (error) {
    next(error);
  }
});
router.post('/work-orders/:id/technician-estimate', permit('workorders:manage_assigned'), async (req, res, next) => {
  try {
    const body = z.object({
      diagnosis: z.string().min(3).max(3000), repairPlan: z.string().min(3).max(3000), partsRequired: z.string().max(3000).optional(),
      estimatedLabour: z.coerce.number().min(0), estimatedParts: z.coerce.number().min(0), estimatedDays: z.coerce.number().int().min(0).max(365), safetyNotes: z.string().max(2000).optional(),
    }).parse(req.body);
    const workOrder = await WorkOrder.findOne(tenantFilter(req, { _id: req.params.id }));
    if (!workOrder) throw httpError(404, 'Work order not found');
    if (!ownOrDealer(req, workOrder.assignedTo)) throw httpError(403, 'Only the assigned Refurbishment Technician may submit this estimate');
    workOrder.estimatedLabour = body.estimatedLabour;
    workOrder.estimatedParts = body.estimatedParts;
    workOrder.technicianEstimate = { diagnosis: body.diagnosis, repairPlan: body.repairPlan, partsRequired: body.partsRequired, estimatedDays: body.estimatedDays, safetyNotes: body.safetyNotes, submittedAt: new Date(), submittedBy: req.user.id };
    workOrder.status = 'Estimate Submitted';
    workOrder.history.push({ type: 'technician-estimate-submitted', message: `Estimate submitted: labour ${body.estimatedLabour}, parts ${body.estimatedParts}`, actor: req.user.id });
    await workOrder.save();
    const managers = await User.find({ dealership: req.tenantId, active: true, operationalProfile: 'Dealership Manager' }).select('_id');
    if (managers.length) await Notification.insertMany(managers.map((manager) => ({ dealership: req.tenantId, recipient: manager.id, event: 'REFURBISHMENT_ESTIMATE_SUBMITTED', title: 'Refurbishment estimate submitted', body: `${workOrder.title} is ready for manager review.`, link: '/work-orders', entityType: 'WorkOrder', entityId: workOrder.id })));
    res.json(workOrder);
  } catch (error) { next(error); }
});
router.post('/work-orders/:id/estimate-decision', permit('workorders:manage_assigned'), async (req, res, next) => {
  try {
    if (!canOverseeWorkOrders(req)) throw httpError(403, 'Only a Dealership Manager can review a technician estimate');
    const body = z.object({ action: z.enum(['approve', 'revision', 'cancel']), reason: z.string().max(2000).optional() }).parse(req.body);
    if (['revision', 'cancel'].includes(body.action) && !body.reason?.trim()) throw httpError(400, 'Enter a clear reason for the technician');
    const workOrder = await WorkOrder.findOne(tenantFilter(req, { _id: req.params.id }));
    if (!workOrder || workOrder.status !== 'Estimate Submitted') throw httpError(400, 'This work order does not have an estimate awaiting review');
    const decision = body.action === 'approve' ? 'Approved' : body.action === 'revision' ? 'Revision Requested' : 'Cancelled';
    workOrder.managerEstimateReview = { decision, reason: body.reason?.trim(), reviewedAt: new Date(), reviewedBy: req.user.id };
    workOrder.status = body.action === 'approve' ? 'Manager Approved' : body.action === 'revision' ? 'Estimate Revision Requested' : 'Cancelled';
    workOrder.history.push({ type: 'manager-estimate-decision', message: `${decision}${body.reason ? `: ${body.reason.trim()}` : ''}`, actor: req.user.id });
    await workOrder.save();
    if (workOrder.assignedTo) await Notification.create({ dealership: req.tenantId, recipient: workOrder.assignedTo, event: 'REFURBISHMENT_ESTIMATE_REVIEWED', title: `Estimate ${decision.toLowerCase()}`, body: body.reason?.trim() || `${workOrder.title} estimate was approved. You may begin work.`, link: '/work-orders', entityType: 'WorkOrder', entityId: workOrder.id });
    res.json(workOrder);
  } catch (error) { next(error); }
});
router.post('/work-orders/:id/complete-handover', permit('workorders:manage_assigned'), async (req, res, next) => {
  try {
    const body = z.object({ workCompleted: z.string().min(3).max(4000), completionNotes: z.string().min(3).max(4000), readyForManager: z.literal(true) }).parse(req.body);
    const workOrder = await WorkOrder.findOne(tenantFilter(req, { _id: req.params.id }));
    if (!workOrder) throw httpError(404, 'Work order not found');
    if (!ownOrDealer(req, workOrder.assignedTo)) throw httpError(403, 'Only the assigned Refurbishment Technician may complete this job');
    if (!['Manager Approved', 'In Progress'].includes(workOrder.status)) throw httpError(400, 'Manager approval is required before work can be completed');
    workOrder.technicianCompletion = { ...body, submittedAt: new Date(), submittedBy: req.user.id };
    workOrder.status = 'Completed';
    workOrder.completedAt = new Date();
    workOrder.history.push({ type: 'technician-completion-submitted', message: 'Completed work submitted for manager handover and selling-slot allocation', actor: req.user.id });
    await workOrder.save();
    const managers = await User.find({ dealership: req.tenantId, active: true, operationalProfile: 'Dealership Manager' }).select('_id');
    if (managers.length) await Notification.insertMany(managers.map((manager) => ({ dealership: req.tenantId, recipient: manager.id, event: 'REFURBISHMENT_COMPLETED', title: 'Vehicle ready for manager handover', body: `${workOrder.title} is completed. Review the technician handover and move the vehicle to a selling slot.`, link: '/work-orders', entityType: 'WorkOrder', entityId: workOrder.id })));
    res.json(workOrder);
  } catch (error) { next(error); }
});
router.post('/work-orders/:id/expenses', permit('workorders:manage_assigned'), async (req, res, next) => {
  try {
    const expense = z
      .object({
        type: z.enum(['Parts', 'Labour', 'Other']),
        description: z.string().min(2),
        amount: z.coerce.number().min(0),
        reference: z.string().optional(),
      })
      .parse(req.body);
    const workOrder = await WorkOrder.findOne(tenantFilter(req, { _id: req.params.id }));
    if (!workOrder) throw httpError(404, 'Work order not found');
    if (!canOverseeWorkOrders(req) && !ownOrDealer(req, workOrder.assignedTo)) throw httpError(403, 'Only the assigned technician may record expenses');
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
router.post('/work-orders/:id/scope', permit('workorders:manage_assigned'), async (req, res, next) => {
  try {
    const change = z
      .object({
        reason: z.string().min(3),
        description: z.string().min(3),
        estimatedLabour: z.coerce.number().min(0).optional(),
        estimatedParts: z.coerce.number().min(0).optional(),
      })
      .parse(req.body);
    const workOrder = await WorkOrder.findOne(tenantFilter(req, { _id: req.params.id }));
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
router.get('/quality-checks', permit('qa:review'), paginatedQuery(QualityCheck));
router.post('/quality-checks', permit('qa:review'), async (req, res, next) => {
  try {
    const body = z
      .object({
        vehicle: z.string(),
        assignedTo: z.string().optional(),
        checks: z.array(z.object({ title: z.string().min(2), required: z.boolean().optional() })).min(1),
      })
      .parse(req.body);
    const incomplete = await WorkOrder.exists({
      ...tenantFilter(req), vehicle: body.vehicle,
      status: { $nin: ['Completed', 'Cancelled'] },
    });
    if (incomplete)
      throw httpError(400, 'Complete or cancel all applicable work orders before final quality control');
    res.status(201).json(
      await QualityCheck.create({
        ...body, assignedTo: body.assignedTo || req.user.id, dealership: req.tenantId,
        history: [{ type: 'assigned', message: 'Final quality control assigned', actor: req.user.id }],
      })
    );
  } catch (error) {
    next(error);
  }
});
router.patch('/quality-checks/:id', permit('qa:review'), async (req, res, next) => {
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
    const qa = await QualityCheck.findOne(tenantFilter(req, { _id: req.params.id }));
    if (!qa) throw httpError(404, 'Quality check not found');
    Object.assign(qa, body);
    await qa.save();
    res.json(qa);
  } catch (error) {
    next(error);
  }
});
router.post('/quality-checks/:id/decision', permit('qa:review'), async (req, res, next) => {
  try {
    const { passed, note } = z
      .object({ passed: z.boolean(), note: z.string().max(2000).optional() })
      .parse(req.body);
    const qa = await QualityCheck.findOne(tenantFilter(req, { _id: req.params.id }));
    if (!qa) throw httpError(404, 'Quality check not found');
    const open = await WorkOrder.exists(tenantFilter(req, {
      vehicle: qa.vehicle,
      status: { $nin: ['Completed', 'Cancelled'] },
    }));
    const critical = await WorkOrder.exists(tenantFilter(req, {
      vehicle: qa.vehicle,
      priority: 'Critical',
      status: { $ne: 'Completed' },
    }));
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
    await Vehicle.findOneAndUpdate(tenantFilter(req, { _id: qa.vehicle }), {
      lifecycle: passed ? 'Ready for Sale' : 'Under Refurbishment',
    });
    if (!passed)
      await WorkOrder.updateMany(
        tenantFilter(req, { vehicle: qa.vehicle, status: 'Completed', reinspectionRequired: true }),
        { $set: { status: 'Rework Required' } }
      );
    res.json(qa);
  } catch (error) {
    next(error);
  }
});
export default router;
