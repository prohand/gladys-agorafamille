import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ERROR_CODES, AgoraError } from '../src/agora/client.js';
import { buildSnapshot } from '../src/agora/snapshot.js';
import { createStore } from '../src/agora/store.js';
import { buildWidgetContent } from '../src/capabilities/widget.js';
import { normalizeConfig } from '../src/config.js';
import { CONFIG } from './helpers/fakePortal.js';

const gladys = createFakeGladys();

test('the widget asks for the configuration before anything else', () => {
  const content = buildWidgetContent({
    gladys,
    config: normalizeConfig({}),
    snapshot: null,
    error: null,
    language: 'fr',
  });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.match(content.components[0].text, /Renseignez/);
});

test('the widget says the portal is down, and still renders', () => {
  for (const language of ['en', 'fr', 'de', 'es']) {
    const content = buildWidgetContent({
      gladys,
      config: normalizeConfig(CONFIG),
      snapshot: null,
      error: new AgoraError(ERROR_CODES.NETWORK, 'down', { step: 'login' }),
      language,
    });
    assert.deepEqual(validateWidgetContent(content), [], language);
  }
});

test('many children, invoices and messages stay within the budget', () => {
  const children = Array.from({ length: 8 }, (_, index) => ({
    id: String(index),
    firstName: `Enfant ${index}`,
    name: `Enfant avec un prénom vraiment très long ${index}`,
  }));
  const snapshot = buildSnapshot({
    today: '2026-11-04',
    children,
    planning: children.map((child) => ({
      childId: child.id,
      day: '2026-11-04',
      activity: 'Restauration scolaire du midi avec un libellé interminable',
      activityId: 'R',
      status: 'reserved',
    })),
    invoices: Array.from({ length: 12 }, (_, index) => ({
      id: `F${index}`,
      label: `Facture ${index}`,
      amount: 10,
      remaining: 10,
      dueOn: '2026-11-01',
      paid: false,
    })),
    messages: [{ id: 'M', subject: 'x'.repeat(300), read: false }],
  });
  const content = buildWidgetContent({
    gladys,
    config: normalizeConfig(CONFIG),
    snapshot,
    error: null,
    language: 'de',
  });
  assert.deepEqual(validateWidgetContent(content), []);
});

test('the state kept in /data belongs to one account', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'agora-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createStore(directory);
  const snapshot = buildSnapshot({ today: '2026-11-04' });

  await store.save('town-abc', { snapshot, reminded: ['F1'] });

  assert.deepEqual(await store.load('town-abc'), { snapshot, reminded: ['F1'] });
  assert.deepEqual(await store.load('town-other'), { snapshot: null, reminded: [] });
  // Never the password: only what the portal answered.
  const text = await readFile(store.file, 'utf8');
  assert.ok(!text.includes(CONFIG.password));
});

test('a missing or broken state file is a fresh start', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'agora-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.deepEqual(await createStore(directory).load('x'), { snapshot: null, reminded: [] });
});
