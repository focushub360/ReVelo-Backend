import assert from 'node:assert/strict';
import test from 'node:test';
import { escapeSearchTerm, toPublicVehicle } from '../src/services/publicCatalogService.js';

test('public catalog search terms are treated as literal text', () => {
  assert.equal(escapeSearchTerm('Honda (City)+'), 'Honda \\(City\\)\\+');
});

test('public vehicle listings only expose storefront-safe vehicle details', () => {
  const listing = toPublicVehicle(
    {
      _id: 'vehicle-1',
      make: 'Honda',
      model: 'City',
      registration: 'PRIVATE-REG',
      vin: 'PRIVATE-VIN',
      dealership: {
        name: 'Central Motors',
        address: { city: 'Pune', state: 'Maharashtra' },
      },
      images: [{ _id: 'image-1', storageKey: 'PRIVATE-KEY', mimeType: 'image/jpeg' }],
    },
    825000
  );

  assert.equal(listing.price, 825000);
  assert.equal(listing.dealer.city, 'Pune');
  assert.deepEqual(listing.images, [
    { id: 'image-1', url: '/api/v1/public/vehicles/vehicle-1/images/image-1' },
  ]);
  assert.equal('registration' in listing, false);
  assert.equal('vin' in listing, false);
  assert.equal('storageKey' in listing.images[0], false);
});
