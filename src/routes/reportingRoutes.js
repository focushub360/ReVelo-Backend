import { Router } from 'express';
import { Vehicle } from '../models/vehicle.js';
import { Enquiry } from '../models/enquiry.js';
import { Document } from '../models/document.js';
import { Inspection } from '../models/inspection.js';
import { Movement } from '../models/movement.js';
import { Acquisition } from '../models/acquisition.js';
import { AcquisitionOffer } from '../models/acquisitionOffer.js';
import { WorkOrder } from '../models/workOrder.js';
import { QualityCheck } from '../models/qualityCheck.js';
import { Sale } from '../models/sale.js';
import { ParkingSlot } from '../models/parkingSlot.js';
import { permit } from '../middleware/permit.js';
import { httpError } from '../utils/core.js';
import { tenantFilter } from '../middleware/tenant.js';
const router = Router();
const csvValue = (value) => {
  const safe = String(value ?? '')
    .replace(/"/g, '""')
    .replace(/^[=+\-@]/, "'$&");
  return `"${safe}"`;
};
router.get('/vehicles/:id/history', permit('vehicles'), async (req, res, next) => {
  try {
    const scope = tenantFilter(req);
    const vehicle = await Vehicle.findOne({ ...scope, _id: req.params.id });
    if (!vehicle) throw httpError(404, 'Vehicle not found');
    const [enquiries, documents, inspections, movements, acquisition, workOrders, qualityChecks, sales] =
      await Promise.all([
        Enquiry.find({ ...scope, vehicle: vehicle.id }), Document.find({ ...scope, vehicle: vehicle.id }),
        Inspection.find({ ...scope, vehicle: vehicle.id }), Movement.find({ ...scope, vehicle: vehicle.id }),
        Acquisition.findOne({ ...scope, vehicle: vehicle.id }), WorkOrder.find({ ...scope, vehicle: vehicle.id }),
        QualityCheck.find({ ...scope, vehicle: vehicle.id }), Sale.find({ ...scope, vehicle: vehicle.id }),
      ]);
    const offers = acquisition ? await AcquisitionOffer.find({ dealership: req.tenantId, acquisition: acquisition.id }) : [];
    const events = [];
    const add = (items, type, recordType, summary) =>
      items.forEach((item) =>
        events.push({ at: item.createdAt, type, recordType, recordId: item.id, summary: summary(item) })
      );
    add(enquiries, 'Seller / buyer enquiry', 'Enquiry', (x) => x.enquiryCode);
    add(documents, 'Document submitted', 'Document', (x) => `${x.category}: ${x.status}`);
    add(inspections, 'Inspection', 'Inspection', (x) => `${x.kind}: ${x.status}`);
    add(movements, 'Parking movement', 'Movement', (x) => x.action);
    if (acquisition)
      events.push({
        at: acquisition.createdAt,
        type: 'Acquisition',
        recordType: 'Acquisition',
        recordId: acquisition.id,
        summary: acquisition.status,
      });
    add(offers, 'Acquisition offer', 'AcquisitionOffer', (x) => `${x.amount}: ${x.status}`);
    add(workOrders, 'Work order', 'WorkOrder', (x) => `${x.workOrderCode}: ${x.status}`);
    add(qualityChecks, 'Quality control', 'QualityCheck', (x) => x.status);
    add(sales, 'Sale', 'Sale', (x) => x.status);
    events.sort((a, b) => new Date(b.at) - new Date(a.at));
    res.json({ vehicle, events });
  } catch (error) {
    next(error);
  }
});
router.get('/reports/:name', permit('reports'), async (req, res, next) => {
  try {
    const name = req.params.name;
    const from = req.query.from ? new Date(req.query.from) : null,
      to = req.query.to ? new Date(`${req.query.to}T23:59:59.999Z`) : null;
    const dateFilter =
      from || to ? { createdAt: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } } : {};
    const scoped = { ...tenantFilter(req), ...dateFilter }; let rows = [];
    if (name === 'enquiry-conversion')
      rows = await Enquiry.aggregate([
        { $match: { ...scoped, type: 'seller' } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]);
    else if (name === 'rejected-acquisitions')
      rows = await Acquisition.aggregate([
        { $match: { ...scoped, status: 'Rejected' } },
        { $group: { _id: '$decisionReason', count: { $sum: 1 } } },
      ]);
    else if (name === 'inspection-defects')
      rows = await Inspection.aggregate([
        { $match: scoped },
        { $unwind: '$findings' },
        { $match: { 'findings.result': { $in: ['Fail', 'Critical'] } } },
        { $group: { _id: '$findings.title', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]);
    else if (name === 'repair-costs')
      rows = await WorkOrder.aggregate([
        { $match: scoped },
        {
          $project: {
            workOrderCode: 1,
            estimated: { $add: ['$estimatedLabour', '$estimatedParts'] },
            actual: { $add: ['$actualLabour', '$actualParts'] },
          },
        },
      ]);
    else if (name === 'parking-occupancy')
      rows = await ParkingSlot.aggregate([{ $match: tenantFilter(req) }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
    else if (name === 'profitability')
      rows = await Sale.aggregate([
        { $match: { ...scoped, status: 'Closed' } },
        { $project: { vehicle: 1, agreedPrice: 1, actualProfit: 1, closedAt: 1 } },
      ]);
    else if (name === 'employee-workload')
      rows = await WorkOrder.aggregate([
        { $match: { ...scoped, status: { $nin: ['Completed', 'Cancelled'] } } },
        { $group: { _id: '$assignedTo', openWorkOrders: { $sum: 1 } } },
      ]);
    else throw httpError(404, 'Unknown report');
    if (req.query.format === 'csv') {
      const headers = rows.length ? Object.keys(rows[0]) : ['result'];
      res.set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="revelo-${name}.csv"`,
      });
      return res.send(
        [
          headers.map(csvValue).join(','),
          ...rows.map((row) =>
            headers
              .map((h) => csvValue(typeof row[h] === 'object' ? JSON.stringify(row[h]) : row[h]))
              .join(',')
          ),
        ].join('\n')
      );
    }
    res.json({ name, rows });
  } catch (error) {
    next(error);
  }
});
export default router;
