// -----------------------------------------------------------------------------
// What the integration remembers across restarts, in /data.
//
// The scene triggers are differences between two reads of the portal: without
// the previous read, every restart (an update, a Gladys reboot) would either
// fire nothing for what happened while it was down, or everything at once.
// Kept: the last snapshot, the invoices already reminded of, and the account it
// belongs to — a snapshot of another account is never compared with this one.
//
// `/data` is the one writable path of the container. The file holds the
// family's planning and invoices: it stays there, never in the logs.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '../logging.js';

const logger = createLogger({ name: 'store' });

const FILE_NAME = 'agora-state.json';
const VERSION = 1;

/**
 * @param {string} [directory] defaults to `AGORA_DATA_DIR`, then `/data`
 */
export function createStore(directory = process.env.AGORA_DATA_DIR || '/data') {
  const file = join(directory, FILE_NAME);

  return {
    file,

    /**
     * @param {string|null} accountId the account the state must belong to
     * @returns {Promise<{snapshot: object|null, reminded: Array<string>}>}
     */
    async load(accountId) {
      try {
        const state = JSON.parse(await readFile(file, 'utf8'));
        if (state?.version !== VERSION || state.accountId !== accountId) {
          return { snapshot: null, reminded: [] };
        }
        return { snapshot: state.snapshot ?? null, reminded: state.reminded ?? [] };
      } catch (err) {
        if (err.code !== 'ENOENT') {
          logger.warn(`Could not read ${file}, starting afresh: ${err.message}`);
        }
        return { snapshot: null, reminded: [] };
      }
    },

    async save(accountId, { snapshot, reminded }) {
      try {
        await mkdir(directory, { recursive: true });
        // Written aside then renamed: a container stopped mid-write never
        // leaves half a file behind.
        const temporary = `${file}.tmp`;
        await writeFile(
          temporary,
          JSON.stringify({ version: VERSION, accountId, snapshot, reminded }),
          'utf8',
        );
        await rename(temporary, file);
      } catch (err) {
        logger.warn(`Could not write ${file}: ${err.message}`);
      }
    },
  };
}
