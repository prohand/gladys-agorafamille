// -----------------------------------------------------------------------------
// One Agora Famille account, kept in sync.
//
// Reads the portal (children, planning over the watched days, invoices,
// messages), keeps the last snapshot, and hands every new one to the caller
// with the scene events it brings. One read at a time: a refresh asked from a
// scene while the timer's read is running waits for that read instead of
// starting a second session on the portal.
// -----------------------------------------------------------------------------

import { createLogger } from '../logging.js';
import { AgoraClient, AgoraError, ERROR_CODES } from './client.js';
import { addDays, dayOf } from './dates.js';
import { BOOKING_REFUSALS, cancellationLine, reservationLine } from './booking.js';
import { SCENE_TRIGGERS, buildSnapshot, diffSnapshots } from './snapshot.js';

const logger = createLogger({ name: 'sync' });

/** A refresh asked twice within this delay reads the portal once. */
export const MIN_REFRESH_INTERVAL_MS = 60_000;

/**
 * @param {object} options
 * @param {object} options.config normalized configuration
 * @param {object} options.store see src/agora/store.js
 * @param {typeof fetch} [options.fetch]
 * @param {() => Date} [options.now]
 */
export function createAgoraService({ config, store, fetch, now = () => new Date() }) {
  const client = config.configured
    ? new AgoraClient({
        apiBase: config.apiBase,
        origin: new URL(config.portalBase).origin,
        username: config.username,
        password: config.password,
        fetch,
      })
    : null;

  let snapshot = null;
  let reminded = [];
  let lastError = null;
  let lastAttemptAt = 0;
  let running = null;
  let loaded = false;

  /** The planning entry a request names, as the last read knows it. */
  function entryOf({ childId, day, activityId }) {
    return (
      snapshot?.planning.find(
        (entry) =>
          entry.childId === childId && entry.day === day && entry.activityId === activityId,
      ) ?? null
    );
  }

  /**
   * Send a booking line. A booking the portal puts in a basket to pay online
   * (ProviderInfo.Url) cannot be paid from Gladys: the basket is emptied the
   * way the portal's calendar does when the payment dialog is closed (the
   * same line, IdDefTarif -1, DeleteBasketEvent 0), and the parent is sent
   * to the portal.
   */
  async function bookLine(line, step) {
    const outputInfo = await client.book(line, step);
    const provider = outputInfo?.ProviderInfo ?? outputInfo?.providerInfo;
    if (provider?.Url) {
      logger.warn(`"${step}" needs an online payment: emptying the basket`);
      await client
        .book({ ...line, IdDefTarif: -1, DeleteBasketEvent: 0 }, step)
        .catch((err) => logger.error(`Emptying the basket failed: ${err.message}`));
      throw new AgoraError(ERROR_CODES.REFUSED, BOOKING_REFUSALS.PAYMENT.en, {
        step,
        reason: BOOKING_REFUSALS.PAYMENT,
      });
    }
  }

  function requireClient() {
    if (!client) {
      throw new AgoraError(ERROR_CODES.CONFIG, 'Not configured yet');
    }
  }

  async function load() {
    if (loaded) {
      return;
    }
    loaded = true;
    if (config.accountId) {
      ({ snapshot, reminded } = await store.load(config.accountId));
    }
  }

  async function read() {
    const today = dayOf(now());
    let children = await childrenOrNone();
    const planning = await client.getPlanning(today, addDays(today, config.days_ahead), children);
    if (children.length === 0) {
      children = childrenOfPlanning(planning);
    }
    // Invoices and messages are modules a municipality may not have bought:
    // a portal without them answers 404, which is "nothing", not a failure;
    // the same holds while their request is not captured yet.
    const modules = {};
    const invoices = await optional(() => client.getInvoices(), 'invoices', modules);
    const messages = await optional(() => client.getMessages(), 'messages', modules);
    return buildSnapshot({
      today,
      at: now().toISOString(),
      children,
      planning,
      invoices,
      messages,
      modules,
    });
  }

  // The planning of the API names each child by its id: without the request
  // that lists the children (not captured yet, see endpoints.js), the
  // children are the ones the planning names, "Enfant <id>" until their
  // names are known. The id is what the devices hang on, so the names can
  // come later without changing a device.
  async function childrenOrNone() {
    try {
      return await client.getChildren();
    } catch (err) {
      if (err instanceof AgoraError && err.code === ERROR_CODES.UNMAPPED) {
        return [];
      }
      throw err;
    }
  }

  async function run() {
    await load();
    if (!client) {
      lastError = new AgoraError(ERROR_CODES.CONFIG, 'Not configured yet');
      return { snapshot, events: [], error: lastError };
    }
    lastAttemptAt = now().getTime();
    try {
      const current = await read();
      const diff = diffSnapshots(snapshot, current, {
        dueReminderDays: config.due_reminder_days,
        reminded,
      });
      snapshot = current;
      reminded = diff.reminded;
      lastError = null;
      await store.save(config.accountId, { snapshot, reminded });
      logger.info(
        `Portal read: ${current.children.length} child(ren), ${current.planning.length} ` +
          `planned day(s), ${current.invoices.length} invoice(s), ` +
          `${current.messages.length} message(s), ${diff.events.length} event(s)`,
      );
      return { snapshot, events: diff.events, error: null };
    } catch (err) {
      lastError = err instanceof AgoraError ? err : new AgoraError(ERROR_CODES.FORMAT, err.message);
      logger.warn(`Portal read failed (${lastError.step ?? 'read'}): ${lastError.message}`);
      return { snapshot, events: [], error: lastError };
    }
  }

  return {
    client,

    /** Read the last snapshot kept in /data, before the first portal read. */
    load,

    /**
     * Read the portal now.
     *
     * @param {{force?: boolean}} [options] `force` skips the minimum interval
     *   (the timer, a configuration change); a scene or a widget tap does not.
     */
    async sync({ force = false } = {}) {
      if (running) {
        return running;
      }
      if (!force && snapshot && now().getTime() - lastAttemptAt < MIN_REFRESH_INTERVAL_MS) {
        return { snapshot, events: [], error: lastError };
      }
      running = run().finally(() => {
        running = null;
      });
      return running;
    },

    get snapshot() {
      return snapshot;
    },

    get lastError() {
      return lastError;
    },

    /** Ask the portal to book a day, then read it again to show the result. */
    async requestReservation(request) {
      requireClient();
      const line = reservationLine(entryOf(request), dayOf(now()));
      await bookLine(line, 'reserve');
      return this.syncAfter(request);
    },

    /** Ask the portal to cancel a day, then read it again to show the result. */
    async requestAbsence(request) {
      requireClient();
      const line = cancellationLine(entryOf(request), dayOf(now()));
      await bookLine(line, 'absence');
      return this.syncAfter(request);
    },

    /**
     * The read that follows a request. The change of the requested day is the
     * request itself, not news: a scene bound to "a booking changes" would
     * otherwise run because of an action, and could loop through it. Every
     * other change found on the way (a new invoice) is kept.
     */
    async syncAfter({ childId, day }) {
      // A read started before the request does not show it: wait for it,
      // then read again.
      if (running) {
        await running;
      }
      const result = await this.sync({ force: true });
      return {
        ...result,
        events: result.events.filter(
          (event) =>
            !(
              event.key === SCENE_TRIGGERS.RESERVATION_CHANGED &&
              event.childId === childId &&
              event.data.date === day
            ),
        ),
      };
    },
  };
}

async function optional(read, module, modules) {
  try {
    return await read();
  } catch (err) {
    // Not bought (404), or the request is not captured yet: no data, not a failure.
    const missing =
      err instanceof AgoraError && err.code === ERROR_CODES.HTTP && err.status === 404;
    if (missing || (err instanceof AgoraError && err.code === ERROR_CODES.UNMAPPED)) {
      modules[module] = false;
      return [];
    }
    throw err;
  }
}

/** The children a planning names, when nothing else names them. */
export function childrenOfPlanning(planning) {
  const ids = [...new Set(planning.map((entry) => entry.childId))].sort();
  return ids.map((id) => ({ id, firstName: `Enfant ${id}`, lastName: null, name: `Enfant ${id}` }));
}
