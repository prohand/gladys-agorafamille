// -----------------------------------------------------------------------------
// The HTTP client of one Agora Famille account.
//
// The portal is a web site, not an API: it keeps the signed-in state in a
// session cookie, and an expired session does not answer 401 — it answers the
// login page, with a 200 or a redirect. So every answer is checked for being
// what was asked (JSON), and a login page in its place is read as "session
// expired": sign in again, once, and repeat the request.
//
// The password only ever leaves this module in the body of the login request,
// over HTTPS. It is never logged, and neither are the cookies.
// -----------------------------------------------------------------------------

import { createLogger } from '../logging.js';
import { ENDPOINTS } from './endpoints.js';
import { parseChildren, parseInvoices, parseMessages, parsePlanning } from './parse.js';

const logger = createLogger({ name: 'agora' });

/** A slow portal is common at 8 a.m. on a school day; past this, it is down. */
export const REQUEST_TIMEOUT_MS = 20_000;

/** What went wrong, in terms a status message can explain. */
export const ERROR_CODES = {
  CONFIG: 'config', // nothing to sign in with yet
  AUTH: 'auth', // the portal refused the credentials
  NETWORK: 'network', // no answer (DNS, timeout, connection refused)
  HTTP: 'http', // an answer, but an error status
  FORMAT: 'format', // an answer the integration cannot read
  REFUSED: 'refused', // a reservation or absence request the portal declined
};

export class AgoraError extends Error {
  /**
   * @param {string} code a value of ERROR_CODES
   * @param {string} message English, for the logs
   * @param {object} [details] `{ status, step }`
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AgoraError';
    this.code = code;
    this.status = details.status ?? null;
    this.step = details.step ?? null;
  }
}

/** Thrown internally when the portal answers its login page instead of data. */
class SessionExpired extends Error {}

export class AgoraClient {
  /**
   * @param {object} options
   * @param {string} options.base portal of the municipality, without trailing slash
   * @param {string} options.username
   * @param {string} options.password
   * @param {typeof fetch} [options.fetch] injected by the tests
   * @param {number} [options.timeoutMs]
   */
  constructor({ base, username, password, fetch = globalThis.fetch, timeoutMs }) {
    this.base = base;
    this.username = username;
    this.password = password;
    this.fetch = fetch;
    this.timeoutMs = timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.cookies = new Map();
    this.signedIn = false;
  }

  /** Sign in, and keep the session cookie for the next requests. */
  async login() {
    if (!this.base || !this.username || !this.password) {
      throw new AgoraError(ERROR_CODES.CONFIG, 'Portal address, login or password missing', {
        step: 'login',
      });
    }
    this.cookies.clear();
    this.signedIn = false;
    const { fields } = ENDPOINTS.login;
    const body = new URLSearchParams({
      [fields.username]: this.username,
      [fields.password]: this.password,
    });
    const response = await this.send(ENDPOINTS.login, {
      body,
      contentType: 'application/x-www-form-urlencoded',
      step: 'login',
    });
    if (response.status === 401 || response.status === 403) {
      throw new AgoraError(ERROR_CODES.AUTH, 'The portal refused the login or password', {
        status: response.status,
        step: 'login',
      });
    }
    if (response.status >= 400) {
      await this.logAnswer(ENDPOINTS.login, response);
      throw new AgoraError(ERROR_CODES.HTTP, `Login answered HTTP ${response.status}`, {
        status: response.status,
        step: 'login',
      });
    }
    // A refused login answers 200 too, with a message: read it when it is JSON.
    const answer = await readJson(response).catch(() => null);
    if (answer && isFailure(answer)) {
      throw new AgoraError(ERROR_CODES.AUTH, 'The portal refused the login or password', {
        status: response.status,
        step: 'login',
      });
    }
    if (this.cookies.size === 0) {
      throw new AgoraError(ERROR_CODES.AUTH, 'The portal opened no session after the login', {
        status: response.status,
        step: 'login',
      });
    }
    this.signedIn = true;
    logger.debug('Signed in to the portal');
  }

  async getChildren() {
    return parseChildren(await this.call(ENDPOINTS.children, { step: 'children' }));
  }

  /**
   * @param {string} from first day, `YYYY-MM-DD`
   * @param {string} to last day, `YYYY-MM-DD`
   * @param {Array<object>} [children] see parsePlanning
   */
  async getPlanning(from, to, children = []) {
    const { query } = ENDPOINTS.planning;
    const payload = await this.call(ENDPOINTS.planning, {
      query: { [query.from]: frenchDate(from), [query.to]: frenchDate(to) },
      step: 'planning',
    });
    return parsePlanning(payload, children);
  }

  async getInvoices() {
    return parseInvoices(await this.call(ENDPOINTS.invoices, { step: 'invoices' }));
  }

  async getMessages() {
    return parseMessages(await this.call(ENDPOINTS.messages, { step: 'messages' }));
  }

  /** Ask to book one day of an activity. Resolves once the portal accepted the request. */
  async requestReservation({ childId, day, activityId }) {
    await this.submit(ENDPOINTS.reserve, { childId, day, activityId }, 'reserve');
  }

  /** Ask to cancel one booked day of an activity. */
  async requestAbsence({ childId, day, activityId }) {
    await this.submit(ENDPOINTS.absence, { childId, day, activityId }, 'absence');
  }

  async submit(endpoint, { childId, day, activityId }, step) {
    const answer = await this.call(endpoint, {
      body: JSON.stringify({ idEnfant: childId, date: frenchDate(day), idActivite: activityId }),
      contentType: 'application/json',
      step,
    });
    if (isFailure(answer)) {
      throw new AgoraError(ERROR_CODES.REFUSED, failureMessage(answer) ?? 'Request declined', {
        step,
      });
    }
  }

  /**
   * One JSON request, signed in first if needed, signed in again once if the
   * session expired on the way.
   */
  async call(endpoint, options) {
    if (!this.signedIn) {
      await this.login();
    }
    try {
      return await this.requestJson(endpoint, options);
    } catch (err) {
      if (!(err instanceof SessionExpired)) {
        throw err;
      }
      logger.debug(`Session expired during "${options.step}": signing in again`);
      await this.login();
      try {
        return await this.requestJson(endpoint, options);
      } catch (retryErr) {
        if (retryErr instanceof SessionExpired) {
          throw new AgoraError(ERROR_CODES.AUTH, 'The portal keeps answering its login page', {
            step: options.step,
          });
        }
        throw retryErr;
      }
    }
  }

  async requestJson(endpoint, options) {
    const response = await this.send(endpoint, options);
    if (
      response.status === 401 ||
      response.status === 403 ||
      (response.status >= 300 && response.status < 400)
    ) {
      this.signedIn = false;
      throw new SessionExpired();
    }
    if (response.status >= 400) {
      await this.logAnswer(endpoint, response);
      throw new AgoraError(ERROR_CODES.HTTP, `"${options.step}" answered HTTP ${response.status}`, {
        status: response.status,
        step: options.step,
      });
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/html')) {
      // The login page, served in place of the data.
      this.signedIn = false;
      throw new SessionExpired();
    }
    try {
      return await readJson(response);
    } catch {
      throw new AgoraError(ERROR_CODES.FORMAT, `"${options.step}" did not answer JSON`, {
        status: response.status,
        step: options.step,
      });
    }
  }

  async send(endpoint, { query, body, contentType, step }) {
    const url = new URL(`${this.base}/${endpoint.path}`);
    for (const [name, value] of Object.entries(query ?? {})) {
      url.searchParams.set(name, value);
    }
    const headers = {
      accept: 'application/json, text/plain, */*',
      'x-requested-with': 'XMLHttpRequest',
    };
    if (contentType) {
      headers['content-type'] = contentType;
    }
    if (this.cookies.size > 0) {
      headers.cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    }
    logger.debug(`${endpoint.method} ${endpoint.path} (${step})`);
    let response;
    try {
      response = await this.fetch(url, {
        method: endpoint.method,
        headers,
        body: endpoint.method === 'GET' ? undefined : body,
        // A redirect is how the portal says "sign in": followed, it would
        // look like a successful page.
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new AgoraError(
        ERROR_CODES.NETWORK,
        `"${step}": no answer from the portal (${err.cause?.code ?? err.name})`,
        { step },
      );
    }
    this.keepCookies(response);
    return response;
  }

  /**
   * What the portal answered to a request it refused, for the logs: the URL
   * asked, the type and the start of the answer, tags and blanks removed. It
   * is what tells a wrong address (an error page of the server) from wrong
   * field names (a message of the portal) — the only way to adapt
   * src/agora/endpoints.js to a portal nobody documents. The login and the
   * password are masked, in case the page repeats what it was sent.
   */
  async logAnswer(endpoint, response) {
    let excerpt = '';
    try {
      excerpt = (await response.text())
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    } catch {
      // No body to show.
    }
    for (const secret of [this.password, this.username]) {
      if (secret) {
        excerpt = excerpt.split(secret).join('***');
      }
    }
    logger.warn(
      `${endpoint.method} ${this.base}/${endpoint.path} -> HTTP ${response.status} ` +
        `(${response.headers.get('content-type') ?? 'no content type'}): ` +
        `${excerpt.slice(0, 300) || '(empty answer)'}`,
    );
  }

  keepCookies(response) {
    const lines =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [response.headers.get('set-cookie')].filter(Boolean);
    for (const line of lines) {
      const [pair, ...attributes] = line.split(';');
      const separator = pair.indexOf('=');
      if (separator <= 0) {
        continue;
      }
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const expired = attributes.some((attribute) =>
        /^\s*max-age\s*=\s*(0|-\d+)\s*$/i.test(attribute),
      );
      if (expired || value === '') {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }
}

async function readJson(response) {
  const text = await response.text();
  return JSON.parse(text);
}

/** `{ success: false }`, `{ erreur: "…" }`, `{ status: "KO" }`: the portal said no. */
function isFailure(answer) {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
    return false;
  }
  if (answer.success === false || answer.ok === false || answer.result === false) {
    return true;
  }
  if (typeof answer.status === 'string' && /^(ko|error|erreur)$/i.test(answer.status)) {
    return true;
  }
  return Boolean(answer.erreur || answer.error || answer.errorMessage);
}

function failureMessage(answer) {
  const message = answer?.message ?? answer?.erreur ?? answer?.error ?? answer?.errorMessage;
  return typeof message === 'string' && message.trim() ? message.trim().slice(0, 200) : null;
}

/** `2026-11-05` → `05/11/2026`, the way the portal's forms write a day. */
export function frenchDate(day) {
  const [year, month, date] = day.split('-');
  return `${date}/${month}/${year}`;
}
