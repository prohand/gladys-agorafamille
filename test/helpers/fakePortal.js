// -----------------------------------------------------------------------------
// A fake Agora Famille portal: a `fetch` that answers the requests of
// src/agora/endpoints.js from in-memory data, with a session cookie, the way
// the real portal does (a login page in place of data once the session is
// gone). No network in the tests.
// -----------------------------------------------------------------------------

import { ENDPOINTS } from '../../src/agora/endpoints.js';

export const BASE = 'https://portalssl.agoraplus.fr/testville';

/**
 * @param {object} [data] the family as the portal would serve it
 */
export function createFakePortal(data = {}) {
  const portal = {
    username: 'parent@example.com',
    password: 's3cret',
    children: [
      { idEnfant: 101, prenom: 'Léa', nom: 'Martin' },
      { idEnfant: 102, prenom: 'Tom', nom: 'Martin' },
    ],
    planning: [],
    invoices: [],
    messages: [],
    /** Modules the municipality did not buy answer 404. */
    missing: new Set(),
    /** Set to make the next requests fail at the network level. */
    down: false,
    /** Every request received: `{ path, method, query, body, cookie }`. */
    requests: [],
    /** Requests to book / cancel, as received. */
    submitted: [],
    sessions: new Set(),
    ...data,
  };

  let sessionCounter = 0;

  /** Drop every session: the next request gets the login page. */
  portal.expireSessions = () => portal.sessions.clear();

  portal.fetch = async (url, options = {}) => {
    if (portal.down) {
      const error = new TypeError('fetch failed');
      error.cause = { code: 'ECONNREFUSED' };
      throw error;
    }
    const target = new URL(url);
    const path = target.pathname.replace(/^\/testville\//, '');
    const cookie = options.headers?.cookie ?? '';
    const session = /AGORA_SESSION=([^;]+)/.exec(cookie)?.[1];
    const request = {
      path,
      method: options.method,
      query: Object.fromEntries(target.searchParams),
      body: options.body,
      cookie,
    };
    portal.requests.push(request);

    if (path === ENDPOINTS.login.path) {
      const form = new URLSearchParams(options.body);
      if (
        form.get(ENDPOINTS.login.fields.username) !== portal.username ||
        form.get(ENDPOINTS.login.fields.password) !== portal.password
      ) {
        return json({ success: false, message: 'Identifiants incorrects' });
      }
      sessionCounter += 1;
      const id = `s${sessionCounter}`;
      portal.sessions.add(id);
      return new Response(null, {
        status: 302,
        headers: { location: 'pck_home.home_view', 'set-cookie': `AGORA_SESSION=${id}; Path=/` },
      });
    }

    if (!session || !portal.sessions.has(session)) {
      return new Response('<html><body>Connexion</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    const module = Object.entries(ENDPOINTS).find(([, endpoint]) => endpoint.path === path)?.[0];
    if (!module || portal.missing.has(module)) {
      return new Response('Not found', { status: 404 });
    }
    switch (module) {
      case 'children':
        return json({ enfants: portal.children });
      case 'planning':
        return json({ data: { planning: portal.planning } });
      case 'invoices':
        return json({ factures: portal.invoices });
      case 'messages':
        return json(portal.messages);
      case 'reserve':
      case 'absence': {
        const body = JSON.parse(options.body);
        portal.submitted.push({ module, ...body });
        // The portal shows the request at once, as pending.
        for (const entry of portal.planning) {
          if (
            String(entry.idEnfant) === body.idEnfant &&
            entry.date === body.date &&
            entry.idActivite === body.idActivite
          ) {
            entry.etat = module === 'absence' ? "Demande d'absence" : 'Demande de réservation';
          }
        }
        return json({ success: true });
      }
      default:
        return new Response('Not found', { status: 404 });
    }
  };

  return portal;
}

function json(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** An in-memory store, standing in for /data. */
export function createMemoryStore(initial = null) {
  let state = initial;
  return {
    get state() {
      return state;
    },
    async load(accountId) {
      if (!state || state.accountId !== accountId) {
        return { snapshot: null, reminded: [] };
      }
      return { snapshot: state.snapshot, reminded: state.reminded };
    },
    async save(accountId, { snapshot, reminded }) {
      state = structuredClone({ accountId, snapshot, reminded });
    },
  };
}

/** The configuration of the fake account. */
export const CONFIG = {
  portal_url: BASE,
  username: 'parent@example.com',
  password: 's3cret',
};
