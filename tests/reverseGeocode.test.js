import assert from 'node:assert/strict';
import test from 'node:test';
import { formatNominatimAddress } from '../src/services/reverseGeocode.js';

test('formats Nominatim address components for vehicle intake', () => {
  assert.deepEqual(
    formatNominatimAddress({
      display_name: '12 Main Road, Vellore, Tamil Nadu, 632001, India',
      address: {
        road: 'Main Road',
        neighbourhood: 'Gandhi Nagar',
        city: 'Vellore',
        state_district: 'Vellore',
        state: 'Tamil Nadu',
        postcode: '632001',
        country: 'India',
      },
    }),
    {
      street: 'Main Road',
      locality: 'Gandhi Nagar',
      city: 'Vellore',
      district: 'Vellore',
      state: 'Tamil Nadu',
      postalCode: '632001',
      country: 'India',
      formattedAddress: '12 Main Road, Vellore, Tamil Nadu, 632001, India',
    }
  );
});

test('uses available address components when Nominatim has no formatted address', () => {
  const address = formatNominatimAddress({
    address: { road: 'Main Road', town: 'Vellore', country: 'India' },
  });
  assert.equal(address.street, 'Main Road');
  assert.equal(address.city, 'Vellore');
  assert.equal(address.formattedAddress, 'Main Road, Vellore, India');
});
