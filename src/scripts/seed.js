/* Development-only, idempotent multi-tenant sample data. Never use in production. */
import dns from 'node:dns';

dns.setServers(['8.8.8.8', '1.1.1.1']);
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import {
  Dealership, User, Person, Vehicle, Enquiry, DocumentRequirement, Document,
  ParkingZone, ParkingSlot, Movement, Inspection, Acquisition, WorkOrder,
  QualityCheck, Sale, Notification, Audit, Session, PasswordReset, OwnershipPeriod,
  AcquisitionOffer, InspectionTemplate, Negotiation, Appointment,
} from '../models/index.js';

dotenv.config();
if (process.env.NODE_ENV === 'production') throw new Error('Development seed cannot run in production.');
if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
await mongoose.connect(process.env.MONGODB_URI);

// This seed is intentionally a clean reset for local development. Keep the production
// guard above: every collection belonging to this database is emptied before seeding.
const collections = [
  Session, PasswordReset, Notification, Audit, Appointment, Negotiation, Sale, QualityCheck, WorkOrder,
  AcquisitionOffer, Acquisition, Inspection, InspectionTemplate, Movement, ParkingSlot,
  ParkingZone, Document, DocumentRequirement, OwnershipPeriod, Enquiry, Vehicle, Person,
  User, Dealership,
];
for (const Model of collections) await Model.deleteMany({});
await DocumentRequirement.collection.dropIndex('category_1').catch(() => {});
await DocumentRequirement.syncIndexes();
console.log('Existing ReVelo development data cleared.');

const passwordHash = await bcrypt.hash('ChangeMe123!', 12);
const stamp = new Date('2026-10-30T09:00:00.000Z');
const upsert = (Model, filter, value) => Model.findOneAndUpdate(filter, { $set: value }, { new: true, upsert: true, setDefaultsOnInsert: true });
const employee = (dealer, email, name, operationalProfile) => upsert(User, { email }, {
  name, email, passwordHash, role: 'Technician & Service Advisor', operationalProfile, dealership: dealer.id,
  active: true, lastLoginAt: stamp, lastActiveAt: stamp,
});

const superAdmin = await upsert(User, { email: 'super.admin@revelo.test' }, {
  name: 'ReVelo Platform Admin', email: 'super.admin@revelo.test', passwordHash, role: 'Super Admin', active: true,
});
const apex = await upsert(Dealership, { code: 'APEX' }, {
  name: 'Apex Motors Delhi', code: 'APEX', contact: { name: 'Rohan Shah', email: 'admin@apex.revelo.test', phone: '9810001001' },
  address: { line1: '14 Ring Road', city: 'New Delhi', state: 'Delhi', postalCode: '110001', country: 'India' },
  business: { legalName: 'Apex Motors Private Limited', taxId: 'DEMO-APEX-GST' },
  subscription: { plan: 'Growth', status: 'Active', maxUsers: 25, maxVehicles: 500 }, onboardingStatus: 'Active', active: true,
});
const coast = await upsert(Dealership, { code: 'COAST' }, {
  name: 'Coastal Auto Bengaluru', code: 'COAST', contact: { name: 'Maya Iyer', email: 'admin@coast.revelo.test', phone: '9820002002' },
  address: { line1: '88 Airport Road', city: 'Bengaluru', state: 'Karnataka', postalCode: '560017', country: 'India' },
  subscription: { plan: 'Starter', status: 'Active', maxUsers: 10, maxVehicles: 150 }, onboardingStatus: 'Active', active: true,
});
const apexAdmin = await upsert(User, { email: 'admin@apex.revelo.test' }, { name: 'Rohan Shah', email: 'admin@apex.revelo.test', passwordHash, role: 'Dealer Admin', dealership: apex.id, phone: '9810001001', active: true });
const coastAdmin = await upsert(User, { email: 'admin@coast.revelo.test' }, { name: 'Maya Iyer', email: 'admin@coast.revelo.test', passwordHash, role: 'Dealer Admin', dealership: coast.id, phone: '9820002002', active: true });
const advisor = await employee(apex, 'advisor@apex.revelo.test', 'Neeraj Kumar', 'Service Advisor');
const inspector = await employee(apex, 'inspector@apex.revelo.test', 'Priya Menon', 'Senior Technician / Vehicle Inspector');
const parking = await employee(apex, 'parking@apex.revelo.test', 'Arjun Patel', 'Parking Manager');
const technician = await employee(apex, 'workshop@apex.revelo.test', 'Farhan Ali', 'Refurbishment Technician');
const sellerPortal = await upsert(User, { email: 'seller@apex.revelo.test' }, { name: 'Aarav Mehta', email: 'seller@apex.revelo.test', passwordHash, role: 'Buyer & Seller', partyType: 'Seller', dealership: apex.id, active: true });
const buyerPortal = await upsert(User, { email: 'buyer@apex.revelo.test' }, { name: 'Nisha Kapoor', email: 'buyer@apex.revelo.test', passwordHash, role: 'Buyer & Seller', partyType: 'Buyer', dealership: apex.id, active: true });
await employee(coast, 'parking@coast.revelo.test', 'Kavya Rao', 'Parking Manager');

for (const dealership of [apex, coast]) {
  for (const [name, expiry] of [['Registration Certificate', false], ['Insurance', true], ['Purchase Agreement', false]]) {
    await upsert(DocumentRequirement, { dealership: dealership.id, category: name }, { dealership: dealership.id, name, category: name, description: `${name} required before purchase`, requiredForAcquisition: true, requiresExpiry: expiry, enabled: true });
  }
}
const seller = await upsert(Person, { dealership: apex.id, email: sellerPortal.email }, { dealership: apex.id, name: sellerPortal.name, email: sellerPortal.email, phone: '9810003003', kind: 'seller', maskedIdentity: 'PAN •••• 4821' });
const buyer = await upsert(Person, { dealership: apex.id, email: buyerPortal.email }, { dealership: apex.id, name: buyerPortal.name, email: buyerPortal.email, phone: '9810004004', kind: 'buyer' });
await User.updateOne({ _id: sellerPortal.id }, { party: seller.id });
await User.updateOne({ _id: buyerPortal.id }, { party: buyer.id });
const vehicle = await upsert(Vehicle, { vehicleCode: 'APEX-DEMO-001' }, {
  dealership: apex.id, vehicleCode: 'APEX-DEMO-001', registration: 'DL01AB1234', vin: 'MA3EJKD1S00123456', make: 'Maruti Suzuki', model: 'Baleno', variant: 'Alpha Petrol', year: 2021, fuelType: 'Petrol', transmission: 'Automatic', odometer: 38400, lifecycle: 'Ready for Sale',
  activities: [{ type: 'seed', message: 'Sample vehicle seeded into the Apex tenant', actor: apexAdmin.id, at: stamp }],
});
const coastVehicle = await upsert(Vehicle, { vehicleCode: 'COAST-DEMO-001' }, { dealership: coast.id, vehicleCode: 'COAST-DEMO-001', registration: 'KA01CD5678', make: 'Hyundai', model: 'i20', year: 2022, lifecycle: 'Enquiry Created' });
const sellerEnquiry = await upsert(Enquiry, { enquiryCode: 'APEX-SELL-001' }, { dealership: apex.id, enquiryCode: 'APEX-SELL-001', type: 'seller', vehicle: vehicle.id, person: seller.id, status: 'Closed', source: 'Website', askingPrice: 675000, assignedTo: apexAdmin.id });
const buyerEnquiry = await upsert(Enquiry, { enquiryCode: 'APEX-BUY-001' }, { dealership: apex.id, enquiryCode: 'APEX-BUY-001', type: 'buyer', vehicle: vehicle.id, person: buyer.id, status: 'Open', source: 'Portal', offer: 835000, assignedTo: apexAdmin.id });
await upsert(Enquiry, { enquiryCode: 'COAST-SELL-001' }, { dealership: coast.id, enquiryCode: 'COAST-SELL-001', type: 'seller', vehicle: coastVehicle.id, person: await upsert(Person, { dealership: coast.id, email: 'seller@coast.revelo.test' }, { dealership: coast.id, name: 'Coastal Seller', email: 'seller@coast.revelo.test', kind: 'seller' }).then(x => x.id), status: 'Open', source: 'Walk-in', assignedTo: coastAdmin.id });

const zone = await upsert(ParkingZone, { dealership: apex.id, code: 'MAIN' }, { dealership: apex.id, name: 'Main Yard', code: 'MAIN', description: 'Retail inventory parking', enabled: true });
const slots = await Promise.all(['A-01', 'A-02', 'A-03', 'I-01', 'W-01'].map((code, i) => upsert(ParkingSlot, { dealership: apex.id, code: `APEX-${code}` }, { dealership: apex.id, code: `APEX-${code}`, zone: zone.code, row: code[0], number: i + 1, type: code[0] === 'I' ? 'inspection' : code[0] === 'W' ? 'workshop' : 'parking', status: code === 'A-01' ? 'Occupied' : 'Available', activeVehicle: code === 'A-01' ? vehicle.id : undefined, occupiedAt: code === 'A-01' ? stamp : undefined, enabled: true })));
const occupied = slots[0];
await Vehicle.findByIdAndUpdate(vehicle.id, { currentLocation: occupied.id });
await upsert(Movement, { dealership: apex.id, vehicle: vehicle.id, action: 'Occupy' }, { dealership: apex.id, vehicle: vehicle.id, to: occupied.id, action: 'Occupy', reason: 'Initial sample yard allocation', by: parking.id, physicalConfirmation: true });

await upsert(Document, { dealership: apex.id, vehicle: vehicle.id, category: 'Registration Certificate' }, { dealership: apex.id, vehicle: vehicle.id, enquiry: sellerEnquiry.id, person: seller.id, category: 'Registration Certificate', status: 'Verified', storageKey: 'seed/APEX-DEMO-001-registration.pdf', originalName: 'registration-certificate.pdf', extension: '.pdf', mimeType: 'application/pdf', size: 1024, submittedBy: sellerPortal.id, reviewer: apexAdmin.id, reviewedAt: stamp, consentRecorded: true });
const inspection = await upsert(Inspection, { dealership: apex.id, vehicle: vehicle.id, kind: 'mechanical', revision: 1 }, { dealership: apex.id, vehicle: vehicle.id, kind: 'mechanical', assignedTo: advisor.id, assignedBy: apexAdmin.id, dueDate: stamp, status: 'Reviewed', reviewer: apexAdmin.id, reviewedAt: stamp, findings: [{ title: 'Engine condition', required: true, result: 'Pass' }] });
const acquisition = await upsert(Acquisition, { dealership: apex.id, vehicle: vehicle.id }, { dealership: apex.id, vehicle: vehicle.id, enquiry: sellerEnquiry.id, proposedPrice: 650000, agreedPrice: 645000, refurbishmentEstimate: 25000, expectedResale: 845000, status: 'Purchased', purchaseReference: 'SEED-APEX-PURCHASE-001', purchaseAgreementConfirmed: true, purchaseDate: stamp });
await upsert(WorkOrder, { workOrderCode: 'APEX-WO-001' }, { dealership: apex.id, workOrderCode: 'APEX-WO-001', vehicle: vehicle.id, acquisition: acquisition.id, inspection: inspection.id, title: 'Brake pad replacement', priority: 'Medium', assignedTo: technician.id, status: 'Completed', actualLabour: 2400, actualParts: 6200, completedAt: stamp });
await upsert(QualityCheck, { dealership: apex.id, vehicle: vehicle.id }, { dealership: apex.id, vehicle: vehicle.id, assignedTo: inspector.id, status: 'Pass', checks: [{ title: 'Safety check', required: true, passed: true }], criticalFaultsResolved: true, workOrdersClosed: true, safetyChecksPassed: true, reviewedBy: apexAdmin.id, reviewedAt: stamp });
await upsert(Negotiation, { dealership: apex.id, enquiry: buyerEnquiry.id }, { dealership: apex.id, vehicle: vehicle.id, buyer: buyer.id, enquiry: buyerEnquiry.id, responsibleUser: apexAdmin.id, status: 'Open', offers: [{ amount: 835000, terms: 'Subject to viewing and test drive.', kind: 'Offer', actor: buyerPortal.id, at: stamp }] });
await upsert(Appointment, { dealership: apex.id, vehicle: vehicle.id, party: buyer.id, startsAt: new Date('2026-11-02T10:00:00.000Z') }, { dealership: apex.id, vehicle: vehicle.id, party: buyer.id, assignedTo: advisor.id, type: 'Test Drive', startsAt: new Date('2026-11-02T10:00:00.000Z'), endsAt: new Date('2026-11-02T11:00:00.000Z'), status: 'Confirmed', notes: 'Seeded buyer test-drive appointment.' });
await upsert(Sale, { dealership: apex.id, vehicle: vehicle.id }, { dealership: apex.id, vehicle: vehicle.id, buyerEnquiry: buyerEnquiry.id, status: 'Reserved', targetPrice: 845000, agreedPrice: 835000, reservedUntil: new Date('2026-11-15T18:00:00.000Z') });
await upsert(Notification, { recipient: advisor.id, event: 'seed-inspection', entityId: String(inspection.id) }, { dealership: apex.id, recipient: advisor.id, event: 'seed-inspection', title: 'Inspection reviewed', body: 'Your sample mechanical inspection is ready to view.', entityType: 'Inspection', entityId: String(inspection.id), read: false });
await upsert(Audit, { action: 'SEED', entityId: 'multitenant-demo-v2' }, { actor: superAdmin.id, actorName: superAdmin.name, role: superAdmin.role, action: 'SEED', entity: 'System', entityId: 'multitenant-demo-v2', data: { dealerships: [apex.code, coast.code], message: 'Idempotent multi-tenant demo data seeded' } });

console.log('Seed complete. Password for all sample accounts: ChangeMe123!');
console.log('Platform: super.admin@revelo.test | Apex: admin@apex.revelo.test | profiles: advisor/inspector/parking/workshop@apex.revelo.test');
await mongoose.disconnect();
