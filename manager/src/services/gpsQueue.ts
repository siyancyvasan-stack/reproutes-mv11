export interface QueuedGpsPoint {
  clientPointId: string;
  agentId: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  speedKmH?: number;
  heading?: number;
  altitude?: number;
  battery?: number;
  capturedAt: string;
  deviceTimestamp: string;
}

const DATABASE_NAME = 'reproutes-gps';
const STORE_NAME = 'pending-points';

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DATABASE_NAME, 1);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      const store = database.createObjectStore(STORE_NAME, { keyPath: 'clientPointId' });
      store.createIndex('capturedAt', 'capturedAt');
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('GPS queue database unavailable'));
});

const transaction = async <T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>) => {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, mode);
    const request = operation(tx.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('GPS queue operation failed'));
    tx.oncomplete = () => database.close();
    tx.onerror = () => reject(tx.error ?? new Error('GPS queue transaction failed'));
  });
};

export const enqueueGpsPoint = (point: QueuedGpsPoint) =>
  transaction('readwrite', (store) => store.put(point));

export const listQueuedGpsPoints = async (agentId: string) => {
  const points = await transaction<QueuedGpsPoint[]>('readonly', (store) => store.getAll());
  return points.filter((point) => point.agentId === agentId)
    .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());
};

export const removeQueuedGpsPoints = async (clientPointIds: string[]) => {
  if (!clientPointIds.length) return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    clientPointIds.forEach((id) => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('GPS queue cleanup failed'));
  });
  database.close();
};
