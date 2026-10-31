import assert from 'node:assert/strict';
import test from 'node:test';
import { hasSubmittedRequiredDocument } from '../src/services/lifecycleService.js';

const requirement = { category: 'Registration Certificate' };

test('submitted and verified required documents satisfy acquisition eligibility', () => {
  for (const status of ['Submitted', 'Under Review', 'Verified']) {
    assert.equal(
      hasSubmittedRequiredDocument(requirement, [{ category: 'Registration Certificate', status }]),
      true
    );
  }
});

test('rejected, on-hold, and expired documents do not satisfy acquisition eligibility', () => {
  for (const status of ['Not Submitted', 'Mismatch', 'Rejected', 'On Hold', 'Expired']) {
    assert.equal(
      hasSubmittedRequiredDocument(requirement, [{ category: 'Registration Certificate', status }]),
      false
    );
  }
  assert.equal(
    hasSubmittedRequiredDocument(requirement, [
      {
        category: 'Registration Certificate',
        status: 'Submitted',
        expiryDate: new Date('2025-01-01'),
      },
    ]),
    false
  );
});

test('required document categories match despite casing or surrounding whitespace', () => {
  assert.equal(
    hasSubmittedRequiredDocument(requirement, [
      { category: ' registration certificate ', status: 'Submitted' },
    ]),
    true
  );
});
