// -----------------------------------------------------------------------------
// Booking and cancelling a day, by the rules of the portal's own calendar.
//
// The reservation calendar of the portal (pck_calendar_comp, October 2026)
// decides what a click on a day may do from the fields of that day, and sends
// one line per day to API_CALENDAR_COMPONENT/booking. This module applies the
// same rules before anything is sent, and refuses — with the reason, in the
// reader's language — what the calendar would not let a parent do: a past
// day, a closed booking period, a full activity, a day with several rates to
// choose from, a cancellation that costs a penalty. A wrong request books a
// lunch nobody wanted, or is charged: when in doubt, the portal decides.
// -----------------------------------------------------------------------------

import { AgoraError, ERROR_CODES, frenchDate } from './client.js';

/** Why a day cannot be booked or cancelled from Gladys. */
export const BOOKING_REFUSALS = {
  UNKNOWN: {
    en: 'this day is not known to the portal',
    fr: 'ce jour est inconnu du portail',
    de: 'dieser Tag ist dem Portal nicht bekannt',
    es: 'el portal no conoce este día',
  },
  PAST: {
    en: 'the day is over',
    fr: 'le jour est passé',
    de: 'der Tag ist vorbei',
    es: 'el día ya pasó',
  },
  UNAVAILABLE: {
    en: 'the activity is not available that day',
    fr: "l'activité n'est pas disponible ce jour-là",
    de: 'die Aktivität ist an dem Tag nicht verfügbar',
    es: 'la actividad no está disponible ese día',
  },
  PRESENCE: {
    en: 'attendance for this day is managed on the portal',
    fr: 'la présence de ce jour se gère sur le portail',
    de: 'die Anwesenheit an diesem Tag wird im Portal verwaltet',
    es: 'la asistencia de este día se gestiona en el portal',
  },
  FULL: {
    en: 'the activity is full',
    fr: "l'activité est complète",
    de: 'die Aktivität ist ausgebucht',
    es: 'la actividad está completa',
  },
  CLOSED: {
    en: 'bookings are closed for that day',
    fr: 'les réservations sont fermées pour ce jour',
    de: 'Buchungen für diesen Tag sind geschlossen',
    es: 'las reservas están cerradas para ese día',
  },
  RATES: {
    en: 'a rate has to be chosen: book it on the portal',
    fr: 'un tarif doit être choisi : réservez sur le portail',
    de: 'ein Tarif muss gewählt werden: im Portal buchen',
    es: 'hay que elegir una tarifa: reserve en el portal',
  },
  NOT_BOOKED: {
    en: 'the day is not booked',
    fr: "le jour n'est pas réservé",
    de: 'der Tag ist nicht gebucht',
    es: 'el día no está reservado',
  },
  TOO_LATE: {
    en: 'it is too late to cancel this day',
    fr: 'il est trop tard pour annuler ce jour',
    de: 'es ist zu spät, diesen Tag zu stornieren',
    es: 'es demasiado tarde para cancelar este día',
  },
  PENALTY: {
    en: 'cancelling now costs a penalty: do it on the portal',
    fr: 'annuler maintenant coûte une majoration : faites-le sur le portail',
    de: 'eine Stornierung kostet jetzt einen Aufschlag: im Portal erledigen',
    es: 'cancelar ahora tiene un recargo: hágalo en el portal',
  },
  PAYMENT: {
    en: 'this booking is paid online: book it on the portal',
    fr: 'cette réservation se paie en ligne : réservez sur le portail',
    de: 'diese Buchung wird online bezahlt: im Portal buchen',
    es: 'esta reserva se paga en línea: reserve en el portal',
  },
};

function refuse(reason, step) {
  return new AgoraError(ERROR_CODES.REFUSED, reason.en, { step, reason });
}

const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * The line that books a day, as the calendar's getDataToBook writes it.
 *
 * @param {object} entry a planning entry (src/agora/parse.js), with its `refs`
 * @param {string} today `YYYY-MM-DD`
 */
export function reservationLine(entry, today) {
  const refs = entry?.refs;
  if (!refs || refs.ID_INSCRIPTION === undefined) {
    throw refuse(BOOKING_REFUSALS.UNKNOWN, 'reserve');
  }
  if (entry.day < today) {
    throw refuse(BOOKING_REFUSALS.PAST, 'reserve');
  }
  if (number(refs.IS_UNAVAILABLE) > 0 || number(refs.ACT_BLOCK_BY_CRITERIA) === 1) {
    throw refuse(BOOKING_REFUSALS.UNAVAILABLE, 'reserve');
  }
  if (number(refs.PRESENCE_TYPE) > 0) {
    throw refuse(BOOKING_REFUSALS.PRESENCE, 'reserve');
  }
  if (refs.AVAILABLE_SLOT !== undefined && number(refs.AVAILABLE_SLOT) <= 0) {
    throw refuse(BOOKING_REFUSALS.FULL, 'reserve');
  }
  if (number(refs.CAN_SUBSCRIPTION) !== 1) {
    throw refuse(BOOKING_REFUSALS.CLOSED, 'reserve');
  }
  // The calendar books on its own only a day with a single rate; with
  // several, the parent picks one in a dialog.
  if (!Array.isArray(refs.SUB_EVENTS) || refs.SUB_EVENTS.length !== 1) {
    throw refuse(BOOKING_REFUSALS.RATES, 'reserve');
  }
  return {
    IdInscription: refs.ID_INSCRIPTION,
    Day: frenchDate(entry.day),
    IdDefTarif: refs.SUB_EVENTS[0],
    IsMajored: Boolean(number(refs.IS_MAJORED)),
    DeleteBasketEvent: -1,
  };
}

/**
 * The line that cancels a booked day, as the calendar's getDataToBook writes
 * it for a day clicked off.
 */
export function cancellationLine(entry, today) {
  const refs = entry?.refs;
  if (!refs || refs.ID_INSCRIPTION === undefined) {
    throw refuse(BOOKING_REFUSALS.UNKNOWN, 'absence');
  }
  if (entry.day < today) {
    throw refuse(BOOKING_REFUSALS.PAST, 'absence');
  }
  if (number(refs.IS_SELECTED) <= 0) {
    throw refuse(BOOKING_REFUSALS.NOT_BOOKED, 'absence');
  }
  if (number(refs.IS_UNAVAILABLE) > 0 || number(refs.ACT_BLOCK_BY_CRITERIA) === 1) {
    throw refuse(BOOKING_REFUSALS.UNAVAILABLE, 'absence');
  }
  if (number(refs.CAN_UNSUBSCRIPTION) !== 1) {
    throw refuse(BOOKING_REFUSALS.TOO_LATE, 'absence');
  }
  // The calendar asks the parent to accept the penalty first: never
  // accepted on their behalf.
  if (number(refs.IS_MAJORED) > 0) {
    throw refuse(BOOKING_REFUSALS.PENALTY, 'absence');
  }
  return {
    IdInscription: refs.ID_INSCRIPTION,
    Day: frenchDate(entry.day),
    IdDefTarif: -1,
    IsMajored: false,
    DeleteBasketEvent: number(refs.IS_BASKET) > 0 ? 1 : -1,
  };
}
