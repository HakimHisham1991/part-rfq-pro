/**
 * IndexedDB storage for per-part STEP/STP file bytes.
 */

const DB_NAME = 'part-rfq-pro-models';
const DB_VERSION = 1;
const STORE_NAME = 'stepFiles';

function modelKey(projectId, partId) {
  return `${projectId}:${partId}`;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Failed to open model database'));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

export async function savePartModelFile(projectId, partId, fileName, arrayBuffer) {
  const db = await openDb();
  const key = modelKey(projectId, partId);
  const record = {
    fileName,
    data: arrayBuffer,
    updatedAt: new Date().toISOString()
  };
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to save model file'));
    tx.objectStore(STORE_NAME).put(record, key);
  });
  db.close();
}

export async function getPartModelFile(projectId, partId) {
  const db = await openDb();
  const key = modelKey(projectId, partId);
  const record = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    tx.onerror = () => reject(tx.error ?? new Error('Failed to read model file'));
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error ?? new Error('Failed to read model file'));
  });
  db.close();
  if (!record?.data) return null;
  return {
    fileName: record.fileName ?? '',
    arrayBuffer: record.data
  };
}

export async function deletePartModelFile(projectId, partId) {
  const db = await openDb();
  const key = modelKey(projectId, partId);
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to delete model file'));
    tx.objectStore(STORE_NAME).delete(key);
  });
  db.close();
}

export async function hasPartModelFile(projectId, partId) {
  const file = await getPartModelFile(projectId, partId);
  return file != null && file.arrayBuffer?.byteLength > 0;
}
