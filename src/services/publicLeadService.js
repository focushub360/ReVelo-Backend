import { PublicLeadConfiguration } from '../models/index.js';
import { httpError } from '../utils/core.js';

export const publicLeadConfig = () => PublicLeadConfiguration.findOne({ key: 'seller-form' });
export const DEFAULT_PUBLIC_FIELDS = [
  ['name', 'Full name', 'text', true, true], ['phone', 'Mobile number', 'tel', true, true], ['email', 'Email address', 'email'],
  ['line1', 'Address line', 'text', true, true], ['locality', 'Area / locality', 'text', true, true], ['city', 'City', 'text', true, true], ['state', 'State', 'text', true, true], ['postalCode', 'Pincode', 'text', true, true],
  ['registration', 'Car registration number', 'text', true, true], ['make', 'Make', 'text', true, true], ['model', 'Model', 'text', true, true], ['year', 'Year', 'number'], ['odometer', 'Approximate odometer (km)', 'number'],
  ['ownerCount', 'How many owners has the car had?', 'select', false, false, ['1', '2', '3', '4 or more']], ['isFirstOwner', 'Are you the first owner?', 'boolean'], ['rcAvailable', 'Is the RC book available?', 'boolean'], ['insuranceRenewalDate', 'Insurance renewal / expiry date', 'date'], ['previousAccidents', 'Previous accident or major repair history', 'textarea'], ['hasActiveLoan', 'Is there an active loan or hypothecation?', 'boolean'], ['loanProvider', 'Loan provider / bank', 'text'],
].map(([key, label, type, required = false, system = false, options = []]) => ({ key, label, type, required, system, options }));
export const configuredPublicFields = (config) => config?.fields?.length ? config.fields : DEFAULT_PUBLIC_FIELDS;
export const requirePlatformAdmin = (req) => {
  if (req.user?.role !== 'Super Admin') throw httpError(403, 'Only a platform administrator can manage public form locations');
};
