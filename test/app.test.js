import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createApp } from '../src/app.js';
import { normalizeConfig } from '../src/config.js';
import { ENDPOINTS } from '../src/agora/endpoints.js';
import { CHILD_FEATURES, ACCOUNT_FEATURES, accountIds, childIds } from '../src/devices/index.js';
import { FAMILY_WIDGET, WIDGET_ACTIONS } from '../src/capabilities/widget.js';
import { SCENE_ACTIONS, SCENE_TRIGGERS } from '../src/capabilities/scenes.js';
import { CONFIG, createFakePortal, createMemoryStore, useTestPaths } from './helpers/fakePortal.js';

let restorePaths;
before(() => {
  restorePaths = useTestPaths();
});
after(() => restorePaths());

// Wednesday 4 November 2026, 10:00 in Paris.
const NOW = new Date('2026-11-04T09:00:00Z');

function family() {
  return createFakePortal({
    planning: [
      {
        idEnfant: 101,
        date: '04/11/2026',
        libelleActivite: 'Cantine',
        idActivite: 'CAN',
        etat: 'Réservé',
      },
      {
        idEnfant: 101,
        date: '04/11/2026',
        libelleActivite: 'Garderie soir',
        idActivite: 'GS',
        etat: 'Réservé',
      },
      {
        idEnfant: 101,
        date: '05/11/2026',
        libelleActivite: 'Cantine',
        idActivite: 'CAN',
        etat: 'Inscrit',
      },
      {
        idEnfant: 102,
        date: '05/11/2026',
        libelleActivite: 'Cantine',
        idActivite: 'CAN',
        etat: 'Demande de réservation',
      },
    ],
    invoices: [
      { numFacture: 'F10', libelle: 'Octobre 2026', montant: '45,20', dateEcheance: '20/11/2026' },
      { numFacture: 'F09', libelle: 'Septembre 2026', montant: 38, payee: true },
    ],
    messages: [{ idMessage: 1, objet: 'Menus de novembre', expediteur: 'Service enfance' }],
  });
}

async function start(portal = family(), store = createMemoryStore(), extra = {}) {
  const gladys = createFakeGladys({ config: { ...CONFIG, ...extra } });
  const app = createApp(gladys, { fetch: portal.fetch, store, now: () => NOW });
  await gladys.connect();
  return { gladys, app, portal, store };
}

const config = normalizeConfig(CONFIG);

test('the account and one device per child are published, with their states', async (t) => {
  const { gladys, app } = await start();
  t.after(() => app.stop());

  const names = gladys.fake.discoveredDevices.map((device) => device.name);
  assert.deepEqual(names, ['Agora Famille', 'Léa', 'Tom']);

  const account = accountIds(gladys, config);
  const lea = childIds(gladys, config, '101');
  const tom = childIds(gladys, config, '102');
  assert.equal(gladys.fake.lastState(account.feature(ACCOUNT_FEATURES.BALANCE)), 45.2);
  assert.equal(gladys.fake.lastState(lea.feature(CHILD_FEATURES.TODAY)), 'Cantine, Garderie soir');
  assert.equal(gladys.fake.lastState(lea.feature(CHILD_FEATURES.TOMORROW)), 'Rien de réservé');
  assert.equal(gladys.fake.lastState(lea.feature(CHILD_FEATURES.MEAL_TODAY)), 1);
  assert.equal(gladys.fake.lastState(lea.feature(CHILD_FEATURES.MEAL_TOMORROW)), 0);
  // Asked for and not answered yet: expected, so it counts.
  assert.equal(gladys.fake.lastState(tom.feature(CHILD_FEATURES.MEAL_TOMORROW)), 1);

  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.ok(gladys.fake.transports.every((entry) => entry.transport === 'cloud'));
  // First read: nothing announced.
  assert.deepEqual(gladys.fake.sceneEvents, []);
});

test('the next read fires the scene triggers of what changed', async (t) => {
  const { gladys, app, portal } = await start();
  t.after(() => app.stop());

  portal.invoices.push({
    numFacture: 'F11',
    libelle: 'Novembre 2026',
    montant: 12,
    dateEcheance: '06/11/2026',
  });
  portal.messages.push({ idMessage: 2, objet: 'Grève jeudi', expediteur: 'Mairie' });
  portal.planning[3].etat = 'Refusé';

  const ack = await gladys.fake.sceneAction(SCENE_ACTIONS.REFRESH, {});
  assert.equal(ack.success, true);
  assert.deepEqual(ack.data.outputs ?? ack.data, {
    success: true,
    balance: 57.2,
    unpaid_invoices: 2,
    unread_messages: 2,
  });

  const keys = gladys.fake.sceneEvents.map((event) => event.key ?? event.trigger);
  assert.deepEqual(keys.sort(), [
    SCENE_TRIGGERS.INVOICE_DUE_SOON,
    SCENE_TRIGGERS.INVOICE_ISSUED,
    SCENE_TRIGGERS.MESSAGE_RECEIVED,
    SCENE_TRIGGERS.RESERVATION_CHANGED,
  ]);
  const changed = gladys.fake.sceneEvents.find(
    (event) => (event.key ?? event.trigger) === SCENE_TRIGGERS.RESERVATION_CHANGED,
  );
  assert.equal(changed.data.device, childIds(gladys, config, '102').device);
  assert.equal(changed.data.status, 'refused');
});

test('a scene declares an absence, and the read that follows fires nothing', async (t) => {
  const { gladys, app, portal } = await start();
  t.after(() => app.stop());

  const lea = childIds(gladys, config, '101').device;
  const before = gladys.fake.sceneEvents.length;
  const ack = await gladys.fake.sceneAction(SCENE_ACTIONS.DECLARE_ABSENCE, {
    child: lea,
    day: 0,
    activity: 'cantine',
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(portal.submitted, [
    { module: 'absence', idEnfant: '101', date: '04/11/2026', idActivite: 'CAN' },
  ]);
  assert.equal(gladys.fake.sceneEvents.length, before);
});

test('the read after a request keeps the other news', async (t) => {
  const { gladys, app, portal } = await start();
  t.after(() => app.stop());

  // Meanwhile, the municipality issued an invoice.
  portal.invoices.push({ numFacture: 'F12', libelle: 'Décembre', montant: 20 });
  const ack = await gladys.fake.sceneAction(SCENE_ACTIONS.DECLARE_ABSENCE, {
    child: childIds(gladys, config, '101').device,
    day: 0,
    activity: 'cantine',
  });
  assert.equal(ack.success, true, ack.error);
  const keys = gladys.fake.sceneEvents.map((event) => event.key ?? event.trigger);
  assert.deepEqual(keys, [SCENE_TRIGGERS.INVOICE_ISSUED]);
  // The device shows the absence request: no canteen today any more.
  assert.equal(
    gladys.fake.lastState(childIds(gladys, config, '101').feature(CHILD_FEATURES.MEAL_TODAY)),
    0,
  );
});

test('a scene books a lunch on a registered day, and says when it already is', async (t) => {
  const { gladys, app, portal } = await start();
  t.after(() => app.stop());

  const lea = childIds(gladys, config, '101').device;
  const tom = childIds(gladys, config, '102').device;
  const booked = await gladys.fake.sceneAction(SCENE_ACTIONS.REQUEST_RESERVATION, {
    child: lea,
    day: 1,
  });
  assert.equal(booked.success, true, booked.error);
  assert.deepEqual(portal.submitted, [
    { module: 'reserve', idEnfant: '101', date: '05/11/2026', idActivite: 'CAN' },
  ]);

  const already = await gladys.fake.sceneAction(SCENE_ACTIONS.REQUEST_RESERVATION, {
    child: tom,
    day: 1,
  });
  assert.equal(already.success, true);
  const outputs = already.data.outputs ?? already.data;
  assert.equal(outputs.requested, false);
  assert.equal(outputs.already_booked, true);
  assert.equal(portal.submitted.length, 1);
});

test('a scene checks a day', async (t) => {
  const { gladys, app } = await start();
  t.after(() => app.stop());
  const ack = await gladys.fake.sceneAction(SCENE_ACTIONS.CHECK_DAY, {
    child: childIds(gladys, config, '101').device,
    day: 0,
  });
  assert.deepEqual(ack.data.outputs ?? ack.data, {
    date: '2026-11-04',
    has_meal: true,
    booked_count: 2,
    activities: 'Cantine, Garderie soir',
  });
});

test('the widget renders exactly as sent, in every language', async (t) => {
  const { gladys, app } = await start();
  t.after(() => app.stop());
  for (const language of ['en', 'fr', 'de', 'es']) {
    const ack = await gladys.fake.widgetGet(FAMILY_WIDGET, { settings: {}, language });
    assert.equal(ack.success, true, ack.error);
    const content = ack.data.content ?? ack.data;
    assert.deepEqual(validateWidgetContent(content), [], language);
  }
});

test('the widget absence form cancels the booked day', async (t) => {
  const { gladys, app, portal } = await start();
  t.after(() => app.stop());
  const ack = await gladys.fake.widgetAction(
    FAMILY_WIDGET,
    WIDGET_ACTIONS.ABSENCE,
    {},
    { settings: {}, values: { child: '101', day: '0' } },
  );
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(portal.submitted.map((entry) => entry.idActivite).sort(), ['CAN', 'GS']);
});

test('wrong credentials are said on the Configuration screen', async (t) => {
  const portal = family();
  portal.password = 'changed';
  const { gladys, app } = await start(portal);
  t.after(() => app.stop());

  assert.equal(gladys.fake.connectionStatus.connected, false);
  const ack = await gladys.fake.action('test_connection', {});
  assert.match(ack.data.fr ?? ack.data.message?.fr ?? JSON.stringify(ack.data), /refusé/);
  // The account device is still there: the user can create it before fixing.
  assert.equal(gladys.fake.discoveredDevices.length, 1);
});

test('test the connection summarizes the family', async (t) => {
  const { gladys, app } = await start();
  t.after(() => app.stop());
  const ack = await gladys.fake.action('test_connection', {});
  const message = ack.data.message ?? ack.data;
  assert.match(message.fr, /Enfants : Léa, Tom/);
  assert.match(message.en, /1 invoice\(s\) to pay/);
});

test('a municipality without the invoice module still works', async (t) => {
  const portal = family();
  portal.missing.add('invoices');
  const { gladys, app } = await start(portal);
  t.after(() => app.stop());
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(
    gladys.fake.lastState(accountIds(gladys, config).feature(ACCOUNT_FEATURES.BALANCE)),
    0,
  );
});

test('a restart compares with the read kept in /data', async (t) => {
  const store = createMemoryStore();
  const first = await start(family(), store);
  first.app.stop();

  const portal = family();
  portal.messages.push({ idMessage: 9, objet: 'Nouveau', expediteur: 'Mairie' });
  const second = await start(portal, store);
  t.after(() => second.app.stop());
  const keys = second.gladys.fake.sceneEvents.map((event) => event.key ?? event.trigger);
  assert.deepEqual(keys, [SCENE_TRIGGERS.MESSAGE_RECEIVED]);
});

test('the password never reaches the logs', async (t) => {
  const lines = [];
  const original = { log: console.log, error: console.error };
  console.log = (...args) => lines.push(args.join(' '));
  console.error = (...args) => lines.push(args.join(' '));
  try {
    // "Detailed logs" ticked: every request is logged.
    const { app } = await start(family(), createMemoryStore(), { debug_logs: true });
    t.after(() => app.stop());
  } finally {
    console.log = original.log;
    console.error = original.error;
  }
  assert.ok(lines.some((line) => line.includes(ENDPOINTS.login.path)));
  assert.ok(!lines.some((line) => line.includes(CONFIG.password)));
  // The session id (s1) is never printed, only the names of the fields.
  assert.ok(lines.some((line) => /Signed in .*SESSION_ID/.test(line)));
  assert.ok(!lines.some((line) => /\bs1\b/.test(line)));
});

test('with only the requests captured so far, the integration works', async (t) => {
  restorePaths();
  t.after(() => {
    restorePaths = useTestPaths();
  });
  const { gladys, app } = await start();
  t.after(() => app.stop());
  assert.equal(gladys.fake.connectionStatus.connected, true);
  const ack = await gladys.fake.action('test_connection', {});
  const message = ack.data.message ?? ack.data;
  assert.match(message.fr, /Enfants : Enfant 101, Enfant 102/);
  assert.match(message.fr, /1 facture\(s\) à payer/);
  assert.match(message.fr, /1 message\(s\) non lu\(s\)/);
});

test('without the children request, the children come from the planning', async (t) => {
  const path = ENDPOINTS.children.path;
  ENDPOINTS.children.path = null;
  t.after(() => {
    ENDPOINTS.children.path = path;
  });
  const { gladys, app } = await start();
  t.after(() => app.stop());
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => device.name),
    ['Agora Famille', 'Enfant 101', 'Enfant 102'],
  );
  assert.equal(gladys.fake.connectionStatus.connected, true);
});
