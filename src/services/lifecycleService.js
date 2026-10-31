import { Document } from '../models/document.js';
import { DocumentRequirement } from '../models/documentRequirement.js';
import { Inspection } from '../models/inspection.js';
import { WorkOrder } from '../models/workOrder.js';
import { QualityCheck } from '../models/qualityCheck.js';

const acquisitionDocumentStatuses = new Set(['Submitted', 'Under Review', 'Verified']);
export function hasSubmittedRequiredDocument(requirement, documents, now = new Date()) {
  const category = requirement.category.trim().toLocaleLowerCase();
  return documents.some(
    (document) =>
      document.category?.trim().toLocaleLowerCase() === category &&
      acquisitionDocumentStatuses.has(document.status) &&
      (!document.expiryDate || new Date(document.expiryDate) >= now)
  );
}

export async function documentEligibility(vehicle, dealership) {
  const scope = dealership ? { dealership } : {};
  const [requirements, documents] = await Promise.all([
    DocumentRequirement.find({ ...(dealership ? { dealership } : {}), enabled: true, requiredForAcquisition: true }),
    Document.find({ ...scope, vehicle }),
  ]);
  const missing = requirements
    .filter((requirement) => !hasSubmittedRequiredDocument(requirement, documents))
    .map((requirement) => requirement.category);
  return { eligible: missing.length === 0, missing, documents };
}
export async function readiness(vehicle, dealership) {
  const scope = dealership ? { dealership, vehicle } : { vehicle };
  const [documents, inspections, openWorkOrders, quality] = await Promise.all([
    documentEligibility(vehicle, dealership),
    Inspection.find({ ...scope, status: 'Reviewed' }),
    WorkOrder.exists({ ...scope, status: { $nin: ['Completed', 'Cancelled'] } }),
    QualityCheck.findOne(scope).sort({ createdAt: -1 }),
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
