// -----------------------------------------------------------------------------
// The state kept in /data (the only writable place of the container): the
// reference of the billed index and the value held back, so that a restart
// never forgets a jump the user has not accepted. A small JSON file, written
// through a temporary file and a rename. Failures are logged, never fatal.
//
// A missing file is empty; a file that cannot be read or parsed is NOT: load()
// throws, and src/app.js then writes nothing over it (it tries again later).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';

export const DEFAULT_STATE_FILE = '/data/iometer-state.json';
/** A state file larger than this is not ours: unreadable. */
const MAX_STATE_BYTES = 256 * 1024;

export class StoreUnreadable extends Error {
  constructor(code) {
    super(`the /data state cannot be read (${code})`);
    this.name = 'StoreUnreadable';
    this.code = code;
  }
}

export function createFileStore(file = DEFAULT_STATE_FILE) {
  return {
    load() {
      let text;
      try {
        text = readFileSync(file, 'utf8');
      } catch (err) {
        if (err?.code === 'ENOENT') return {};
        throw new StoreUnreadable(typeof err?.code === 'string' ? err.code : 'error');
      }
      if (text.length > MAX_STATE_BYTES) throw new StoreUnreadable('too_large');
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new StoreUnreadable('not_json');
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new StoreUnreadable('not_object');
      }
      return data;
    },
    async save(data) {
      const tmp = `${file}.tmp`;
      await writeFile(tmp, JSON.stringify(data), 'utf8');
      await rename(tmp, file);
    },
  };
}

/** The same in memory (tests); `fail` makes load() throw (an unreadable /data). */
export function createMemoryStore(initial = {}) {
  let data = structuredClone(initial);
  const store = {
    fail: false,
    load: () => {
      if (store.fail) throw new StoreUnreadable('EIO');
      return structuredClone(data);
    },
    async save(next) {
      data = structuredClone(next);
    },
    get data() {
      return data;
    },
  };
  return store;
}
