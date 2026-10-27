import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { AgoraClient, ERROR_CODES, encodePassword, frenchDate } from '../src/agora/client.js';
import { ENDPOINTS } from '../src/agora/endpoints.js';
import { BASE, createFakePortal, useTestPaths } from './helpers/fakePortal.js';

let restorePaths;
before(() => {
  restorePaths = useTestPaths();
});
after(() => restorePaths());

function clientFor(portal, overrides = {}) {
  return new AgoraClient({
    apiBase: BASE,
    origin: 'https://portalssl.agoraplus.fr',
    username: portal.username,
    password: portal.password,
    fetch: portal.fetch,
    ...overrides,
  });
}

test('signs in once, the way the portal pages do, then sends the session id', async () => {
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
  const [login] = portal.requests;
  assert.equal(login.method, 'POST');
  assert.equal(login.path, 'InternalApi/API_DASHBOARD/authentication');
  assert.deepEqual(JSON.parse(login.body), {
    LOGIN: portal.username,
    // `btoa('s3cret')`, as the portal pages send it.
    PASSWORD: 'czNjcmV0',
  });
  assert.equal(login.headers['content-type'], 'application/json');
  assert.equal(login.headers.session_id, 'null');
  assert.equal(login.headers.ref_year, 'null');
  assert.equal(login.headers.a_access, 'agora');
  assert.equal(login.headers.origin, 'https://portalssl.agoraplus.fr');
  assert.equal(portal.requests.at(-1).headers.session_id, 's1');
  assert.equal(portal.requests.at(-1).headers.ref_year, '2026');
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

test('a refused login says why in the logs, secrets masked', async (t) => {
  const portal = createFakePortal();
  const client = clientFor(portal, { password: 'wrong' });
  const lines = [];
  t.mock.method(console, 'error', (...args) => lines.push(args.join(' ')));
  const level = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';
  t.after(() => {
    if (level === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = level;
    }
  });
  await assert.rejects(client.getChildren(), { code: ERROR_CODES.AUTH });
  const line = lines.find((entry) => entry.includes('Login refused'));
  assert.match(
    line,
    /TYPE_RESULT=-2, ERROR\.ID=12, ERROR\.MESSAGE="Identifiant ou mot de passe incorrect"|ERROR\.ID=12, ERROR\.MESSAGE="Identifiant ou mot de passe incorrect", TYPE_RESULT=-2/,
  );
  assert.match(line, /login: 18 characters, password: 5 characters/);
  assert.ok(!line.includes('wrong'));
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

test('the planning is asked the way the portal pages ask it', async () => {
  const portal = createFakePortal();
  await clientFor(portal).getPlanning('2026-11-04', '2026-11-18');
  const request = portal.requests.find((r) => r.path === ENDPOINTS.planning.path);
  assert.equal(request.path, 'InternalApi/API_CALENDAR_COMPONENT/events/');
  // The children come from the login answer here: no children list given.
  assert.deepEqual(request.query, {
    idContext: '1',
    targets: '101$0,102$0',
    startDate: '04/11/2026',
    endDate: '18/11/2026',
  });
  assert.match(request.url, /targets=101\$0,102\$0&startDate=04\/11\/2026&/);
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

test('a refused login logs what the portal answered, secrets masked', async (t) => {
  const portal = createFakePortal();
  const client = clientFor(portal);
  client.fetch = async () =>
    new Response(
      `<html><body><h1>Bad Request</h1><p>p_login=${portal.username} p_password=${portal.password}</p></body></html>`,
      { status: 400, headers: { 'content-type': 'text/html' } },
    );
  const lines = [];
  t.mock.method(console, 'error', (...args) => lines.push(args.join(' ')));
  // Whatever level the test run was started with, warnings are shown.
  const level = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';
  t.after(() => {
    if (level === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = level;
    }
  });

  await assert.rejects(client.getChildren(), { code: ERROR_CODES.HTTP, status: 400 });

  const line = lines.find((entry) => entry.includes('HTTP 400'));
  assert.ok(line, 'the answer is logged');
  assert.match(line, new RegExp(`POST ${BASE}/${ENDPOINTS.login.path}`));
  assert.match(line, /Bad Request p_login=\*\*\* p_password=\*\*\*/);
  assert.ok(!line.includes(portal.password) && !line.includes(portal.username));
});

test('a request not captured yet is said as such, after a successful sign-in', async (t) => {
  const portal = createFakePortal();
  const client = clientFor(portal);
  const path = ENDPOINTS.children.path;
  ENDPOINTS.children.path = null;
  t.after(() => {
    ENDPOINTS.children.path = path;
  });
  await assert.rejects(client.getChildren(), { code: ERROR_CODES.UNMAPPED, step: 'children' });
  assert.equal(client.signedIn, true);
  assert.equal(portal.requests.length, 1);
});

test('a login answer without a session names its fields, not their values', async () => {
  const portal = createFakePortal();
  const client = clientFor(portal);
  client.fetch = async () =>
    new Response(JSON.stringify({ RESULT: { NOM: 'Martin', CODE: 'secret-value' } }), {
      headers: { 'content-type': 'application/json' },
    });
  await assert.rejects(client.getChildren(), (err) => {
    assert.equal(err.code, ERROR_CODES.FORMAT);
    assert.match(err.message, /fields: RESULT\.NOM, RESULT\.CODE/);
    assert.ok(!err.message.includes('secret-value') && !err.message.includes('Martin'));
    return true;
  });
});

test('the invoices are asked the way the portal pages ask them', async () => {
  const portal = createFakePortal();
  await clientFor(portal).getInvoices();
  const request = portal.requests.at(-1);
  assert.equal(request.url, `${BASE}/InternalApi/API_DASHBOARD/invoicesAgpGrid?state=all`);
  assert.equal(request.headers.session_id, 's1');
});

test('the messages are asked the way the portal pages ask them', async () => {
  const portal = createFakePortal();
  await clientFor(portal).getMessages();
  assert.equal(portal.requests.at(-1).url, `${BASE}/InternalApi/API_DASHBOARD/emailLogs/0/1`);
});

test('the requests carry a French language and name the integration', async () => {
  const portal = createFakePortal();
  await clientFor(portal).getInvoices();
  for (const request of portal.requests) {
    assert.equal(request.headers['accept-language'], 'fr-FR,fr;q=0.9');
    assert.match(request.headers['user-agent'], /^gladys-agorafamille /);
  }
});

test('an exception of the portal is not called a wrong password', async () => {
  const portal = createFakePortal();
  const client = clientFor(portal);
  client.fetch = async () =>
    new Response(
      JSON.stringify({
        DATA: null,
        ERROR: { ID: '1', MESSAGE: 'Exception detected' },
        TYPE_RESULT: -2,
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  await assert.rejects(client.getChildren(), {
    code: ERROR_CODES.FORMAT,
    step: 'login',
    portalMessage: 'Exception detected',
  });
});

test("the password is encoded like the browser's btoa, accents included", () => {
  assert.equal(encodePassword('s3cret', 'base64'), 'czNjcmV0');
  // btoa('Été2026!') in a browser.
  assert.equal(encodePassword('Été2026!', 'base64'), 'yXTpMjAyNiE=');
  assert.equal(encodePassword('s3cret', undefined), 's3cret');
});
