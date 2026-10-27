// -----------------------------------------------------------------------------
// Scenes (Gladys 5.1+): what happened on the portal, and what a scene can ask.
//
// Triggers, declared in the manifest `scene_triggers` (fired from the
// differences between two reads, see src/agora/snapshot.js):
//
//   invoice_issued        a new invoice is waiting to be paid
//   invoice_due_soon      an unpaid invoice reaches its due date soon (once)
//   message_received      the municipality sent a message
//   reservation_changed   a booked or requested day changed state (accepted,
//                         refused, cancelled…)
//
// Actions, declared in the manifest `scene_actions` — reads only: the
// integration never books nor cancels anything on the portal.
//
//   refresh               read the portal now
//   check_day             is a child booked on a day, and for what
//
// The doctrine of the core: an event is not a state (the canteen of tomorrow is
// a device feature), and one event per change.
// -----------------------------------------------------------------------------

import { createLogger } from '../logging.js';
import { addDays } from '../agora/dates.js';
import { RESERVATION_STATUS } from '../agora/parse.js';
import {
  SCENE_TRIGGERS,
  balanceOf,
  expectedActivities,
  hasMeal,
  unpaidInvoices,
  unreadMessages,
} from '../agora/snapshot.js';
import { childIds, childOfDevice } from '../devices/index.js';
import { describeError } from '../messages.js';

const logger = createLogger({ name: 'scenes' });

export { SCENE_TRIGGERS };

/** Keys of the manifest `scene_actions`. Never renamed: scenes store them. */
export const SCENE_ACTIONS = {
  REFRESH: 'refresh',
  CHECK_DAY: 'check_day',
};

/** The reservation states a `reservation_changed` filter offers. */
export const TRIGGER_STATUSES = Object.values(RESERVATION_STATUS);

/**
 * Fire the scene triggers of a read. Never throws: a trigger the core refused
 * (429, a Gladys too old) must not cost the devices their states.
 */
export async function publishEvents(gladys, config, events) {
  for (const event of events) {
    const data = { ...event.data };
    if (event.childId) {
      data.device = childIds(gladys, config, event.childId).device;
    }
    try {
      await gladys.publishSceneEvent(event.key, data);
      logger.info(`Scene event ${event.key}`);
    } catch (err) {
      logger.warn(`Scene event ${event.key} not delivered: ${err.message}`);
    }
  }
}

/**
 * The scene action handlers, keyed by manifest key.
 *
 * @param {object} context
 * @param {object} context.gladys
 * @param {() => object} context.getConfig the current normalized config
 * @param {() => object} context.getService the current AgoraService
 * @param {(result: object) => Promise<void>} context.onSynced publish a read
 */
export function createSceneActions({ gladys, getConfig, getService, onSynced }) {
  async function sync() {
    const result = await getService().sync();
    await onSynced(result);
    if (result.error && !result.snapshot) {
      throw new Error(describeError(result.error).en);
    }
    return result.snapshot;
  }

  /** The child a `"source": "devices"` field points at. */
  async function childOf(fields, snapshot) {
    const child = childOfDevice(gladys, getConfig(), snapshot, fields.child);
    if (!child) {
      throw new Error('Pick one of the children of the family (an Agora Famille child device)');
    }
    return child;
  }

  return {
    async [SCENE_ACTIONS.REFRESH]() {
      const result = await getService().sync({ force: true });
      await onSynced(result);
      const { snapshot, error } = result;
      return {
        success: !error,
        balance: balanceOf(snapshot),
        unpaid_invoices: unpaidInvoices(snapshot).length,
        unread_messages: unreadMessages(snapshot).length,
      };
    },

    async [SCENE_ACTIONS.CHECK_DAY](fields) {
      const snapshot = await sync();
      const child = await childOf(fields, snapshot);
      const day = addDays(snapshot.today, dayOffset(fields.day));
      const activities = expectedActivities(snapshot, child.id, day).map((entry) => entry.activity);
      return {
        date: day,
        has_meal: hasMeal(snapshot, child.id, day),
        booked_count: activities.length,
        activities: activities.join(', '),
      };
    },
  };
}

/** Days from today: 0 today, 1 tomorrow… */
function dayOffset(value) {
  const number = Math.round(Number(value ?? 0));
  return Number.isFinite(number) ? Math.max(0, Math.min(60, number)) : 0;
}
