// -----------------------------------------------------------------------------
// The Gladys devices of one Agora Famille account.
//
//   - the family account: what is owed, the next invoice, the last message;
//   - one device per child: what they are booked for today and tomorrow, and
//     whether they eat at the canteen — the two questions a family asks the
//     portal every evening.
//
// Everything is read-only: the integration reads the portal, it never books
// nor cancels anything there.
//
// External ids are forever (Gladys keys history, scenes and dashboards on
// them): the account is the commune plus a hash of the login, a child is the
// id the portal gives it — never a name, which a family may correct.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
  DEVICE_TRANSPORTS,
} from '@gladysassistant/integration-sdk';
import { NOTHING_PLANNED, formatAmount } from '../messages.js';
import {
  balanceOf,
  dayAt,
  expectedActivities,
  hasMeal,
  unpaidInvoices,
} from '../agora/snapshot.js';

export const DEVICE_TYPES = { ACCOUNT: 'account', CHILD: 'child' };

export const ACCOUNT_FEATURES = {
  BALANCE: 'balance',
  NEXT_INVOICE: 'next-invoice',
  LAST_MESSAGE: 'last-message',
};

export const CHILD_FEATURES = {
  TODAY: 'today',
  TOMORROW: 'tomorrow',
  MEAL_TODAY: 'meal-today',
  MEAL_TOMORROW: 'meal-tomorrow',
};

/** A balance above this is a parsing error rather than a school bill. */
const MAX_BALANCE = 10_000;

/** Text features hold a sentence, not a report. */
const MAX_TEXT_LENGTH = 200;

/** Unchanged states are sent again this often, so Gladys keeps them dated. */
export const STATE_HEARTBEAT_MS = 6 * 60 * 60 * 1000;

export function accountIds(gladys, config) {
  return gladys.externalIds(DEVICE_TYPES.ACCOUNT, config.accountId);
}

export function childIds(gladys, config, childId) {
  return gladys.externalIds(DEVICE_TYPES.CHILD, `${config.commune}-${slug(childId)}`);
}

/**
 * The discovery payload: the account, and one device per child the portal
 * knows. Nothing before the configuration names an account.
 */
export function buildDevices(gladys, config, snapshot) {
  if (!config.accountId) {
    return [];
  }
  const account = accountIds(gladys, config);
  const devices = [
    {
      name: 'Agora Famille',
      external_id: account.device,
      features: [
        {
          name: 'Balance due',
          external_id: account.feature(ACCOUNT_FEATURES.BALANCE),
          category: DEVICE_FEATURE_CATEGORIES.CURRENCY,
          type: DEVICE_FEATURE_TYPES.CURRENCY.DECIMAL,
          unit: DEVICE_FEATURE_UNITS.EURO,
          min: 0,
          max: MAX_BALANCE,
          read_only: true,
          has_feedback: false,
          keep_history: true,
        },
        textFeature('Next invoice', account.feature(ACCOUNT_FEATURES.NEXT_INVOICE)),
        textFeature('Last message', account.feature(ACCOUNT_FEATURES.LAST_MESSAGE)),
      ],
    },
  ];
  for (const child of snapshot?.children ?? []) {
    const ids = childIds(gladys, config, child.id);
    devices.push({
      name: child.name,
      external_id: ids.device,
      params: [{ name: 'agora_child_id', value: child.id }],
      features: [
        textFeature('Today', ids.feature(CHILD_FEATURES.TODAY)),
        textFeature('Tomorrow', ids.feature(CHILD_FEATURES.TOMORROW)),
        binaryFeature('Canteen today', ids.feature(CHILD_FEATURES.MEAL_TODAY)),
        binaryFeature('Canteen tomorrow', ids.feature(CHILD_FEATURES.MEAL_TOMORROW)),
      ],
    });
  }
  return devices;
}

function textFeature(name, externalId) {
  return {
    name,
    external_id: externalId,
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
    min: 0,
    max: 0,
    read_only: true,
    has_feedback: false,
    keep_history: false,
  };
}

// A read-only switch: 1 = the child eats at the canteen that day. It is what a
// scene condition "if X eats at the canteen tomorrow" reads.
function binaryFeature(name, externalId) {
  return {
    name,
    external_id: externalId,
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
    min: 0,
    max: 1,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  };
}

/**
 * The states of every device, from a snapshot. Texts are written in the
 * language of the household (French: the portal and its activities are), the
 * activity names being the municipality's own.
 *
 * @returns {Array<{device_feature_external_id: string, state?: number, text?: string}>}
 */
export function buildStates(gladys, config, snapshot) {
  if (!config.accountId || !snapshot) {
    return [];
  }
  const account = accountIds(gladys, config);
  const states = [
    {
      device_feature_external_id: account.feature(ACCOUNT_FEATURES.BALANCE),
      state: balanceOf(snapshot),
    },
    {
      device_feature_external_id: account.feature(ACCOUNT_FEATURES.NEXT_INVOICE),
      text: describeNextInvoice(snapshot),
    },
    {
      device_feature_external_id: account.feature(ACCOUNT_FEATURES.LAST_MESSAGE),
      text: describeLastMessage(snapshot),
    },
  ];
  const today = dayAt(snapshot, 0);
  const tomorrow = dayAt(snapshot, 1);
  for (const child of snapshot.children) {
    const ids = childIds(gladys, config, child.id);
    states.push(
      {
        device_feature_external_id: ids.feature(CHILD_FEATURES.TODAY),
        text: describeDay(snapshot, child.id, today),
      },
      {
        device_feature_external_id: ids.feature(CHILD_FEATURES.TOMORROW),
        text: describeDay(snapshot, child.id, tomorrow),
      },
      {
        device_feature_external_id: ids.feature(CHILD_FEATURES.MEAL_TODAY),
        state: hasMeal(snapshot, child.id, today) ? 1 : 0,
      },
      {
        device_feature_external_id: ids.feature(CHILD_FEATURES.MEAL_TOMORROW),
        state: hasMeal(snapshot, child.id, tomorrow) ? 1 : 0,
      },
    );
  }
  return states;
}

/** "Cantine, Garderie du soir", or "Rien de réservé". */
export function describeDay(snapshot, childId, day, language = 'fr') {
  const activities = expectedActivities(snapshot, childId, day).map((entry) => entry.activity);
  const text = activities.length > 0 ? activities.join(', ') : NOTHING_PLANNED[language];
  return truncate(text);
}

function describeNextInvoice(snapshot) {
  const [next] = unpaidInvoices(snapshot);
  if (!next) {
    return 'Aucune facture à payer';
  }
  const amount = formatAmount(next.remaining, 'fr');
  const day = next.dueOn?.split('-').reverse().join('/');
  // The bank pays it on its own: say so rather than "pay before".
  const due = next.directDebit
    ? ` prélevés${day ? ` le ${day}` : ''}`
    : day
      ? ` avant le ${day}`
      : '';
  return truncate(`${amount} €${due} — ${next.label}`);
}

function describeLastMessage(snapshot) {
  const [last] = snapshot.messages ?? [];
  return last ? truncate(last.subject) : 'Aucun message';
}

/**
 * The transport badge of every device: the portal is a cloud service, and
 * `unreachable` while it cannot be read.
 */
export function buildTransports(gladys, config, snapshot, reachable) {
  return buildDevices(gladys, config, snapshot).map((device) => ({
    external_id: device.external_id,
    transport: reachable ? DEVICE_TRANSPORTS.CLOUD : DEVICE_TRANSPORTS.UNREACHABLE,
  }));
}

/** The portal id of the child behind a device external id, or null. */
export function childOfDevice(gladys, config, snapshot, externalId) {
  return (
    (snapshot?.children ?? []).find(
      (child) => childIds(gladys, config, child.id).device === externalId,
    ) ?? null
  );
}

function truncate(text) {
  return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH - 1)}…` : text;
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
