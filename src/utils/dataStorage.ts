/**
 * IndexedDB utility for storing sensor data points
 * Refactored for better API design and error handling
 */

const DB_NAME = 'ModbusLoggerDB';
const DB_VERSION = 1;
const STORE_NAME = 'dataPoints';
const MAX_POINTS_IN_MEMORY = 1024;

export type StoredDataPoint = {
  id?: number;
  timestamp: number;
  aiRaw: number[];
  aiPhysical: number[];
};

export type TimeRangeQuery = {
  startTime?: number;
  endTime?: number;
};

export type DataStorageStats = {
  count: number;
  oldestTimestamp: number | null;
  newestTimestamp: number | null;
};

/**
 * DataStorage class provides an abstracted interface to IndexedDB
 * for storing and retrieving sensor data points
 */
class DataStorage {
  private db: IDBDatabase | null = null;

  /**
   * Initialize the IndexedDB database
   * @throws Error if database initialization fails
   */
  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
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
  }

  /**
   * Check if database is initialized
   * @private
   */
  private ensureInitialized(): void {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
  }

  /**
   * Add a single data point to the database
   * @param point - Data point to add
   */
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

  /**
   * Add multiple data points in a single transaction (batch operation)
   * @param points - Array of data points to add
   * @returns Array of IDs for the added points
   */
  async addDataPointsBatch(points: StoredDataPoint[]): Promise<number[]> {
    this.ensureInitialized();
    if (points.length === 0) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const ids: number[] = [];

      let completed = 0;

      points.forEach((point) => {
        const request = store.add(point);
        request.onsuccess = () => {
          ids.push(request.result as number);
          completed++;
          if (completed === points.length) {
            resolve(ids);
          }
        };
        request.onerror = () => reject(new Error(`Batch add failed: ${request.error?.message}`));
      });
    });
  }

  /**
   * Get all data points from the database
   * @returns Array of all stored data points
   */
  async getAllDataPoints(): Promise<StoredDataPoint[]> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error(`Failed to get data points: ${request.error?.message}`));
    });
  }

  /**
   * Get data points within a time range
   * @param query - Time range query parameters
   * @returns Array of data points within the specified time range
   */
  async getDataPointsByTimeRange(query: TimeRangeQuery): Promise<StoredDataPoint[]> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('timestamp');

      const range = this.createTimeRange(query);
      const request = range ? index.getAll(range) : index.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error(`Failed to query by time range: ${request.error?.message}`));
    });
  }

  /**
   * Create an IDBKeyRange for time range queries
   * @private
   */
  private createTimeRange(query: TimeRangeQuery): IDBKeyRange | null {
    const { startTime, endTime } = query;

    if (startTime !== undefined && endTime !== undefined) {
      return IDBKeyRange.bound(startTime, endTime);
    } else if (startTime !== undefined) {
      return IDBKeyRange.lowerBound(startTime);
    } else if (endTime !== undefined) {
      return IDBKeyRange.upperBound(endTime);
    }

    return null;
  }

  /**
   * Get the total count of data points
   * @returns Total number of data points in the database
   */
  async getDataPointCount(): Promise<number> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error(`Failed to count data points: ${request.error?.message}`));
    });
  }

  /**
   * Get database statistics
   * @returns Statistics about the stored data
   */
  async getStats(): Promise<DataStorageStats> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('timestamp');

      const countRequest = store.count();
      let count = 0;
      let oldestTimestamp: number | null = null;
      let newestTimestamp: number | null = null;

      countRequest.onsuccess = () => {
        count = countRequest.result;

        if (count === 0) {
          resolve({ count, oldestTimestamp, newestTimestamp });
          return;
        }

        // Get oldest timestamp
        const oldestRequest = index.openCursor(null, 'next');
        oldestRequest.onsuccess = () => {
          const cursor = oldestRequest.result;
          if (cursor) {
            oldestTimestamp = (cursor.value as StoredDataPoint).timestamp;
          }

          // Get newest timestamp
          const newestRequest = index.openCursor(null, 'prev');
          newestRequest.onsuccess = () => {
            const cursor = newestRequest.result;
            if (cursor) {
              newestTimestamp = (cursor.value as StoredDataPoint).timestamp;
            }
            resolve({ count, oldestTimestamp, newestTimestamp });
          };
          newestRequest.onerror = () => reject(new Error(`Failed to get newest timestamp: ${newestRequest.error?.message}`));
        };
        oldestRequest.onerror = () => reject(new Error(`Failed to get oldest timestamp: ${oldestRequest.error?.message}`));
      };

      countRequest.onerror = () => reject(new Error(`Failed to get stats: ${countRequest.error?.message}`));
    });
  }

  /**
   * Keep only the latest N data points, deleting older ones
   * @param maxPoints - Maximum number of points to keep
   */
  async keepLatestPoints(maxPoints: number): Promise<number> {
    this.ensureInitialized();

    const count = await this.getDataPointCount();
    if (count <= maxPoints) return 0;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('timestamp');
      const request = index.openCursor();

      let deleteCount = count - maxPoints;
      let deletedCount = 0;

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

  /**
   * Delete data points older than a specific timestamp
   * @param timestamp - Delete all points older than this timestamp
   * @returns Number of deleted points
   */
  async deletePointsOlderThan(timestamp: number): Promise<number> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('timestamp');
      const range = IDBKeyRange.upperBound(timestamp, true);
      const request = index.openCursor(range);

      let deletedCount = 0;

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          cursor.delete();
          deletedCount++;
          cursor.continue();
        } else {
          resolve(deletedCount);
        }
      };

      request.onerror = () => reject(new Error(`Failed to delete old points: ${request.error?.message}`));
    });
  }

  /**
   * Clear all data from the database
   */
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

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// Singleton instance
export const dataStorage = new DataStorage();
export { MAX_POINTS_IN_MEMORY };
