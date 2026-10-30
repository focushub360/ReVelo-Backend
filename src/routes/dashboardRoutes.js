import { Router } from 'express';
import { Vehicle } from '../models/vehicle.js';
import { Enquiry } from '../models/enquiry.js';
import { Document } from '../models/document.js';
import { ParkingSlot } from '../models/parkingSlot.js';
import { WorkOrder } from '../models/workOrder.js';
import { Notification } from '../models/notification.js';
import { Acquisition } from '../models/acquisition.js';
import { Sale } from '../models/sale.js';
import { QualityCheck } from '../models/qualityCheck.js';
import { Inspection } from '../models/inspection.js';
import { Audit } from '../models/audit.js';
import { User } from '../models/user.js';
import { tenantFilter } from '../middleware/tenant.js';

const router = Router();

router.get('/dashboard', async (req, res, next) => {
  try {
    const scope = tenantFilter(req);
    const [
      vehicles,
      newSellerEnquiries,
      pendingDocuments,
      awaitingInspection,
      onHold,
      pendingAcquisitions,
      purchased,
      workInProgress,
      awaitingQa,
      readyForSale,
      slots,
      activeBuyerEnquiries,
      purchases,
      sales,
      profit,
      lifecycleBreakdown,
      openWorkOrders,
      recentActivity,
      employees,
    ] = await Promise.all([
      Vehicle.countDocuments(scope), Enquiry.countDocuments({ ...scope, type: 'seller', status: 'Open' }),
      Document.countDocuments({ ...scope, status: { $in: ['Submitted', 'Under Review', 'On Hold', 'Mismatch'] } }),
      Vehicle.countDocuments({ ...scope, lifecycle: { $in: ['Enquiry Created', 'Verification Pending'] } }), Vehicle.countDocuments({ ...scope, lifecycle: 'On Hold' }),
      Acquisition.countDocuments({ ...scope, status: { $in: ['Valuation Requested', 'Revised Valuation Requested'] } }), Vehicle.countDocuments({ ...scope, lifecycle: 'Purchased Inventory' }),
      WorkOrder.countDocuments({
        ...scope, status: { $in: ['Assigned', 'In Progress', 'Waiting for Parts', 'Rework Required'] },
      }),
      QualityCheck.countDocuments({
        ...scope, status: { $in: ['Assigned', 'In Progress', 'Reinspection', 'Rework Required'] },
      }),
      Vehicle.countDocuments({ ...scope, lifecycle: 'Ready for Sale' }), ParkingSlot.aggregate([{ $match: scope }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      Enquiry.countDocuments({ ...scope, type: 'buyer', status: { $in: ['Open', 'Contacted', 'On Hold'] } }), Acquisition.countDocuments({ ...scope, status: 'Purchased' }), Sale.countDocuments({ ...scope, status: 'Closed' }),
      Sale.aggregate([
        { $match: { ...scope, status: 'Closed' } },
        { $group: { _id: null, realised: { $sum: '$actualProfit' } } },
      ]),
      Vehicle.aggregate([{ $match: scope }, { $group: { _id: '$lifecycle', count: { $sum: 1 } } }]),
      WorkOrder.find({ ...scope, status: { $in: ['Open', 'Assigned', 'In Progress', 'Waiting for Parts', 'Rework Required'] } })
        .sort({ updatedAt: -1 }).limit(5).select('workOrderCode title priority status updatedAt').populate('vehicle', 'registration make model vehicleCode').lean(),
      Audit.find(scope).sort({ createdAt: -1 }).limit(6).select('action entity actorName createdAt').lean(),
      User.countDocuments({ ...scope, active: true }),
    ]);
    res.json({
      vehicles,
      newSellerEnquiries,
      pendingDocuments,
      awaitingInspection,
      onHold,
      pendingAcquisitions,
      purchasedAwaitingRepairs: purchased,
      workInProgress,
      awaitingQa,
      readyForSale,
      slots,
      activeBuyerEnquiries,
      completedPurchases: purchases,
      completedSales: sales,
      realisedProfit: profit[0]?.realised || 0,
      lifecycleBreakdown,
      openWorkOrders,
      recentActivity,
      activeEmployees: employees,
    });
  } catch (error) {
    next(error);
  }
});
router.get('/notifications', async (req, res, next) => {
  try {
    res.json(await Notification.find(tenantFilter(req, { recipient: req.user.id })).sort({ createdAt: -1 }).limit(50));
  } catch (error) {
    next(error);
  }
});
router.patch('/notifications/:id/read', async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user.id },
      { read: true, readAt: new Date() },
      { new: true }
    );
    if (!notification) return res.status(404).json({ error: { message: 'Notification not found' } });
    res.json(notification);
  } catch (error) {
    next(error);
  }
});
router.post('/notifications/refresh', async (req, res, next) => {
  try {
    const now = new Date();
    const [inspections, workOrders, followUps] = await Promise.all([
      Inspection.find({ assignedTo: req.user.id, status: { $in: ['Assigned', 'In Progress'] } }),
      WorkOrder.find({
        assignedTo: req.user.id,
        status: { $in: ['Assigned', 'In Progress', 'Waiting for Parts', 'Rework Required'] },
      }),
      Enquiry.find({
        assignedTo: req.user.id,
        followUp: { $lte: now },
        status: { $in: ['Open', 'Contacted', 'On Hold'] },
      }),
    ]);
    const candidates = [
      ...inspections
        .filter((x) => x.dueDate && x.dueDate < now)
        .map((x) => ({
          event: 'overdue-inspection',
          title: 'Inspection overdue',
          body: `Inspection ${x.id} is overdue.`,
          entityType: 'Inspection',
          entityId: x.id,
        })),
      ...workOrders
        .filter(
          (x) =>
            x.status === 'Rework Required' ||
            (x.createdAt < new Date(now - 7 * 864e5) && x.status !== 'Completed')
        )
        .map((x) => ({
          event: 'delayed-repair',
          title: 'Repair attention needed',
          body: `Work order ${x.workOrderCode} needs attention.`,
          entityType: 'WorkOrder',
          entityId: x.id,
        })),
      ...followUps.map((x) => ({
        event: 'buyer-follow-up',
        title: 'Follow-up due',
        body: `Enquiry ${x.enquiryCode} requires follow-up.`,
        entityType: 'Enquiry',
        entityId: x.id,
      })),
    ];
    for (const item of candidates) {
      const exists = await Notification.exists({
        recipient: req.user.id,
        event: item.event,
        entityId: item.entityId,
        read: false,
      });
      if (!exists)
        await Notification.create({
          ...item,
          recipient: req.user.id,
          link: `/${item.entityType.toLowerCase()}s/${item.entityId}`,
        });
    }
    res.json(await Notification.find({ recipient: req.user.id, read: false }).sort({ createdAt: -1 }));
  } catch (error) {
    next(error);
  }
});

export default router;
