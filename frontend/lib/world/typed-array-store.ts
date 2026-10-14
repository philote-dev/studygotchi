/**
 * Typed arrays by key in `sessionStorage` (base64), for build outputs that
 * are worth keeping across a reload in the same tab but too big to recompute
 * on the critical path (the ice plate's sampled heightfield: 2.1 MB of bytes,
 * 2.8 MB as base64, so the client's 4 MB cap keeps exactly one plate, the
 * band the course lands on; another band evicts it). A
 * module Map fronts the storage; entries past `maxEntryBytes` are kept in
 * memory only, and the oldest entries go when the store passes `cap`. Pure
 * apart from the injectable storage, so it runs under node tests and SSR.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface TypedArrayStoreOptions {
  prefix: string;
  /** Total base64 characters kept in storage. */
  cap?: number;
  /** Entries whose base64 is longer than this never reach storage (memory only). */
  maxEntryBytes?: number;
}

export interface TypedArrayStore {
  get(key: string): ArrayBuffer | null;
  /** Remember `bytes`; returns true when it reached storage (not just memory). */
  set(key: string, bytes: ArrayBuffer | ArrayBufferView): boolean;
  /** The base64 text of an entry without decoding it (a Worker can decode off the main thread). */
  getEncoded(key: string): string | null;
  /** Store text already encoded by `encodeBytes` (by a Worker); same eviction as `set`. */
  setEncoded(key: string, encoded: string): boolean;
  has(key: string): boolean;
  /** Keys in storage order, oldest first. */
  keys(): string[];
  clear(): void;
}

const CHUNK = 0x8000;

export function encodeBytes(bytes: ArrayBuffer | ArrayBufferView): string {
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let binary = "";
  for (let i = 0; i < view.length; i += CHUNK) binary += String.fromCharCode.apply(null, view.subarray(i, i + CHUNK) as unknown as number[]);
  return btoa(binary);
}

export function decodeBytes(text: string): ArrayBuffer {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function defaultSessionStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function createTypedArrayStore(storage: StorageLike | null, { prefix, cap = 4 * 1024 * 1024, maxEntryBytes = 2 * 1024 * 1024 }: TypedArrayStoreOptions): TypedArrayStore {
  const memory = new Map<string, ArrayBuffer>();
  const indexKey = `${prefix}index`;

  const readIndex = (): string[] => {
    try {
      const raw = storage?.getItem(indexKey);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
    } catch {
      return [];
    }
  };
  const writeIndex = (keys: string[]) => {
    try {
      storage?.setItem(indexKey, JSON.stringify(keys));
    } catch {
      /* quota or privacy mode: memory only */
    }
  };

  const encodedMemory = new Map<string, string>();

  function setEncoded(key: string, encoded: string): boolean {
    encodedMemory.set(key, encoded);
    if (!storage) return false;
    try {
      if (encoded.length > maxEntryBytes) return false;
      const keys = readIndex().filter((k) => k !== key);
      keys.push(key);
      let total = 0;
      const sizes = new Map<string, number>();
      for (const k of keys) {
        const size = k === key ? encoded.length : (storage.getItem(prefix + k)?.length ?? 0);
        sizes.set(k, size);
        total += size;
      }
      while (total > cap && keys.length > 1) {
        const oldest = keys.shift()!;
        total -= sizes.get(oldest) ?? 0;
        storage.removeItem(prefix + oldest);
      }
      if (total > cap) {
        writeIndex([]);
        return false;
      }
      storage.setItem(prefix + key, encoded);
      writeIndex(keys);
      return true;
    } catch {
      return false;
    }
  }

  function getEncoded(key: string): string | null {
    const hit = encodedMemory.get(key);
    if (hit) return hit;
    try {
      return storage?.getItem(prefix + key) ?? null;
    } catch {
      return null;
    }
  }

  return {
    get(key) {
      const hit = memory.get(key);
      if (hit) return hit;
      try {
        const raw = getEncoded(key);
        if (!raw) return null;
        const bytes = decodeBytes(raw);
        memory.set(key, bytes);
        return bytes;
      } catch {
        return null;
      }
    },
    has(key) {
      return this.get(key) !== null;
    },
    set(key, bytes) {
      const buffer = (bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) as ArrayBuffer;
      memory.set(key, buffer);
      encodedMemory.delete(key);
      return setEncoded(key, encodeBytes(buffer));
    },
    getEncoded,
    setEncoded(key, encoded) {
      memory.delete(key);
      return setEncoded(key, encoded);
    },
    keys: () => readIndex(),
    clear() {
      memory.clear();
      encodedMemory.clear();
      if (!storage) return;
      for (const key of readIndex()) storage.removeItem(prefix + key);
      storage.removeItem(indexKey);
    },
  };
}
