// -----------------------------------------------------------------------------
// The requests of the Agora Famille portal the integration makes.
//
// Agora Plus publishes no API for its family portal: these are the requests
// the portal's own pages make. The pages live on
// `https://portalssl.agoraplus.fr/<commune>/`, and fetch their data from the
// API of the municipality, `https://<commune>.agoraplus.fr/InternalApi/…`, in
// JSON, the session travelling in a `session_id` header. Paths below are
// relative to that API.
//
// They live here, and only here, so that adapting the integration to a portal
// update is a change to this file alone (src/agora/parse.js reads the answers
// tolerantly, whatever the field names).
//
// A request whose `path` is `null` is not known yet: it was not captured from
// a real session. The integration signs in, then says which one is missing
// instead of guessing an address. To capture one: open the portal in a
// browser, developer tools (F12), Network tab, "Fetch/XHR" filter, sign in
// and visit the page; right-click the request, "Copy as cURL".
// -----------------------------------------------------------------------------

/** Sent in the `a_access` header of every request, as the portal pages do. */
export const API_ACCESS = 'agora';

export const ENDPOINTS = {
  /**
   * Sign in. Captured from the portal (October 2026):
   * POST /InternalApi/API_DASHBOARD/authentication, JSON {"LOGIN", "PASSWORD"},
   * headers `session_id: null`, `ref_year: null`, `a_access: agora`.
   */
  login: {
    method: 'POST',
    path: 'InternalApi/API_DASHBOARD/authentication',
    fields: { username: 'LOGIN', password: 'PASSWORD' },
  },
  /** The children of the family. Not captured yet. */
  children: { method: 'GET', path: null },
  /** The planning of every child over a window of days. Not captured yet. */
  planning: { method: 'GET', path: null, query: { from: 'p_date_debut', to: 'p_date_fin' } },
  /** The invoices, paid and to pay. Not captured yet. */
  invoices: { method: 'GET', path: null },
  /** The messages and notifications of the municipality. Not captured yet. */
  messages: { method: 'GET', path: null },
  /** Ask to book one day of an activity. Not captured yet. */
  reserve: { method: 'POST', path: null },
  /** Ask to cancel one booked day of an activity. Not captured yet. */
  absence: { method: 'POST', path: null },
};

/** The portal pages a person opens, for the links of the widget and the docs. */
export const PAGES = {
  home: 'pck_home.home_view#/',
};
