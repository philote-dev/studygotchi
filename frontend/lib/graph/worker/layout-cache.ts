/**
 * Settled positions by layout hash: a module Map mirrored into
 * `sessionStorage` (base64 of the Float64Array), so a revisit of /knowledge in
 * the same tab applies positions instantly instead of settling again. Capped
 * at 2 MB of storage, oldest entries evicted first. Pure apart from the
 * injectable storage, so it runs under node tests and SSR (no storage).
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const LAYOUT_CACHE_PREFIX = "sg.layout.";
export const LAYOUT_CACHE_INDEX = "sg.layout.index";
export const LAYOUT_CACHE_CAP_BYTES = 2 * 1024 * 1024;

export interface LayoutCache {
  get(hash: string): Float64Array | null;
  set(hash: string, positions: Float64Array): void;
  has(hash: string): boolean;
  clear(): void;
  /** Hashes in storage order, oldest first (for tests and the eviction rule). */
  keys(): string[];
}

export function encodePositions(positions: Float64Array): string {
  const bytes = new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function decodePositions(text: string): Float64Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Float64Array(bytes.buffer, 0, Math.floor(bytes.length / 8));
}

function defaultStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function createLayoutCache(storage: StorageLike | null = defaultStorage(), cap = LAYOUT_CACHE_CAP_BYTES): LayoutCache {
  const memory = new Map<string, Float64Array>();

  const readIndex = (): string[] => {
    try {
      const raw = storage?.getItem(LAYOUT_CACHE_INDEX);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
    } catch {
      return [];
    }
  };
  const writeIndex = (keys: string[]) => {
    try {
      storage?.setItem(LAYOUT_CACHE_INDEX, JSON.stringify(keys));
    } catch {
      /* quota or privacy mode: memory only */
    }
  };

  return {
    get(hash) {
      const hit = memory.get(hash);
      if (hit) return hit;
      try {
        const raw = storage?.getItem(LAYOUT_CACHE_PREFIX + hash);
        if (!raw) return null;
        const positions = decodePositions(raw);
        memory.set(hash, positions);
        return positions;
      } catch {
        return null;
      }
    },
    has(hash) {
      return this.get(hash) !== null;
    },
    set(hash, positions) {
      memory.set(hash, positions);
      if (!storage) return;
      try {
        const encoded = encodePositions(positions);
        let keys = readIndex().filter((k) => k !== hash);
        keys.push(hash);
        let bytes = 0;
        const sizes = new Map<string, number>();
        for (const key of keys) {
          const size = key === hash ? encoded.length : (storage.getItem(LAYOUT_CACHE_PREFIX + key)?.length ?? 0);
          sizes.set(key, size);
          bytes += size;
        }
        while (bytes > cap && keys.length > 1) {
          const oldest = keys.shift()!;
          bytes -= sizes.get(oldest) ?? 0;
          storage.removeItem(LAYOUT_CACHE_PREFIX + oldest);
        }
        if (bytes > cap) {
          keys = [];
        } else {
          storage.setItem(LAYOUT_CACHE_PREFIX + hash, encoded);
        }
        writeIndex(keys);
      } catch {
        /* quota: memory only */
      }
    },
    clear() {
      memory.clear();
      if (!storage) return;
      for (const key of readIndex()) storage.removeItem(LAYOUT_CACHE_PREFIX + key);
      storage.removeItem(LAYOUT_CACHE_INDEX);
    },
    keys() {
      return readIndex();
    },
  };
}
