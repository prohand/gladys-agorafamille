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
import {
  CONFIG,
  apiDay,
  createFakePortal,
  createMemoryStore,
  useTestPaths,
} from './helpers/fakePortal.js';

let restorePaths;
before(() => {
  restorePaths = useTestPaths();
});
after(() => restorePaths());

// Wednesday 4 November 2026, 10:00 in Paris.
const NOW = new Date('2026-11-04T09:00:00Z');

function family() {
  // In the API's own shape. Tom's lunch tomorrow is booked; Léa is
  // registered for it but has not booked it.
  return createFakePortal({
    planning: [
      apiDay({ child: 101, date: '04/11/2026', eventId: 1, selected: 1 }),
      apiDay({ child: 101, date: '04/11/2026', eventId: 2, group: 'Garderie soir', selected: 1 }),
      apiDay({ child: 101, date: '05/11/2026', eventId: 1 }),
      apiDay({ child: 102, date: '05/11/2026', eventId: 1, selected: 1 }),
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
  assert.equal(
    gladys.fake.lastState(lea.feature(CHILD_FEATURES.TODAY)),
    'Garderie soir, Restauration scolaire',
  );
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
  // The municipality cancelled Tom's lunch of tomorrow.
  portal.planning[3].IS_SELECTED = 0;

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
  assert.equal(changed.data.status, 'registered');
  assert.equal(changed.data.previous_status, 'reserved');
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
    activities: 'Garderie soir, Restauration scolaire',
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

test('wrong credentials are said on the Configuration screen', async (t) => {
  const portal = family();
  portal.password = 'changed';
  const { gladys, app } = await start(portal);
  t.after(() => app.stop());

  assert.equal(gladys.fake.connectionStatus.connected, false);
  const ack = await gladys.fake.action('test_connection', {});
  const answer = ack.data.message ?? ack.data;
  assert.match(answer.fr, /refusé/);
  // The portal's own words reach the Configuration screen.
  assert.match(answer.fr, /« Identifiant ou mot de passe incorrect »/);
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
  assert.ok(lines.some((line) => /Signed in .*session_id/.test(line)));
  assert.ok(!lines.some((line) => /\bs1\b/.test(line)));
});

test('without the children request, the integration still works', async (t) => {
  // (the menu of the fake answer names them)
  const path = ENDPOINTS.children.path;
  ENDPOINTS.children.path = null;
  t.after(() => {
    ENDPOINTS.children.path = path;
  });
  const { gladys, app } = await start();
  t.after(() => app.stop());
  assert.equal(gladys.fake.connectionStatus.connected, true);
  const ack = await gladys.fake.action('test_connection', {});
  const message = ack.data.message ?? ack.data;
  assert.match(message.fr, /Enfants : Léa, Tom/);
  assert.match(message.fr, /1 facture\(s\) à payer/);
  assert.match(message.fr, /1 message\(s\) non lu\(s\)/);
});

test('without the encryption request, the Configuration screen names it', async (t) => {
  const path = ENDPOINTS.encryptPassword.path;
  ENDPOINTS.encryptPassword.path = null;
  t.after(() => {
    ENDPOINTS.encryptPassword.path = path;
  });
  const { gladys, app } = await start();
  t.after(() => app.stop());
  assert.equal(gladys.fake.connectionStatus.connected, false);
  const ack = await gladys.fake.action('test_connection', {});
  const message = ack.data.message ?? ack.data;
  assert.match(message.fr, /chiffrement du mot de passe/);
});

test('without the children request, the children come from the sign-in menu', async (t) => {
  const path = ENDPOINTS.children.path;
  ENDPOINTS.children.path = null;
  t.after(() => {
    ENDPOINTS.children.path = path;
  });
  const { gladys, app } = await start();
  t.after(() => app.stop());
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => device.name),
    ['Agora Famille', 'Léa', 'Tom'],
  );
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('without menu nor children request, the children come from the planning', async (t) => {
  const path = ENDPOINTS.children.path;
  ENDPOINTS.children.path = null;
  t.after(() => {
    ENDPOINTS.children.path = path;
  });
  const portal = family();
  portal.noMenu = true;
  const { gladys, app } = await start(portal);
  t.after(() => app.stop());
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => device.name),
    ['Agora Famille', 'Enfant 101', 'Enfant 102'],
  );
});

test('the widget is read-only, with the last three unread messages', async (t) => {
  const portal = family();
  portal.messages = Array.from({ length: 6 }, (_, index) => ({
    idMessage: index + 1,
    objet: `Message ${index + 1}`,
    expediteur: 'Mairie',
    dateEnvoi: `0${index + 1}/10/2026`,
  }));
  const { gladys, app } = await start(portal);
  t.after(() => app.stop());
  const ack = await gladys.fake.widgetGet(FAMILY_WIDGET, { settings: {}, language: 'fr' });
  const content = ack.data.content ?? ack.data;
  const buttons = content.components.filter((component) => component.type === 'button');
  assert.deepEqual(
    buttons.map((button) => button.action?.key ?? 'link'),
    [WIDGET_ACTIONS.REFRESH, 'link'],
  );
  // The balance with its cents, the reader's way.
  assert.equal(content.components.find((component) => component.type === 'value').value, '45,20');
  const cards = content.components.find((component) => component.type === 'card-list').items;
  // The invoice to pay first, then only the three newest unread messages.
  assert.equal(cards[0].badge.text, 'À payer');
  assert.deepEqual(
    cards.filter((card) => card.badge.text === 'Message').map((card) => card.title),
    ['Message 6', 'Message 5', 'Message 4'],
  );
});

test('an invoice sent to the Trésor public is shown apart and not owed', async (t) => {
  const portal = family();
  portal.invoices.push({
    numFacture: '164513',
    libelle: 'Décembre 2025',
    montant: '64,80',
    dateEcheance: '15/01/2026',
  });
  const { gladys, app } = await start(portal, createMemoryStore(), {
    treasury_invoices: '#164513',
  });
  t.after(() => app.stop());

  const account = accountIds(gladys, config);
  assert.equal(gladys.fake.lastState(account.feature(ACCOUNT_FEATURES.BALANCE)), 45.2);

  const ack = await gladys.fake.widgetGet(FAMILY_WIDGET, { settings: {}, language: 'fr' });
  const content = ack.data.content ?? ack.data;
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components.find((component) => component.type === 'value').value, '45,20');
  const cards = content.components.find((component) => component.type === 'card-list').items;
  assert.deepEqual(
    cards.slice(0, 2).map((card) => [card.title, card.badge.text, card.badge.color]),
    [
      ['Octobre 2026', 'À payer', 'warning'],
      ['Décembre 2025', 'Trésor public', 'neutral'],
    ],
  );
  assert.match(cards[1].description, /rien d'autre à faire/);

  const answer = await gladys.fake.action('test_connection', {});
  const message = answer.data.message ?? answer.data;
  assert.match(message.fr, /1 facture\(s\) à payer/);
  assert.match(message.fr, /1 facture\(s\) transmise\(s\) au Trésor public/);
});

test('a family paying by direct debit sees "Direct debit", not "To pay"', async (t) => {
  const { gladys, app } = await start(family(), createMemoryStore(), { direct_debit: true });
  t.after(() => app.stop());

  const account = accountIds(gladys, config);
  // Still owed until the bank pays it.
  assert.equal(gladys.fake.lastState(account.feature(ACCOUNT_FEATURES.BALANCE)), 45.2);
  assert.equal(
    gladys.fake.lastState(account.feature(ACCOUNT_FEATURES.NEXT_INVOICE)),
    '45,20 € en prélèvement, échéance le 20/11/2026 — Octobre 2026',
  );

  const ack = await gladys.fake.widgetGet(FAMILY_WIDGET, { settings: {}, language: 'fr' });
  const content = ack.data.content ?? ack.data;
  assert.deepEqual(validateWidgetContent(content), []);
  const focal = content.components.find((component) => component.type === 'value');
  assert.deepEqual([focal.label, focal.value], ['À prélever', '45,20']);
  const cards = content.components.find((component) => component.type === 'card-list').items;
  // The day of the debit is not known: the portal's date is said to be the
  // due date, never the day of the debit.
  assert.deepEqual(
    [cards[0].title, cards[0].date, cards[0].badge.text, cards[0].badge.color],
    ['Octobre 2026', undefined, 'Prélèvement', 'info'],
  );
  assert.match(cards[0].subtitle, /^45,20\s€ · échéance 20\/11\/2026$/);
  assert.match(cards[0].description, /jour du prélèvement dans la configuration/);

  const answer = await gladys.fake.action('test_connection', {});
  const message = answer.data.message ?? answer.data;
  assert.match(message.fr, /0 facture\(s\) à payer/);
  assert.match(message.fr, /1 facture\(s\) en prélèvement automatique, rien à faire/);
});

test('the day of the debit typed in the configuration is the one shown', async (t) => {
  const { gladys, app } = await start(family(), createMemoryStore(), {
    direct_debit: true,
    direct_debit_day: 10,
  });
  t.after(() => app.stop());

  const account = accountIds(gladys, config);
  // Due on 20/11: taken on the 10th of that month.
  assert.equal(
    gladys.fake.lastState(account.feature(ACCOUNT_FEATURES.NEXT_INVOICE)),
    '45,20 € prélevés le 10/11/2026 — Octobre 2026',
  );
  const ack = await gladys.fake.widgetGet(FAMILY_WIDGET, { settings: {}, language: 'fr' });
  const content = ack.data.content ?? ack.data;
  assert.deepEqual(validateWidgetContent(content), []);
  const [card] = content.components.find((component) => component.type === 'card-list').items;
  assert.equal(card.badge.text, 'Prélevé le 10/11');
  assert.match(card.subtitle, /^45,20\s€$/);
  assert.match(card.description, /prélevés le 10\/11\/2026/);
});
