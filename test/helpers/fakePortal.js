// -----------------------------------------------------------------------------
// A fake Agora Famille API: a `fetch` that answers the requests of
// src/agora/endpoints.js from in-memory data. The login is the one captured
// from the real portal (JSON LOGIN/PASSWORD, a session id sent back in the
// `session_id` header); an unknown or expired session answers 401. No
// network in the tests.
// -----------------------------------------------------------------------------

import { ENDPOINTS } from '../../src/agora/endpoints.js';

/** The API of the fake municipality, `testville`. */
export const BASE = 'https://testville.agoraplus.fr';

// The data requests of the real portal are not captured yet (`path: null`):
// until they are, the tests give them addresses of their own, so the code
// that reads the answers is exercised all the same.
export const TEST_PATHS = {};
for (const [name, endpoint] of Object.entries(ENDPOINTS)) {
  if (!endpoint.path) {
    TEST_PATHS[name] = `InternalApi/TEST/${name}`;
  }
}

/** Give the unknown requests their test addresses; returns the undo. */
export function useTestPaths() {
  for (const [name, path] of Object.entries(TEST_PATHS)) {
    ENDPOINTS[name].path = path;
  }
  return () => {
    for (const name of Object.keys(TEST_PATHS)) {
      ENDPOINTS[name].path = null;
    }
  };
}

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
    /** Every request received: `{ path, method, query, body, headers }`. */
    requests: [],
    /** Requests to book / cancel, as received. */
    submitted: [],
    sessions: new Set(),
    ...data,
  };

  let sessionCounter = 0;

  /** Drop every session: the next request answers 401. */
  portal.expireSessions = () => portal.sessions.clear();

  portal.fetch = async (url, options = {}) => {
    if (portal.down) {
      const error = new TypeError('fetch failed');
      error.cause = { code: 'ECONNREFUSED' };
      throw error;
    }
    const target = new URL(url);
    if (target.origin !== BASE) {
      return new Response('Bad Request', { status: 400 });
    }
    const path = target.pathname.replace(/^\//, '');
    const headers = options.headers ?? {};
    const request = {
      url: String(url),
      path,
      method: options.method,
      query: Object.fromEntries(target.searchParams),
      body: options.body,
      headers,
    };
    portal.requests.push(request);

    // Step 1 of the sign-in: the password, Base64-encoded (`btoa`), comes
    // back encrypted. The fake "encryption" is reversible on purpose.
    if (path === ENDPOINTS.encryptPassword.path) {
      const body = JSON.parse(options.body);
      const typed = Buffer.from(body[ENDPOINTS.encryptPassword.field], 'base64').toString('latin1');
      return json({ DATA: `enc(${typed})`, ERROR: null, TYPE_RESULT: 1 });
    }

    if (path === ENDPOINTS.login.path) {
      const body = JSON.parse(options.body);
      if (
        body[ENDPOINTS.login.fields.username] !== portal.username ||
        body[ENDPOINTS.login.fields.password] !== `enc(${portal.password})`
      ) {
        // As the real API refuses (October 2026).
        return json({
          DATA: null,
          ERROR: { ID: 12, MESSAGE: 'Identifiant ou mot de passe incorrect' },
          TYPE_RESULT: -2,
        });
      }
      sessionCounter += 1;
      const id = `s${sessionCounter}`;
      portal.sessions.add(id);
      // Where the real answer lists the children is not known yet: the
      // client looks for `<id>$<n>` values anywhere in it.
      // `DATA.session.USER_INFO.USER_TYPE_ID` is what the portal pages read;
      // the other names are not known yet.
      return json({
        DATA: {
          // As in the portal's code: `session.session_id`, `session.school_year`.
          session: {
            session_id: id,
            school_year: 2026,
            USER_INFO: { USER_TYPE_ID: portal.userType ?? 2, NAME: 'Martin' },
            TARGETS: portal.children.map((child) => `${child.idEnfant}$0`),
          },
          CGU_ACCEPTED: 1,
          // The menu the portal pages build their side bar from: a child's
          // page is the `kids/<id>` route.
          MENUS: portal.noMenu
            ? []
            : [
                {
                  GROUP_LABEL: 'Ma famille',
                  MENU_ITEMS: [
                    {
                      NAME: 'Mes enfants',
                      TYPE: 'group',
                      HREF: '',
                      PAGES: portal.children.map((child) => ({
                        NAME: child.prenom,
                        TYPE: 'link',
                        HREF: `client_home_view$#/kids/${child.idEnfant}`,
                      })),
                    },
                  ],
                },
              ],
        },
        ERROR: null,
        TYPE_RESULT: 1,
      });
    }

    // The API answers its errors with HTTP 200 and a negative TYPE_RESULT.
    if (portal.failReads > 0 && path !== ENDPOINTS.encryptPassword.path) {
      portal.failReads -= 1;
      return json({ DATA: null, ERROR: { ID: '7', MESSAGE: 'Session invalide' }, TYPE_RESULT: -1 });
    }

    if (!portal.sessions.has(headers.session_id)) {
      return new Response(JSON.stringify({ MESSAGE: 'Session expirée' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
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
  portal_url: 'https://portalssl.agoraplus.fr/testville/pck_home.home_view#/',
  username: 'parent@example.com',
  password: 's3cret',
};
