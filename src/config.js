// -----------------------------------------------------------------------------
// Integration configuration.
//
// The user fills it in Gladys from the `config_schema` of
// `gladys-assistant-integration.json`; the SDK fetches it (`gladys.getConfig()`)
// and notifies every change (`gladys.onConfigUpdated()`).
//
// This module provides the defaults and normalizes the received object, so the
// rest of the code never deals with `undefined`, a number typed as a string or
// a portal address pasted in one of the many shapes users copy it in.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  portal_url: '', // https://portalssl.agoraplus.fr/<commune>, or just <commune>
  username: '', // the e-mail address used on the family portal
  password: '', // secret: never logged
  refresh_minutes: 60, // minutes between two reads of the portal
  days_ahead: 14, // how many days of reservations are watched
  due_reminder_days: 3, // "invoice due soon" this many days before; 0 = off
  debug_logs: false, // raise the log level to debug, from the Configuration screen
};

/** The portal never moves faster than this: a family checks it a few times a day. */
export const MIN_REFRESH_MINUTES = 15;
export const MAX_REFRESH_MINUTES = 1440;
export const MAX_DAYS_AHEAD = 60;
export const MAX_DUE_REMINDER_DAYS = 15;

/** Where every Agora Famille portal lives, one path per municipality. */
export const AGORA_HOST = 'https://portalssl.agoraplus.fr';

/**
 * Merge the user config with the defaults and resolve the portal address.
 *
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const config = {
    ...DEFAULT_CONFIG,
    ...raw,
    username: String(raw.username ?? '').trim(),
    // Not trimmed: a password may end with a space, and it is the user's.
    password: String(raw.password ?? ''),
    refresh_minutes: clampInteger(
      raw.refresh_minutes,
      DEFAULT_CONFIG.refresh_minutes,
      MIN_REFRESH_MINUTES,
      MAX_REFRESH_MINUTES,
    ),
    days_ahead: clampInteger(raw.days_ahead, DEFAULT_CONFIG.days_ahead, 1, MAX_DAYS_AHEAD),
    due_reminder_days: clampInteger(
      raw.due_reminder_days,
      DEFAULT_CONFIG.due_reminder_days,
      0,
      MAX_DUE_REMINDER_DAYS,
    ),
    debug_logs: toBoolean(raw.debug_logs, DEFAULT_CONFIG.debug_logs),
  };
  const portal = parsePortalUrl(raw.portal_url);
  config.portal_url = portal?.url ?? '';
  config.portalBase = portal?.base ?? null;
  config.commune = portal?.commune ?? null;
  config.configured = Boolean(config.portalBase && config.username && config.password);
  // The account the devices hang on: the commune and the login, hashed so the
  // e-mail address never ends up in a Gladys external id.
  config.accountId = config.configured
    ? `${config.commune}-${hash(config.username.toLowerCase())}`
    : null;
  return config;
}

/**
 * The portal of one municipality, from what the user pasted.
 *
 * Accepted, all of them seen in municipal guides and browser bars:
 *   lognes
 *   portalssl.agoraplus.fr/lognes
 *   https://portalssl.agoraplus.fr/lognes/
 *   https://portalssl.agoraplus.fr/lognes/pck_home.home_view#/
 *   https://famille.ma-ville.fr/agora  (a municipality behind its own name)
 *
 * The page part (`pck_…`, `#/…`, a query) is dropped: the integration only
 * needs the base the portal pages hang on.
 *
 * @returns {{url: string, base: string, commune: string}|null}
 */
export function parsePortalUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) {
    return null;
  }
  // A bare name is the path of the municipality on the shared host.
  if (/^[a-z0-9][a-z0-9_-]*$/i.test(text)) {
    const commune = text.toLowerCase();
    const base = `${AGORA_HOST}/${commune}`;
    return { url: base, base, commune };
  }
  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return null;
  }
  // The portal speaks HTTPS only, and the password goes through it: an http://
  // link copied from an old guide is upgraded rather than followed.
  url.protocol = 'https:';
  const segments = url.pathname
    .split('/')
    .filter(Boolean)
    // `pck_home.home_view` and its siblings are pages, not the municipality.
    .filter((segment) => !/^pck_/i.test(segment) && !segment.includes('.'));
  if (segments.length === 0) {
    return null;
  }
  const commune = segments[segments.length - 1].toLowerCase();
  const base = `${url.origin}/${segments.join('/')}`;
  return { url: base, base, commune };
}

function hash(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

function clampInteger(value, fallback, min, max) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(number)));
}

function toBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}
