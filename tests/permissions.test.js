import test from 'node:test';
import assert from 'node:assert/strict';
import { can } from '../src/config/permissions.js';
test('role matrix restricts yard access',()=>{assert.equal(can('Yard / Parking Manager','parking'),true);assert.equal(can('Yard / Parking Manager','finance'),false)});
test('super admin retains administrative access',()=>assert.equal(can('Super Admin','users'),true));
