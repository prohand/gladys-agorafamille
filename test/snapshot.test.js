import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RESERVATION_STATUS } from '../src/agora/parse.js';
import {
  SCENE_TRIGGERS,
  balanceOf,
  buildSnapshot,
  diffSnapshots,
  directDebitInvoices,
  hasMeal,
  invoicesToPay,
  treasuryInvoices,
  unpaidInvoices,
} from '../src/agora/snapshot.js';

const children = [{ id: '7', firstName: 'Léa', name: 'Léa' }];

function snapshot(overrides = {}) {
  return buildSnapshot({ today: '2026-11-04', children, ...overrides });
}

const invoice = (id, extra = {}) => ({
  id,
  label: `Facture ${id}`,
  amount: 40,
  remaining: 40,
  issuedOn: '2026-11-01',
  dueOn: '2026-11-30',
  paid: false,
  ...extra,
});

test('the first read fires nothing', () => {
  const current = snapshot({
    invoices: [invoice('F1', { dueOn: '2026-11-05' })],
    messages: [{ id: 'M1', subject: 'Bonjour', read: false }],
  });
  const { events, reminded } = diffSnapshots(null, current, { dueReminderDays: 3 });
  assert.deepEqual(events, []);
  // The invoice already close to its due date is not announced later either.
  assert.deepEqual(reminded, ['F1']);
});

test('a new unpaid invoice and a new message are events', () => {
  const previous = snapshot({ invoices: [invoice('F1')], messages: [] });
  const current = snapshot({
    invoices: [invoice('F1'), invoice('F2'), invoice('F3', { paid: true, remaining: 0 })],
    messages: [{ id: 'M1', subject: 'Grève', sender: 'Mairie', date: '2026-11-04', read: false }],
  });
  const { events } = diffSnapshots(previous, current, { dueReminderDays: 0 });
  assert.deepEqual(events, [
    {
      key: SCENE_TRIGGERS.INVOICE_ISSUED,
      data: {
        invoice_id: 'F2',
        label: 'Facture F2',
        amount: 40,
        due_date: '2026-11-30',
        direct_debit: false,
        debit_date: null,
      },
    },
    {
      key: SCENE_TRIGGERS.MESSAGE_RECEIVED,
      data: { subject: 'Grève', sender: 'Mairie', date: '2026-11-04' },
    },
  ]);
});

test('a module appearing is not a flood of news', () => {
  const previous = snapshot({ modules: { invoices: false } });
  const current = snapshot({ invoices: [invoice('F1')] });
  assert.deepEqual(diffSnapshots(previous, current, { dueReminderDays: 0 }).events, []);
});

test('an invoice due soon is reminded once', () => {
  const previous = snapshot({ invoices: [invoice('F1', { dueOn: '2026-11-10' })] });
  const current = snapshot({ invoices: [invoice('F1', { dueOn: '2026-11-06' })] });

  const first = diffSnapshots(previous, current, { dueReminderDays: 3 });
  assert.deepEqual(first.events, [
    {
      key: SCENE_TRIGGERS.INVOICE_DUE_SOON,
      data: {
        invoice_id: 'F1',
        label: 'Facture F1',
        amount: 40,
        due_date: '2026-11-06',
        days_left: 2,
      },
    },
  ]);
  const second = diffSnapshots(current, current, { dueReminderDays: 3, reminded: first.reminded });
  assert.deepEqual(second.events, []);

  // Paid: forgotten, so a re-opened invoice would be reminded again.
  const paid = snapshot({ invoices: [invoice('F1', { paid: true, remaining: 0 })] });
  assert.deepEqual(
    diffSnapshots(current, paid, { dueReminderDays: 3, reminded: first.reminded }).reminded,
    [],
  );
});

test('a day changing state is an event, a day entering the window is not', () => {
  const day = (status, date = '2026-11-05') => ({
    childId: '7',
    day: date,
    activity: 'Cantine',
    activityId: 'C',
    status,
  });
  const previous = snapshot({ planning: [day(RESERVATION_STATUS.REQUESTED)] });
  const current = snapshot({
    planning: [day(RESERVATION_STATUS.REFUSED), day(RESERVATION_STATUS.RESERVED, '2026-11-18')],
  });
  const { events } = diffSnapshots(previous, current, { dueReminderDays: 0 });
  assert.deepEqual(events, [
    {
      key: SCENE_TRIGGERS.RESERVATION_CHANGED,
      childId: '7',
      data: {
        child_name: 'Léa',
        activity: 'Cantine',
        date: '2026-11-05',
        status: RESERVATION_STATUS.REFUSED,
        previous_status: RESERVATION_STATUS.REQUESTED,
        meal: true,
      },
    },
  ]);
});

test('balance and canteen are computed from the read', () => {
  const current = snapshot({
    invoices: [invoice('F1'), invoice('F2', { remaining: 2.35 }), invoice('F3', { paid: true })],
    planning: [
      { childId: '7', day: '2026-11-04', activity: 'Cantine', activityId: 'C', status: 'reserved' },
      { childId: '7', day: '2026-11-05', activity: 'Cantine', activityId: 'C', status: 'absent' },
    ],
  });
  assert.equal(balanceOf(current), 42.35);
  assert.equal(hasMeal(current, '7', '2026-11-04'), true);
  assert.equal(hasMeal(current, '7', '2026-11-05'), false);
});

test('the balance is the exact sum, never rounded', () => {
  const current = snapshot({
    invoices: [
      invoice('F1', { remaining: 0.1 }),
      invoice('F2', { remaining: 0.2 }),
      invoice('F3', { remaining: 12.345 }),
    ],
  });
  assert.equal(balanceOf(current), 12.645);
});

test('an invoice sent to the Trésor public is set apart: not owed, never announced', () => {
  const before = snapshot({ invoices: [invoice('F1')] });
  const after = snapshot({
    invoices: [invoice('F1', { treasury: true }), invoice('F2', { treasury: true })],
  });
  assert.equal(balanceOf(after), 0);
  assert.deepEqual(unpaidInvoices(after), []);
  assert.deepEqual(
    treasuryInvoices(after).map((entry) => entry.id),
    ['F1', 'F2'],
  );
  // Neither the one set apart nor a new one sent straight there is news.
  const { events } = diffSnapshots(before, after, { dueReminderDays: 30 });
  assert.deepEqual(events, []);
});

test('an invoice paid by direct debit is owed but never a reminder to pay', () => {
  const before = snapshot({
    invoices: [invoice('F1', { directDebit: true, dueOn: '2026-11-10' })],
  });
  const after = snapshot({
    invoices: [
      invoice('F1', { directDebit: true, dueOn: '2026-11-06' }),
      invoice('F2', { directDebit: true, dueOn: '2026-11-05' }),
    ],
  });
  // Still owed: the bank has not paid it yet.
  assert.equal(balanceOf(after), 80);
  assert.deepEqual(invoicesToPay(after), []);
  assert.deepEqual(
    directDebitInvoices(after).map((entry) => entry.id),
    ['F2', 'F1'],
  );
  // A new one is news, said to be paid by direct debit; due soon is not.
  const { events, reminded } = diffSnapshots(before, after, { dueReminderDays: 3 });
  assert.deepEqual(
    events.map((event) => [event.key, event.data.invoice_id, event.data.direct_debit]),
    [[SCENE_TRIGGERS.INVOICE_ISSUED, 'F2', true]],
  );
  assert.deepEqual(reminded, []);
});
