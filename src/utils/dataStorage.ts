// Scoped to this app. modbus_extra_logger keeps its own database; a shared
// name would mean a shared object store whenever both are served from the same
// origin, and a schema change in either would upgrade the other's database out
// from under it.
const DB_NAME = 'ModbusSimpleLoggerDB';
const DB_VERSION = 1;
const STORE_NAME = 'dataPoints';

// Backstop so init() can never fail to settle. Generous, because a first-run
// upgrade on a slow disk is legitimately slow; it exists to convert a hang into
// a reportable error, not to police normal timing.
const INIT_TIMEOUT_MS = 10000;

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
  // IndexedDB transactions are individually serialized by the browser, but
  // callers in App intentionally use fire-and-forget writes. Keep the
  // application-level order explicit so a clear cannot race a pending add or
  // a trim can use a stale count.
  private operationChain: Promise<void> = Promise.resolve();

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationChain.then(operation, operation);
    this.operationChain = result.then(() => undefined, () => undefined);
    return result;
  }

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    const attempt = new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      // Every path below must settle this promise. It used to be possible for
      // none of them to fire: `onblocked` was unhandled, so another tab holding
      // a connection open across a version change left init() pending forever —
      // and because handleConnect awaits clearAllData(), which awaits this,
      // Connect hung or failed with "Database not initialized" and no hint as
      // to why.
      const timeoutId = setTimeout(
        () => reject(new Error(`Database initialization timed out after ${INIT_TIMEOUT_MS} ms`)),
        INIT_TIMEOUT_MS,
      );
      const settle = (fn: () => void) => {
        clearTimeout(timeoutId);
        fn();
      };

      request.onerror = () =>
        settle(() => reject(new Error(`Database initialization failed: ${request.error?.message}`)));
      request.onblocked = () =>
        settle(() =>
          reject(
            new Error(
              'Database initialization blocked: another tab or window has this app open. Close it and retry.',
            ),
          ),
        );
      request.onsuccess = () =>
        settle(() => {
          this.db = request.result;
          resolve();
        });

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });

    // Do not cache a rejection. Caching one poisoned the singleton for the rest
    // of the session: every later init() returned the same rejected promise, so
    // a transient failure (or a blocking tab the user then closed) could never
    // be recovered from without a reload.
    this.initPromise = attempt;
    attempt.catch(() => {
      if (this.initPromise === attempt) this.initPromise = null;
    });

    return attempt;
  }

  private ensureInitialized(): void {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
  }

  async addDataPoint(point: StoredDataPoint): Promise<number> {
    return this.enqueue(() => this.addDataPointInternal(point));
  }

  private async addDataPointInternal(point: StoredDataPoint): Promise<number> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.add(point);
      let key: number;

      request.onsuccess = () => { key = request.result as number; };
      transaction.oncomplete = () => resolve(key);
      request.onerror = () => reject(new Error(`Failed to add data point: ${request.error?.message}`));
      transaction.onerror = () => reject(new Error(`Failed to add data point: ${transaction.error?.message}`));
    });
  }

  /** Add multiple points in a single transaction (far cheaper than one
   * transaction per point for batched writes). */
  async addDataPoints(points: StoredDataPoint[]): Promise<void> {
    return this.enqueue(() => this.addDataPointsInternal(points));
  }

  private async addDataPointsInternal(points: StoredDataPoint[]): Promise<void> {
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
      let count = 0;

      request.onsuccess = () => { count = request.result; };
      transaction.oncomplete = () => resolve(count);
      request.onerror = () => reject(new Error(`Failed to count data points: ${request.error?.message}`));
      transaction.onerror = () => reject(new Error(`Failed to count data points: ${transaction.error?.message}`));
    });
  }

  async keepLatestPoints(maxPoints: number): Promise<number> {
    return this.enqueue(() => this.keepLatestPointsInternal(maxPoints));
  }

  private async keepLatestPointsInternal(maxPoints: number): Promise<number> {
    this.ensureInitialized();

    const count = await this.getDataPointCount();
    if (count <= maxPoints) return 0;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const deleteCount = count - maxPoints;
      let deletedCount = 0;
      transaction.oncomplete = () => resolve(deletedCount);
      transaction.onerror = () => reject(new Error(`Failed to keep latest points: ${transaction.error?.message}`));
      transaction.onabort = () => reject(new Error(`Failed to keep latest points: ${transaction.error?.message ?? 'transaction aborted'}`));

      // The primary auto-increment key is insertion order. Do not use the
      // timestamp index here: system wall-clock time can move backward, so
      // timestamp order is not FIFO order.
      const request = store.openKeyCursor();

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursor>).result;
        if (cursor && deletedCount < deleteCount) {
          cursor.delete();
          deletedCount++;
          cursor.continue();
        }
      };

      request.onerror = () => reject(new Error(`Failed to keep latest points: ${request.error?.message}`));
    });
  }

  async clearAllData(): Promise<void> {
    return this.enqueue(() => this.clearAllDataInternal());
  }

  private async clearAllDataInternal(): Promise<void> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.clear();

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error(`Failed to clear data: ${transaction.error?.message}`));
    });
  }
}

export const dataStorage = new DataStorage();
