// -----------------------------------------------------------------------------
// What the portal said at the last read, and what changed since the one before.
//
// A snapshot is the whole family at one instant: children, their planning over
// the watched days, the invoices and the messages. The devices, the widget and
// the scene actions read it; comparing two of them gives the scene triggers.
//
// The portal says what IS, never what HAPPENED: a new invoice is an invoice
// that was not there at the previous read. So the first read of an account
// fires nothing — everything would look new, and a family installing the
// integration would get two years of invoices as "new invoice" events.
// -----------------------------------------------------------------------------

import { addDays, daysBetween } from './dates.js';
import { EXPECTED_STATUSES, RESERVATION_STATUS, exact, isMeal, reservationKey } from './parse.js';

/** Keys of the manifest `scene_triggers`. Never renamed: scenes store them. */
export const SCENE_TRIGGERS = {
  INVOICE_ISSUED: 'invoice_issued',
  INVOICE_DUE_SOON: 'invoice_due_soon',
  MESSAGE_RECEIVED: 'message_received',
  RESERVATION_CHANGED: 'reservation_changed',
};

/**
 * @param {object} parts what the portal answered
 * @param {string} parts.today `YYYY-MM-DD`
 * @param {string} [parts.at] ISO instant of the read
 * @returns {object} the snapshot
 */
export function buildSnapshot({
  today,
  at,
  children = [],
  planning = [],
  invoices = [],
  messages = [],
  modules,
}) {
  return {
    at: at ?? new Date().toISOString(),
    today,
    children,
    planning,
    invoices,
    messages,
    modules: { invoices: true, messages: true, ...modules },
  };
}

/**
 * The invoices still to pay, the one due first first. An invoice sent to the
 * Trésor public is not one of them: the portal shows it unpaid forever, paid
 * to the Trésor or not (see treasuryInvoices).
 */
export function unpaidInvoices(snapshot) {
  return openInvoices(snapshot).filter((invoice) => !invoice.treasury);
}

/**
 * The invoices the bank pays on its own (prélèvement automatique): still owed,
 * so counted in the balance, but nothing for the family to do.
 */
export function directDebitInvoices(snapshot) {
  return unpaidInvoices(snapshot).filter((invoice) => invoice.directDebit);
}

/** The invoices the family has to pay themselves. */
export function invoicesToPay(snapshot) {
  return unpaidInvoices(snapshot).filter((invoice) => !invoice.directDebit);
}

/** The invoices the portal shows unpaid but the Trésor public collects. */
export function treasuryInvoices(snapshot) {
  return openInvoices(snapshot).filter((invoice) => invoice.treasury);
}

function openInvoices(snapshot) {
  return (snapshot?.invoices ?? [])
    .filter((invoice) => !invoice.paid && invoice.remaining > 0)
    .sort((a, b) => (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999'));
}

/** What the family owes, in euros, to the last decimal the portal gives. */
export function balanceOf(snapshot) {
  const total = unpaidInvoices(snapshot).reduce((sum, invoice) => sum + invoice.remaining, 0);
  return exact(total);
}

export function unreadMessages(snapshot) {
  return (snapshot?.messages ?? []).filter((message) => !message.read);
}

/**
 * The activities a child is expected at on a day (booked, or asked for and not
 * answered yet).
 *
 * @param {object} snapshot
 * @param {string} childId
 * @param {string} day `YYYY-MM-DD`
 */
export function expectedActivities(snapshot, childId, day) {
  return (snapshot?.planning ?? []).filter(
    (entry) =>
      entry.childId === childId && entry.day === day && EXPECTED_STATUSES.includes(entry.status),
  );
}

/** Every planned entry of a child on a day, whatever its state. */
export function dayEntries(snapshot, childId, day) {
  return (snapshot?.planning ?? []).filter(
    (entry) => entry.childId === childId && entry.day === day,
  );
}

/** Whether a child eats at the school canteen on a day. */
export function hasMeal(snapshot, childId, day) {
  return expectedActivities(snapshot, childId, day).some((entry) => isMeal(entry.activity));
}

/** The day `offset` days after the day of the snapshot. */
export function dayAt(snapshot, offset) {
  return addDays(snapshot.today, offset);
}

/**
 * The scene events between two snapshots.
 *
 * @param {object|null} previous the snapshot before, `null` on the first read
 * @param {object} current
 * @param {object} options
 * @param {number} options.dueReminderDays 0 turns the reminder off
 * @param {Array<string>} [options.reminded] invoices already reminded of
 * @returns {{events: Array<{key: string, data: object}>, reminded: Array<string>}}
 */
export function diffSnapshots(previous, current, { dueReminderDays, reminded = [] }) {
  const events = [];
  const remindedNow = new Set(reminded);
  const unpaid = unpaidInvoices(current);
  // No "pay before" reminder for what the bank pays on its own.
  const toPay = invoicesToPay(current);

  // Forget what is no longer to pay: an invoice paid then re-opened is
  // reminded of again.
  for (const id of [...remindedNow]) {
    if (!unpaid.some((invoice) => invoice.id === id)) {
      remindedNow.delete(id);
    }
  }

  if (!previous) {
    // First read: everything already there is the starting point, the
    // invoices already close to their due date included.
    for (const invoice of toPay) {
      if (isDueSoon(invoice, current.today, dueReminderDays)) {
        remindedNow.add(invoice.id);
      }
    }
    return { events, reminded: [...remindedNow] };
  }

  const knownInvoices = new Set((previous.invoices ?? []).map((invoice) => invoice.id));
  // A portal without the invoice module answered nothing before: its first
  // invoices are not news, they are the module appearing.
  if (previous.modules?.invoices !== false) {
    for (const invoice of current.invoices) {
      if (!knownInvoices.has(invoice.id) && !invoice.paid && !invoice.treasury) {
        events.push({
          key: SCENE_TRIGGERS.INVOICE_ISSUED,
          data: {
            invoice_id: invoice.id,
            label: invoice.label,
            amount: invoice.amount,
            due_date: invoice.dueOn,
            direct_debit: invoice.directDebit === true,
            debit_date: invoice.debitOn ?? null,
          },
        });
      }
    }
  }

  for (const invoice of toPay) {
    if (remindedNow.has(invoice.id) || !isDueSoon(invoice, current.today, dueReminderDays)) {
      continue;
    }
    remindedNow.add(invoice.id);
    events.push({
      key: SCENE_TRIGGERS.INVOICE_DUE_SOON,
      data: {
        invoice_id: invoice.id,
        label: invoice.label,
        amount: invoice.remaining,
        due_date: invoice.dueOn,
        days_left: daysBetween(current.today, invoice.dueOn),
      },
    });
  }

  const knownMessages = new Set((previous.messages ?? []).map((message) => message.id));
  if (previous.modules?.messages !== false) {
    for (const message of current.messages) {
      if (!knownMessages.has(message.id)) {
        events.push({
          key: SCENE_TRIGGERS.MESSAGE_RECEIVED,
          data: { subject: message.subject, sender: message.sender, date: message.date },
        });
      }
    }
  }

  // A day that enters the watched window is not a change: only a day known on
  // both sides whose state moved is one (the municipality accepted, refused,
  // the family cancelled from the portal).
  const before = new Map(
    (previous.planning ?? []).map((entry) => [reservationKey(entry), entry.status]),
  );
  for (const entry of current.planning) {
    const previousStatus = before.get(reservationKey(entry));
    if (previousStatus === undefined || previousStatus === entry.status) {
      continue;
    }
    const child = current.children.find((candidate) => candidate.id === entry.childId);
    events.push({
      key: SCENE_TRIGGERS.RESERVATION_CHANGED,
      childId: entry.childId,
      data: {
        child_name: child?.name ?? null,
        activity: entry.activity,
        date: entry.day,
        status: entry.status,
        previous_status: previousStatus,
        meal: isMeal(entry.activity),
      },
    });
  }

  return { events, reminded: [...remindedNow] };
}

function isDueSoon(invoice, today, dueReminderDays) {
  if (!dueReminderDays || !invoice.dueOn) {
    return false;
  }
  const left = daysBetween(today, invoice.dueOn);
  return left >= 0 && left <= dueReminderDays;
}

export { RESERVATION_STATUS };
