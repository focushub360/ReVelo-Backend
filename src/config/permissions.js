export const ROLES = ['Super Admin', 'Dealer Admin / Branch Manager', 'Acquisition Executive', 'Documentation & Compliance Officer', 'Service Advisor', 'Senior Technician / Vehicle Inspector', 'Yard / Parking Manager', 'Workshop / Refurbishment Technician', 'Sales Executive', 'Accounts / Finance Officer'];
const all = ['*'];
export const permissions = {
    'Super Admin': all,
    'Dealer Admin / Branch Manager': ['dashboard', 'vehicles', 'enquiries', 'documents', 'inspections', 'parking', 'acquisitions', 'workorders', 'quality', 'sales', 'finance', 'reports', 'settings', 'users'],
    'Acquisition Executive': ['dashboard', 'vehicles', 'enquiries', 'acquisitions', 'documents'],
    'Documentation & Compliance Officer': ['dashboard', 'documents', 'vehicles', 'enquiries'],
    'Service Advisor': ['dashboard', 'inspections', 'vehicles'],
    'Senior Technician / Vehicle Inspector': ['dashboard', 'inspections', 'vehicles', 'quality'],
    'Yard / Parking Manager': ['dashboard', 'parking', 'vehicles'],
    'Workshop / Refurbishment Technician': ['dashboard', 'workorders', 'vehicles', 'quality'],
    'Sales Executive': ['dashboard', 'sales', 'enquiries', 'vehicles'],
    'Accounts / Finance Officer': ['dashboard', 'finance', 'acquisitions', 'sales', 'vehicles', 'reports']
};
export const can = (role, resource) => permissions[role]?.includes('*') || permissions[role]?.includes(resource);
