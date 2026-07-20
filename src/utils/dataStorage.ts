const DB_NAME = 'ModbusLoggerDB';
const DB_VERSION = 1;
const STORE_NAME = 'dataPoints';

export type StoredDataPoint = {
  id?: number;
  seq: number;
  timestamp: number;
  aiRaw: number[];
  aiPhysical: number[];
  param: number[];
};

class DataStorage {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(new Error(`Database initialization failed: ${request.error?.message}`));
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });

    return this.initPromise;
  }

  private ensureInitialized(): void {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
  }

  async addDataPoint(point: StoredDataPoint): Promise<number> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.add(point);

      request.onsuccess = () => resolve(request.result as number);
      request.onerror = () => reject(new Error(`Failed to add data point: ${request.error?.message}`));
    });
  }

  /** Add multiple points in a single transaction (far cheaper than one
   * transaction per point for batched writes). */
  async addDataPoints(points: StoredDataPoint[]): Promise<void> {
    this.ensureInitialized();
    if (points.length === 0) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error(`Failed to add data points: ${transaction.error?.message}`));

      for (const point of points) store.add(point);
    });
  }

  private async getDataPointCount(): Promise<number> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error(`Failed to count data points: ${request.error?.message}`));
    });
  }

  async keepLatestPoints(maxPoints: number): Promise<number> {
    this.ensureInitialized();

    const count = await this.getDataPointCount();
    if (count <= maxPoints) return 0;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('timestamp');

      let deleteCount = count - maxPoints;
      let deletedCount = 0;

      const request = index.openCursor();

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor && deletedCount < deleteCount) {
          cursor.delete();
          deletedCount++;
          cursor.continue();
        } else {
          resolve(deletedCount);
        }
      };

      request.onerror = () => reject(new Error(`Failed to keep latest points: ${request.error?.message}`));
    });
  }

  async clearAllData(): Promise<void> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Failed to clear data: ${request.error?.message}`));
    });
  }
}

export const dataStorage = new DataStorage();
