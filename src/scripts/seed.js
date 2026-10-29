import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import {
  User,
  Person,
  Vehicle,
  Enquiry,
  ParkingZone,
  ParkingSlot,
  Movement,
  Document,
  Inspection,
  Acquisition,
  WorkOrder,
  QualityCheck,
  Sale,
  Notification,
  Audit,
} from '../models/index.js';
import { ROLES } from '../config/permissions.js';
if (process.env.NODE_ENV === 'production') throw new Error('Development seed cannot run in production.');
if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
await mongoose.connect(process.env.MONGODB_URI);
const hash = await bcrypt.hash('ChangeMe123!', 12),
  users = {};
for (const role of ROLES) {
  const email = `${role
    .toLowerCase()
    .replace(/[^a-z]+/g, '.')
    .replace(/\.$/, '')}@revelo.test`;
  users[role] = await User.findOneAndUpdate(
    { email },
    { $set: { name: role, email, role, passwordHash: hash, active: true } },
    { new: true, upsert: true }
  );
}
const admin = users['Super Admin'],
  acqUser = users['Acquisition Executive'],
  advisor = users['Service Advisor'],
  inspector = users['Senior Technician / Vehicle Inspector'],
  yard = users['Yard / Parking Manager'],
  tech = users['Workshop / Refurbishment Technician'],
  salesUser = users['Sales Executive'];
const seller = await Person.findOneAndUpdate(
    { phone: '9810001001', kind: 'seller' },
    {
      $set: {
        name: 'Aarav Mehta',
        phone: '9810001001',
        email: 'aarav.mehta@example.test',
        kind: 'seller',
        maskedIdentity: 'PAN •••• 4821',
      },
    },
    { new: true, upsert: true }
  ),
  buyer = await Person.findOneAndUpdate(
    { phone: '9810002001', kind: 'buyer' },
    {
      $set: { name: 'Nisha Kapoor', phone: '9810002001', email: 'nisha.kapoor@example.test', kind: 'buyer' },
    },
    { new: true, upsert: true }
  );
const vehicle = await Vehicle.findOneAndUpdate(
  { vehicleCode: 'VEH-DEMO-001' },
  {
    $set: {
      vehicleCode: 'VEH-DEMO-001',
      registration: 'DL01AB1234',
      vin: 'MA3EJKD1S00123456',
      make: 'Maruti Suzuki',
      model: 'Baleno',
      variant: 'Alpha Petrol',
      year: 2021,
      fuelType: 'Petrol',
      transmission: 'Automatic',
      odometer: 38400,
      lifecycle: 'Ready for Sale',
    },
  },
  { new: true, upsert: true }
);
const enquiry = await Enquiry.findOneAndUpdate(
  { enquiryCode: 'ENQ-DEMO-001' },
  {
    $set: {
      enquiryCode: 'ENQ-DEMO-001',
      type: 'seller',
      vehicle: vehicle.id,
      person: seller.id,
      status: 'Closed',
      source: 'Website valuation form',
      askingPrice: 675000,
      assignedTo: acqUser.id,
      notes: 'Development sample seller enquiry',
    },
  },
  { new: true, upsert: true }
);
await ParkingZone.findOneAndUpdate(
  { code: 'MAIN' },
  { $set: { name: 'Main Yard', code: 'MAIN', description: 'Retail inventory parking' } },
  { upsert: true }
);
const slot = await ParkingSlot.findOneAndUpdate(
  { code: 'MAIN-A-01' },
  {
    $set: {
      code: 'MAIN-A-01',
      zone: 'MAIN',
      row: 'A',
      number: 1,
      type: 'parking',
      status: 'Occupied',
      activeVehicle: vehicle.id,
      occupiedAt: new Date(),
    },
  },
  { new: true, upsert: true }
);
await Vehicle.findByIdAndUpdate(vehicle.id, { $set: { currentLocation: slot.id } });
await Movement.findOneAndUpdate(
  { vehicle: vehicle.id, action: 'Occupy' },
  {
    $set: {
      vehicle: vehicle.id,
      to: slot.id,
      action: 'Occupy',
      reason: 'Seeded retail inventory',
      by: yard.id,
      physicalConfirmation: true,
    },
  },
  { upsert: true }
);
for (const category of ['Registration Certificate', 'Insurance', 'Purchase Agreement'])
  await Document.findOneAndUpdate(
    { vehicle: vehicle.id, category },
    {
      $set: {
        vehicle: vehicle.id,
        enquiry: enquiry.id,
        person: seller.id,
        category,
        status: 'Verified',
        storageKey: `DEMO-${category.replace(/[^A-Z]/gi, '')}.pdf`,
        originalName: `${category}.pdf`,
        extension: '.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        submittedBy: acqUser.id,
        reviewer: admin.id,
        reviewedAt: new Date(),
        consentRecorded: true,
      },
    },
    { upsert: true }
  );
await Inspection.findOneAndUpdate(
  { vehicle: vehicle.id, kind: 'mechanical', revision: 1 },
  {
    $set: {
      vehicle: vehicle.id,
      kind: 'mechanical',
      assignedTo: advisor.id,
      assignedBy: admin.id,
      status: 'Reviewed',
      reviewer: admin.id,
      findings: [{ title: 'Engine condition', required: true, result: 'Pass' }],
    },
  },
  { upsert: true }
);
const acquisition = await Acquisition.findOneAndUpdate(
  { vehicle: vehicle.id },
  {
    $set: {
      vehicle: vehicle.id,
      enquiry: enquiry.id,
      proposedPrice: 650000,
      agreedPrice: 645000,
      refurbishmentEstimate: 25000,
      transactionCosts: 9000,
      holdingCosts: 4000,
      expectedResale: 845000,
      status: 'Purchased',
      purchaseReference: 'SEED-PURCHASE-001',
      purchaseAgreementConfirmed: true,
    },
  },
  { new: true, upsert: true }
);
await WorkOrder.findOneAndUpdate(
  { workOrderCode: 'WO-DEMO-001' },
  {
    $set: {
      workOrderCode: 'WO-DEMO-001',
      vehicle: vehicle.id,
      acquisition: acquisition.id,
      title: 'Brake pad replacement',
      priority: 'Medium',
      assignedTo: tech.id,
      status: 'Completed',
      actualLabour: 2400,
      actualParts: 6200,
    },
  },
  { upsert: true }
);
await QualityCheck.findOneAndUpdate(
  { vehicle: vehicle.id },
  {
    $set: {
      vehicle: vehicle.id,
      assignedTo: inspector.id,
      status: 'Pass',
      checks: [{ title: 'Safety check', required: true, passed: true }],
      criticalFaultsResolved: true,
      workOrdersClosed: true,
      safetyChecksPassed: true,
      reviewedBy: admin.id,
    },
  },
  { upsert: true }
);
await Sale.findOneAndUpdate(
  { vehicle: vehicle.id, status: { $ne: 'Closed' } },
  {
    $set: {
      vehicle: vehicle.id,
      status: 'Reserved',
      targetPrice: 845000,
      agreedPrice: 835000,
      offers: [{ amount: 835000, note: 'Seeded buyer offer', by: salesUser.id }],
      payments: [
        {
          amount: 100000,
          reference: 'SEED-BOOKING-001',
          confirmed: true,
          recordedBy: users['Accounts / Finance Officer'].id,
        },
      ],
    },
  },
  { upsert: true }
);
await Notification.findOneAndUpdate(
  { recipient: advisor.id, event: 'overdue-inspection', entityId: String(vehicle.id) },
  {
    $set: {
      recipient: advisor.id,
      event: 'overdue-inspection',
      title: 'Inspection follow-up',
      body: 'Sample notification',
      entityType: 'Inspection',
      entityId: String(vehicle.id),
      read: false,
    },
  },
  { upsert: true }
);
await Audit.findOneAndUpdate(
  { action: 'SEED', entityId: 'development-data' },
  {
    $set: {
      actor: admin.id,
      action: 'SEED',
      entity: 'System',
      entityId: 'development-data',
      data: { message: 'Development sample data upserted' },
    },
  },
  { upsert: true }
);
console.log('Development sample data seeded. Role emails use @revelo.test; password: ChangeMe123!');
await mongoose.disconnect();
