import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgoraClient, ERROR_CODES, frenchDate } from '../src/agora/client.js';
import { ENDPOINTS } from '../src/agora/endpoints.js';
import { BASE, createFakePortal } from './helpers/fakePortal.js';

function clientFor(portal, overrides = {}) {
  return new AgoraClient({
    base: BASE,
    username: portal.username,
    password: portal.password,
    fetch: portal.fetch,
    ...overrides,
  });
}

test('signs in once, then sends the session cookie', async () => {
  const portal = createFakePortal();
  const client = clientFor(portal);

  const children = await client.getChildren();
  await client.getInvoices();

  assert.deepEqual(
    children.map((child) => child.name),
    ['Léa', 'Tom'],
  );
  const logins = portal.requests.filter((request) => request.path === ENDPOINTS.login.path);
  assert.equal(logins.length, 1);
  assert.match(portal.requests.at(-1).cookie, /AGORA_SESSION=s1/);
});

test('an expired session is renewed once, transparently', async () => {
  const portal = createFakePortal();
  const client = clientFor(portal);
  await client.getChildren();

  portal.expireSessions();
  const children = await client.getChildren();

  assert.equal(children.length, 2);
  assert.equal(portal.requests.filter((r) => r.path === ENDPOINTS.login.path).length, 2);
});

test('wrong credentials are an auth error, without retrying forever', async () => {
  const portal = createFakePortal();
  const client = clientFor(portal, { password: 'wrong' });

  await assert.rejects(client.getChildren(), (err) => {
    assert.equal(err.code, ERROR_CODES.AUTH);
    assert.equal(err.step, 'login');
    // The password is in no error message.
    assert.ok(!err.message.includes('wrong'));
    return true;
  });
  assert.equal(portal.requests.length, 1);
});

test('a portal that does not answer is a network error', async () => {
  const portal = createFakePortal({ down: true });
  await assert.rejects(clientFor(portal).getChildren(), { code: ERROR_CODES.NETWORK });
});

test('a missing module is an HTTP error with its status', async () => {
  const portal = createFakePortal({ missing: new Set(['invoices']) });
  await assert.rejects(clientFor(portal).getInvoices(), {
    code: ERROR_CODES.HTTP,
    status: 404,
    step: 'invoices',
  });
});

test('nothing is asked of the portal without credentials', async () => {
  const portal = createFakePortal();
  await assert.rejects(clientFor(portal, { password: '' }).getChildren(), {
    code: ERROR_CODES.CONFIG,
  });
  assert.equal(portal.requests.length, 0);
});

test('the planning window is sent the way the portal writes days', async () => {
  const portal = createFakePortal();
  await clientFor(portal).getPlanning('2026-11-04', '2026-11-18');
  const request = portal.requests.find((r) => r.path === ENDPOINTS.planning.path);
  assert.deepEqual(request.query, { p_date_debut: '04/11/2026', p_date_fin: '18/11/2026' });
  assert.equal(frenchDate('2026-01-09'), '09/01/2026');
});

test('a request the portal declines is reported as refused', async () => {
  const portal = createFakePortal();
  const client = clientFor(portal);
  const original = portal.fetch;
  client.fetch = async (url, options) => {
    if (String(url).endsWith(ENDPOINTS.absence.path)) {
      return new Response(JSON.stringify({ success: false, message: 'Délai dépassé' }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return original(url, options);
  };
  await assert.rejects(
    client.requestAbsence({ childId: '101', day: '2026-11-05', activityId: 'C' }),
    { code: ERROR_CODES.REFUSED, message: 'Délai dépassé' },
  );
});
