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
  /**
   * The planning of the children over a window of days. Captured from the
   * portal (October 2026):
   * GET /InternalApi/API_CALENDAR_COMPONENT/events/?idContext=1
   *     &targets=1001$0,1002$0&startDate=26/10/2026&endDate=01/11/2026
   * `targets` are the children (`<person id>$0`), dates are dd/mm/yyyy.
   * Answers `{ DATA: { EVENTS: [...] } }` (see src/agora/parse.js).
   */
  planning: {
    method: 'GET',
    path: 'InternalApi/API_CALENDAR_COMPONENT/events/',
    query: { context: 'idContext', targets: 'targets', from: 'startDate', to: 'endDate' },
    context: '1',
  },
  /**
   * The invoices, paid and to pay. Captured from the portal (October 2026):
   * GET /InternalApi/API_DASHBOARD/invoicesAgpGrid?state=all
   * Answers `{ DATA: { count, data: [{ idInvoice, FACT_DESC, total,
   * TOTAL_PAID, limitDatePayment, STATUS }] } }` (see src/agora/parse.js).
   */
  invoices: {
    method: 'GET',
    path: 'InternalApi/API_DASHBOARD/invoicesAgpGrid',
    params: { state: 'all' },
  },
  /**
   * The last messages of the municipality, newest first (10 a page).
   * Captured from the portal (October 2026):
   * GET /InternalApi/API_DASHBOARD/emailLogs/0/1  (the last part is the page)
   * Answers `{ DATA: { count, data: [{ ID_NOTIFICATIONS, SUBJECT, SENDER,
   * SEND_DATE, IS_READ, BODY }] }, ERROR, TYPE_RESULT }`.
   */
  messages: { method: 'GET', path: 'InternalApi/API_DASHBOARD/emailLogs/0/1' },
  /** Ask to book one day of an activity. Not captured yet. */
  reserve: { method: 'POST', path: null },
  /** Ask to cancel one booked day of an activity. Not captured yet. */
  absence: { method: 'POST', path: null },
};

/** The portal pages a person opens, for the links of the widget and the docs. */
export const PAGES = {
  home: 'pck_home.home_view#/',
};
