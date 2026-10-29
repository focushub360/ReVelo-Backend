// Exactly four primary roles are persisted. Operational responsibilities are profiles, not roles.
export const ROLES = ['Super Admin', 'Dealer Admin', 'Technician & Service Advisor', 'Buyer & Seller'];
export const OPERATIONAL_PROFILES = ['Service Advisor', 'Senior Technician / Vehicle Inspector', 'Parking Manager', 'Refurbishment Technician'];
export const PARTY_TYPES = ['Buyer', 'Seller', 'Buyer and Seller'];
const dealer = ['enquiries:view', 'enquiries:manage', 'vehicles:view', 'vehicles:manage', 'documents:view', 'documents:upload', 'documents:verify', 'inspections:view_assigned', 'inspections:manage_assigned', 'inspections:assign', 'inspections:review', 'parking:view', 'parking:configure', 'parking:reserve', 'parking:move', 'parking:release', 'acquisitions:view', 'acquisitions:approve', 'workorders:view_assigned', 'workorders:manage_assigned', 'qa:review', 'sales:manage', 'finance:view', 'finance:manage', 'reports:view', 'users:create', 'users:view', 'users:update', 'audit:view', 'settings:manage'];
const profiles = {
  'Service Advisor': ['vehicles:view', 'documents:view', 'inspections:view_assigned', 'inspections:manage_assigned'],
  'Senior Technician / Vehicle Inspector': ['vehicles:view', 'inspections:view_assigned', 'inspections:manage_assigned'],
  'Parking Manager': ['vehicles:view', 'parking:view', 'parking:configure', 'parking:reserve', 'parking:move', 'parking:release'],
  'Refurbishment Technician': ['vehicles:view', 'workorders:view_assigned', 'workorders:manage_assigned'],
};
export function permissionsFor(user) {
  if (user?.role === 'Super Admin') return ['*'];
  if (user?.role === 'Dealer Admin') return dealer;
  if (user?.role === 'Technician & Service Advisor') return profiles[user.operationalProfile] || [];
  if (user?.role === 'Buyer & Seller') return ['portal:view', 'portal:manage_own'];
  return [];
}
const legacy = { dashboard: 'vehicles:view', vehicles: 'vehicles:view', enquiries: 'enquiries:view', documents: 'documents:view', inspections: 'inspections:view_assigned', parking: 'parking:view', acquisitions: 'acquisitions:view', workorders: 'workorders:view_assigned', quality: 'qa:review', sales: 'sales:manage', finance: 'finance:view', reports: 'reports:view', settings: 'settings:manage', users: 'users:view' };
export const can = (userOrRole, permission) => {
  const user = typeof userOrRole === 'string' ? { role: userOrRole } : userOrRole;
  const granted = permissionsFor(user);
  return granted.includes('*') || granted.includes(permission) || granted.includes(legacy[permission]);
};
