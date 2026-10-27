// -----------------------------------------------------------------------------
// The pages of the Agora Famille portal the integration reads and writes.
//
// Agora Plus publishes no API for its family portal: these are the requests
// the portal's own web pages make, relative to the portal of the municipality
// (`https://portalssl.agoraplus.fr/<commune>/`). They live here, and only here,
// so that adapting the integration to a portal update — or to a municipality
// whose portal answers elsewhere — is a change to this file alone, without
// touching the logic that uses the answers (src/agora/parse.js reads them
// tolerantly, whatever the field names).
//
// To check them against a real account: open the portal in a browser, open
// the developer tools (Network tab, "Fetch/XHR"), sign in and visit the
// planning, the invoices and the messages. Every request listed there is the
// truth; this file follows it. "Test the connection" (Configuration screen)
// names the step that failed and the HTTP status the portal answered.
// -----------------------------------------------------------------------------

export const ENDPOINTS = {
  /** Sign in: the form of the home page. Answers with the session cookie. */
  login: {
    method: 'POST',
    path: 'pck_home.validation',
    // Names of the form fields carrying the credentials.
    fields: { username: 'p_login', password: 'p_password' },
  },
  /** The children of the family. */
  children: { method: 'GET', path: 'pck_famille.get_enfants' },
  /** The planning of every child over a window of days (dates as dd/mm/yyyy). */
  planning: {
    method: 'GET',
    path: 'pck_planning.get_planning',
    query: { from: 'p_date_debut', to: 'p_date_fin' },
  },
  /** The invoices, paid and to pay. */
  invoices: { method: 'GET', path: 'pck_facturation.get_factures' },
  /** The messages and notifications of the municipality. */
  messages: { method: 'GET', path: 'pck_messagerie.get_messages' },
  /** Ask to book one day of an activity. */
  reserve: { method: 'POST', path: 'pck_planning.demande_reservation' },
  /** Ask to cancel one booked day of an activity. */
  absence: { method: 'POST', path: 'pck_planning.demande_absence' },
};

/** The portal pages a person opens, for the links of the widget and the docs. */
export const PAGES = {
  home: 'pck_home.home_view#/',
};
