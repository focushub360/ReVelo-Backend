import test from 'node:test';
import assert from 'node:assert/strict';
import { can } from '../src/config/permissions.js';
test('parking operational profile is restricted to yard responsibilities', () => {
  const parkingManager = { role: 'Technician & Service Advisor', operationalProfile: 'Parking Manager' };
  assert.equal(can(parkingManager, 'parking'), true);
  assert.equal(can(parkingManager, 'finance'), false);
});
test('super admin retains platform access', () => assert.equal(can('Super Admin', 'dealers:create'), true));
test('a technician cannot self-elevate through an unknown profile', () =>
  assert.equal(can({ role: 'Technician & Service Advisor', operationalProfile: 'Not valid' }, 'users:update'), false));
test('buyer and seller portal has no internal finance access', () =>
  assert.equal(can({ role: 'Buyer & Seller', partyType: 'Buyer' }, 'finance:view'), false));
