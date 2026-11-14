import { httpError } from '../utils/core.js';

let lastRequestAt = 0;
let requestQueue = Promise.resolve();

async function waitForRequestSlot() {
  const scheduled = requestQueue.then(async () => {
    const delay = Math.max(0, 1000 - (Date.now() - lastRequestAt));
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    lastRequestAt = Date.now();
  });
  requestQueue = scheduled.catch(() => {});
  await scheduled;
}

export function formatNominatimAddress(result) {
  const source = result.address || {};
  const address = {
    street: source.road || source.pedestrian || source.footway || source.residential || source.path || '',
    locality: source.neighbourhood || source.suburb || source.quarter || source.city_district || source.locality || '',
    city: source.city || source.town || source.village || source.municipality || '',
    district: source.state_district || source.county || source.district || '',
    state: source.state || '',
    postalCode: source.postcode || '',
    country: source.country || '',
  };
  address.formattedAddress = result.display_name || Object.values(address).filter(Boolean).join(', ');
  return address;
}

export async function reverseGeocode({ latitude, longitude }) {
  await waitForRequestSlot();
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.search = new URLSearchParams({
    format: 'jsonv2',
    addressdetails: '1',
    lat: String(latitude),
    lon: String(longitude),
  }).toString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ReVeloServiceAdvisor/1.0',
        'Accept-Language': 'en',
      },
      signal: controller.signal,
    });
    if (!response.ok) throw httpError(502, 'Address lookup is temporarily unavailable');
    const result = await response.json();
    if (!result.address) throw httpError(502, 'No address was found for these coordinates');
    return formatNominatimAddress(result);
  } catch (error) {
    if (error.status) throw error;
    throw httpError(502, 'Address lookup failed. The GPS coordinates are still available.');
  } finally {
    clearTimeout(timeout);
  }
}
