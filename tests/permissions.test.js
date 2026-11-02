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
test('inspection viewing does not grant assignment or review rights', () => {
  const advisor = { role: 'Technician & Service Advisor', operationalProfile: 'Service Advisor' };
  assert.equal(can(advisor, 'inspections:view_assigned'), true);
  assert.equal(can(advisor, 'inspections:assign'), false);
  assert.equal(can(advisor, 'inspections:review'), false);
});
test('parking actions retain distinct permissions', () => {
  const manager = { role: 'Technician & Service Advisor', operationalProfile: 'Parking Manager' };
  assert.equal(can(manager, 'parking:move'), true);
  assert.equal(can(manager, 'parking:release'), true);
  assert.equal(can(manager, 'parking:configure'), true);
});
