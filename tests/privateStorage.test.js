import assert from 'node:assert/strict';
import test from 'node:test';
import { detectImage } from '../src/storage/privateStorage.js';

test('vehicle image validation accepts JPEG and PNG signatures', () => {
  assert.equal(detectImage(Buffer.from([0xff, 0xd8, 0xff])).mime, 'image/jpeg');
  assert.equal(detectImage(Buffer.from('89504e470d0a1a0a', 'hex')).mime, 'image/png');
});

test('vehicle image validation rejects PDFs and unknown file types', () => {
  assert.throws(() => detectImage(Buffer.from('%PDF-1.7')), {
    message: 'Only genuine JPEG and PNG images are allowed',
  });
  assert.throws(() => detectImage(Buffer.from('not an image')), {
    message: 'Only genuine JPEG and PNG images are allowed',
  });
});
