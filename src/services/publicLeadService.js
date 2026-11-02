import { PublicLeadConfiguration } from '../models/index.js';
import { httpError } from '../utils/core.js';

export const publicLeadConfig = () => PublicLeadConfiguration.findOne({ key: 'seller-form' });
export const DEFAULT_PUBLIC_FIELDS = [
  ['name', 'Full name', 'text', true, true], ['phone', 'Mobile number', 'tel', true, true], ['email', 'Email address', 'email', true, true],
  ['line1', 'Address line', 'text', true, true], ['locality', 'Area / locality', 'text', true, true], ['city', 'City', 'text', true, true], ['state', 'State', 'text', true, true], ['postalCode', 'Pincode', 'text', true, true],
  ['registration', 'Car registration number', 'text', true, true], ['make', 'Make', 'text', true, true], ['model', 'Model', 'text', true, true], ['year', 'Year', 'number'], ['fuelType', 'Fuel type', 'select', true, true, ['Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid', 'Other']], ['transmission', 'Transmission', 'select', true, true, ['Manual', 'Automatic', 'AMT', 'CVT', 'DCT', 'Other']], ['odometer', 'Approximate odometer (km)', 'number'], ['expectedPrice', 'Your expected selling price (₹)', 'number', true, true],
  ['ownerCount', 'How many owners has the car had?', 'select', false, false, ['1', '2', '3', '4 or more']], ['isFirstOwner', 'Are you the first owner?', 'boolean'], ['rcAvailable', 'Is the RC book available?', 'boolean'], ['insuranceRenewalDate', 'Insurance renewal / expiry date', 'date'], ['previousAccidents', 'Previous accident or major repair history', 'textarea'], ['hasActiveLoan', 'Is there an active loan or hypothecation?', 'boolean'], ['loanProvider', 'Loan provider / bank', 'text'],
].map(([key, label, type, required = false, system = false, options = []]) => ({ key, label, type, required, system, options }));
export const configuredPublicFields = (config) => {
  if (!config?.fields?.length) return DEFAULT_PUBLIC_FIELDS;
  // Configuration fields are Mongoose subdocuments when read from the database.
  // Spreading a subdocument loses its schema values (key, label, type), which
  // previously produced blank system questions on the public form.
  const savedFields = config.fields.map((field) => field.toObject ? field.toObject() : field);
  const configuredKeys = new Set(savedFields.map((field) => field.key));
  // New system fields are added safely for existing admin configurations.
  return [...savedFields.map((field) => {
    const systemField = DEFAULT_PUBLIC_FIELDS.find((defaultField) => defaultField.key === field.key && defaultField.system);
    return systemField ? { ...field, required: true, system: true } : field;
  }), ...DEFAULT_PUBLIC_FIELDS.filter((field) => field.system && !configuredKeys.has(field.key))];
};
export const requirePlatformAdmin = (req) => {
  if (req.user?.role !== 'Super Admin') throw httpError(403, 'Only a platform administrator can manage public form locations');
};
