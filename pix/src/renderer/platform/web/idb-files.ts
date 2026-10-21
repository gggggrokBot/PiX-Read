/** IndexedDB blob store for imported library files (PDFs can be large). */

const DB_NAME = "pix-read-files";
const STORE = "blobs";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

export async function idbPut(path: string, data: ArrayBuffer): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(data, path);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexedDB put failed"));
  });
  db.close();
}

export async function idbGet(path: string): Promise<ArrayBuffer | null> {
  const db = await openDb();
  const data = await new Promise<ArrayBuffer | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(path);
    req.onsuccess = () => resolve((req.result as ArrayBuffer | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error("indexedDB get failed"));
  });
  db.close();
  return data;
}

export async function idbDelete(path: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(path);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexedDB delete failed"));
  });
  db.close();
}
