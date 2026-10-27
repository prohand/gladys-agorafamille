// -----------------------------------------------------------------------------
// The words the integration says to the family, in every language of Gladys.
//
// Every text a user reads — connection status, action answers, widget rows —
// is a `{ en, fr, de, es }` object (see src/i18n.js). The ones used in more
// than one place live here.
// -----------------------------------------------------------------------------

import { ERROR_CODES } from './agora/client.js';
import { RESERVATION_STATUS } from './agora/parse.js';
import { localize, pick } from './i18n.js';

const STEPS = {
  login: { en: 'sign-in', fr: 'connexion', de: 'Anmeldung', es: 'inicio de sesión' },
  children: { en: 'children', fr: 'enfants', de: 'Kinder', es: 'hijos' },
  planning: { en: 'planning', fr: 'planning', de: 'Planung', es: 'planificación' },
  invoices: { en: 'invoices', fr: 'factures', de: 'Rechnungen', es: 'facturas' },
  messages: { en: 'messages', fr: 'messages', de: 'Nachrichten', es: 'mensajes' },
  reserve: { en: 'booking', fr: 'réservation', de: 'Buchung', es: 'reserva' },
  absence: { en: 'absence', fr: 'absence', de: 'Abwesenheit', es: 'ausencia' },
};

/**
 * What went wrong with the portal, for the Configuration screen and the
 * action answers.
 *
 * @param {import('./agora/client.js').AgoraError} error
 * @returns {{en: string, fr: string, de: string, es: string}}
 */
export function describeError(error) {
  const step = error?.step ? STEPS[error.step] : null;
  const where = (language) => (step ? ` (${pick(language, step)})` : '');
  const status = error?.status ? ` HTTP ${error.status}` : '';
  switch (error?.code) {
    case ERROR_CODES.CONFIG:
      return {
        en: 'Fill in the portal address, the login and the password.',
        fr: "Renseignez l'adresse du portail, l'identifiant et le mot de passe.",
        de: 'Gib die Portaladresse, den Benutzernamen und das Passwort ein.',
        es: 'Indique la dirección del portal, el usuario y la contraseña.',
      };
    case ERROR_CODES.AUTH:
      return localize(
        (language) =>
          pick(language, {
            en: 'The portal refused the login or the password',
            fr: "Le portail a refusé l'identifiant ou le mot de passe",
            de: 'Das Portal hat Benutzername oder Passwort abgelehnt',
            es: 'El portal rechazó el usuario o la contraseña',
          }) + `${where(language)}.`,
      );
    case ERROR_CODES.NETWORK:
      return localize(
        (language) =>
          pick(language, {
            en: 'The portal does not answer, it will be tried again',
            fr: 'Le portail ne répond pas, nouvel essai plus tard',
            de: 'Das Portal antwortet nicht, neuer Versuch später',
            es: 'El portal no responde, se volverá a intentar',
          }) + `${where(language)}.`,
      );
    case ERROR_CODES.REFUSED:
      return localize(
        (language) =>
          pick(language, {
            en: 'The portal declined the request',
            fr: 'Le portail a refusé la demande',
            de: 'Das Portal hat die Anfrage abgelehnt',
            es: 'El portal rechazó la solicitud',
          }) + `${where(language)}${error.message ? `: ${error.message}` : ''}.`,
      );
    default:
      return localize(
        (language) =>
          pick(language, {
            en: 'The portal answered something unexpected',
            fr: 'Le portail a répondu quelque chose d’inattendu',
            de: 'Das Portal hat etwas Unerwartetes geantwortet',
            es: 'El portal respondió algo inesperado',
          }) +
          `${where(language)}${status}. ` +
          pick(language, {
            en: 'See the integration logs.',
            fr: "Consultez les logs de l'intégration.",
            de: 'Siehe die Protokolle der Integration.',
            es: 'Consulte los registros de la integración.',
          }),
      );
  }
}

/** How a reservation state reads. */
export const STATUS_LABELS = {
  [RESERVATION_STATUS.REGISTERED]: {
    en: 'Not booked',
    fr: 'Non réservé',
    de: 'Nicht gebucht',
    es: 'Sin reservar',
  },
  [RESERVATION_STATUS.REQUESTED]: {
    en: 'Requested',
    fr: 'Demandé',
    de: 'Angefragt',
    es: 'Solicitado',
  },
  [RESERVATION_STATUS.RESERVED]: {
    en: 'Booked',
    fr: 'Réservé',
    de: 'Gebucht',
    es: 'Reservado',
  },
  [RESERVATION_STATUS.ABSENCE_REQUESTED]: {
    en: 'Absence requested',
    fr: 'Absence demandée',
    de: 'Abwesenheit angefragt',
    es: 'Ausencia solicitada',
  },
  [RESERVATION_STATUS.ABSENT]: {
    en: 'Absent',
    fr: 'Absent',
    de: 'Abwesend',
    es: 'Ausente',
  },
  [RESERVATION_STATUS.REFUSED]: {
    en: 'Refused',
    fr: 'Refusé',
    de: 'Abgelehnt',
    es: 'Rechazado',
  },
};

export const NOTHING_PLANNED = {
  en: 'Nothing booked',
  fr: 'Rien de réservé',
  de: 'Nichts gebucht',
  es: 'Nada reservado',
};

export const TODAY = { en: 'Today', fr: "Aujourd'hui", de: 'Heute', es: 'Hoy' };
export const TOMORROW = { en: 'Tomorrow', fr: 'Demain', de: 'Morgen', es: 'Mañana' };

/** An amount in euros, the way the reader writes it: 45.20 € / 45,20 €. */
export function formatEuros(amount, language) {
  const locale = { en: 'en-IE', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' }[language] ?? 'en-IE';
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(amount);
}
