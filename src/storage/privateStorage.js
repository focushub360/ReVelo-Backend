import fs from 'fs/promises';
import path from 'path';
import { id, httpError } from '../utils/core.js';
const root = path.resolve(process.env.PRIVATE_STORAGE_PATH || 'storage/private');
const signatures = {
  pdf: {
    mime: 'application/pdf',
    extension: '.pdf',
    valid: (b) => b.subarray(0, 4).toString('ascii') === '%PDF',
  },
  jpeg: {
    mime: 'image/jpeg',
    extension: '.jpg',
    valid: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  png: {
    mime: 'image/png',
    extension: '.png',
    valid: (b) => b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
  },
};
export function detectDocument(buffer) {
  const found = Object.values(signatures).find((x) => x.valid(buffer));
  if (!found) throw httpError(400, 'Only genuine PDF, JPEG, and PNG files are allowed');
  return found;
}
export function detectImage(buffer) {
  const found = [signatures.jpeg, signatures.png].find((x) => x.valid(buffer));
  if (!found) throw httpError(400, 'Only genuine JPEG and PNG images are allowed');
  return found;
}
export async function savePrivateDocument(buffer) {
  const detected = detectDocument(buffer),
    key = `${id('DOC')}${detected.extension}`;
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, key), buffer, { flag: 'wx' });
  return { storageKey: key, mimeType: detected.mime, extension: detected.extension };
}
export async function savePrivateImage(buffer) {
  const detected = detectImage(buffer);
  const key = `${id('IMG')}${detected.extension}`;
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, key), buffer, { flag: 'wx' });
  return { storageKey: key, mimeType: detected.mime, extension: detected.extension };
}
export async function readPrivateDocument(key) {
  if (!/^[A-Z0-9-]+\.(pdf|jpg|png)$/i.test(key)) throw httpError(400, 'Invalid storage reference');
  try {
    return await fs.readFile(path.join(root, key));
  } catch {
    throw httpError(404, 'Private document file not found');
  }
}
export const storageProvider = {
  kind: 'local-private',
  save: savePrivateDocument,
  read: readPrivateDocument,
};
