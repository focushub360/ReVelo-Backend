import { Document } from '../models/document.js';
import { DocumentRequirement } from '../models/documentRequirement.js';
import { Inspection } from '../models/inspection.js';
import { WorkOrder } from '../models/workOrder.js';
import { QualityCheck } from '../models/qualityCheck.js';
export async function documentEligibility(vehicle, dealership) {
  const scope = dealership ? { dealership } : {};
  const [requirements, documents] = await Promise.all([
    DocumentRequirement.find({ enabled: true, requiredForAcquisition: true }),
    Document.find({ ...scope, vehicle }),
  ]);
  const missing = requirements
    .filter(
      (requirement) =>
        !documents.some(
          (document) => document.category === requirement.category && document.status === 'Verified'
        )
    )
    .map((requirement) => requirement.category);
  return { eligible: missing.length === 0, missing, documents };
}
export async function readiness(vehicle) {
  const [documents, inspections, openWorkOrders, quality] = await Promise.all([
    documentEligibility(vehicle),
    Inspection.find({ vehicle, status: 'Reviewed' }),
    WorkOrder.exists({ vehicle, status: { $nin: ['Completed', 'Cancelled'] } }),
    QualityCheck.findOne({ vehicle }).sort({ createdAt: -1 }),
  ]);
  return {
    documents,
    mechanicalReviewed: inspections.some((report) => report.kind === 'mechanical'),
    structuralReviewed: inspections.some((report) => report.kind === 'structural'),
    openWorkOrders: !!openWorkOrders,
    qualityStatus: quality?.status || 'Not assigned',
    readyForSale: documents.eligible && !openWorkOrders && quality?.status === 'Pass',
  };
}
