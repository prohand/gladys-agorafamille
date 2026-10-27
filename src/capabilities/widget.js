// -----------------------------------------------------------------------------
// Dashboard widget (Gladys 5.1+): the family portal at a glance.
//
// What a parent opens the portal for, on the dashboard: what is owed, who eats
// at the canteen today and tomorrow, the invoices to pay and the unread
// messages. And the two things they do there most: declare an absence (a sick
// child) and book a forgotten lunch, each behind a short form.
//
// The content is declarative (the core renders it, no HTML): see the "Dashboard
// widgets" section of the SDK README for the vocabulary and the budget — at
// most 8 components, 1 focal, 6 tiles, 2 texts, 1 status list, 4 buttons.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { createLogger } from '../logging.js';
import { PAGES } from '../agora/endpoints.js';
import { addDays, daysBetween, formatDay } from '../agora/dates.js';
import { EXPECTED_STATUSES, RESERVATION_STATUS } from '../agora/parse.js';
import {
  dayEntries,
  expectedActivities,
  unpaidInvoices,
  unreadMessages,
} from '../agora/snapshot.js';
import { ACCOUNT_FEATURES, accountIds } from '../devices/index.js';
import { localize, pick } from '../i18n.js';
import { NOTHING_PLANNED, TODAY, TOMORROW, describeError, formatEuros } from '../messages.js';
import { matchesActivity } from './scenes.js';

const logger = createLogger({ name: 'widget' });

/** Key of the manifest widget. Never renamed: dashboards store it. */
export const FAMILY_WIDGET = 'family';

/** The widget actions, relayed back by key. Never renamed. */
export const WIDGET_ACTIONS = { REFRESH: 'refresh', ABSENCE: 'absence', RESERVE: 'reserve' };

/** The status list holds 10 rows: two per child. */
const MAX_CHILDREN = 5;

/** The card list holds 8 rows. */
const MAX_CARDS = 8;

/** Texts of the vocabulary are capped by the core; cut them ourselves, cleanly. */
const LIMITS = { statusLabel: 40, statusValue: 40, cardTitle: 60, caption: 80 };

/**
 * The content of the `family` widget.
 *
 * @param {object} state
 * @param {object} state.gladys
 * @param {object} state.config normalized configuration
 * @param {object|null} state.snapshot last read of the portal
 * @param {object|null} state.error the error of the last read, if it failed
 * @param {string} [state.language] the reader's language
 */
export function buildWidgetContent({ gladys, config, snapshot, error, language = 'en' }) {
  const say = (texts) => pick(language, texts);
  if (!config.configured) {
    return {
      ttl_seconds: 600,
      components: [
        {
          type: 'text',
          variant: 'body',
          text: say(describeError({ code: 'config' })),
        },
      ],
    };
  }

  const components = [
    {
      type: 'value',
      label: say({ en: 'To pay', fr: 'À payer', de: 'Zu zahlen', es: 'A pagar' }),
      icon: 'credit-card',
      device_feature: accountIds(gladys, config).feature(ACCOUNT_FEATURES.BALANCE),
    },
  ];

  const rows = childRows(snapshot, language);
  if (rows.length > 0) {
    components.push({ type: 'status', items: rows });
  }

  const cards = buildCards(snapshot, language);
  if (cards.length > 0) {
    components.push({ type: 'card-list', display: 'list', items: cards });
  }

  components.push({ type: 'text', variant: 'caption', text: caption(snapshot, error, language) });

  components.push({
    type: 'button',
    label: say({ en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' }),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: WIDGET_ACTIONS.REFRESH },
  });

  const children = (snapshot?.children ?? []).slice(0, MAX_CHILDREN);
  if (children.length > 0) {
    components.push(
      {
        type: 'button',
        label: say({ en: 'Absence', fr: 'Absence', de: 'Abwesenheit', es: 'Ausencia' }),
        icon: 'user-x',
        style: 'secondary',
        action: {
          key: WIDGET_ACTIONS.ABSENCE,
          fields: formFields(children, snapshot.today),
        },
      },
      {
        type: 'button',
        label: say({
          en: 'Book a lunch',
          fr: 'Réserver un repas',
          de: 'Essen buchen',
          es: 'Reservar comida',
        }),
        icon: 'calendar',
        style: 'secondary',
        action: {
          key: WIDGET_ACTIONS.RESERVE,
          fields: formFields(children, snapshot.today),
        },
      },
    );
  }

  components.push({
    type: 'button',
    label: say({
      en: 'Open portal',
      fr: 'Ouvrir le portail',
      de: 'Portal öffnen',
      es: 'Abrir portal',
    }),
    icon: 'external-link',
    style: 'secondary',
    link: { url: `${config.portalBase}/${PAGES.home}` },
  });

  // The computed parts change with each read, and index.js nudges the widget
  // after every one: the TTL is only a safety net.
  return { ttl_seconds: 900, components };
}

/** Two rows per child: today and tomorrow. */
function childRows(snapshot, language) {
  if (!snapshot) {
    return [];
  }
  const rows = [];
  for (const child of snapshot.children.slice(0, MAX_CHILDREN)) {
    for (const [offset, label] of [
      [0, TODAY],
      [1, TOMORROW],
    ]) {
      const day = addDays(snapshot.today, offset);
      const booked = expectedActivities(snapshot, child.id, day);
      const pending = booked.some((entry) => entry.status === RESERVATION_STATUS.REQUESTED);
      const refused = dayEntries(snapshot, child.id, day).some(
        (entry) => entry.status === RESERVATION_STATUS.REFUSED,
      );
      rows.push({
        label: cut(`${child.name} · ${pick(language, label)}`, LIMITS.statusLabel),
        icon: offset === 0 ? 'sun' : 'sunrise',
        value: cut(
          booked.length > 0
            ? booked.map((entry) => entry.activity).join(', ')
            : pick(language, NOTHING_PLANNED),
          LIMITS.statusValue,
        ),
        color: refused
          ? WIDGET_COLORS.DANGER
          : pending
            ? WIDGET_COLORS.WARNING
            : booked.length > 0
              ? WIDGET_COLORS.SUCCESS
              : WIDGET_COLORS.NEUTRAL,
      });
    }
  }
  return rows;
}

/** The invoices to pay first, then the unread messages. */
function buildCards(snapshot, language) {
  if (!snapshot) {
    return [];
  }
  const cards = [];
  for (const invoice of unpaidInvoices(snapshot)) {
    const left = invoice.dueOn ? daysBetween(snapshot.today, invoice.dueOn) : null;
    cards.push({
      title: cut(invoice.label, LIMITS.cardTitle),
      subtitle: formatEuros(invoice.remaining, language),
      ...(invoice.dueOn ? { date: invoice.dueOn } : {}),
      badge:
        left !== null && left < 0
          ? {
              text: pick(language, {
                en: 'Overdue',
                fr: 'En retard',
                de: 'Überfällig',
                es: 'Vencida',
              }),
              color: WIDGET_COLORS.DANGER,
            }
          : {
              text: pick(language, { en: 'To pay', fr: 'À payer', de: 'Offen', es: 'A pagar' }),
              color: WIDGET_COLORS.WARNING,
            },
    });
  }
  for (const message of unreadMessages(snapshot)) {
    cards.push({
      title: cut(message.subject, LIMITS.cardTitle),
      ...(message.sender ? { subtitle: cut(message.sender, LIMITS.cardTitle) } : {}),
      ...(message.date ? { date: message.date } : {}),
      badge: {
        text: pick(language, { en: 'Message', fr: 'Message', de: 'Nachricht', es: 'Mensaje' }),
        color: WIDGET_COLORS.INFO,
      },
    });
  }
  return cards.slice(0, MAX_CARDS);
}

function caption(snapshot, error, language) {
  if (error) {
    return cut(pick(language, describeError(error)), LIMITS.caption);
  }
  if (!snapshot) {
    return pick(language, {
      en: 'Waiting for the first read of the portal…',
      fr: 'En attente de la première lecture du portail…',
      de: 'Warte auf das erste Lesen des Portals…',
      es: 'Esperando la primera lectura del portal…',
    });
  }
  const time = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(snapshot.at));
  return pick(language, {
    en: `Updated at ${time}`,
    fr: `Mis à jour à ${time}`,
    de: `Aktualisiert um ${time}`,
    es: `Actualizado a las ${time}`,
  });
}

/**
 * The form behind the Absence and Book buttons: which child, which day. Form
 * labels are multi-language objects (the core picks the reader's language).
 */
function formFields(children, today) {
  return [
    {
      key: 'child',
      type: 'select',
      required: true,
      default: children[0].id,
      label: { en: 'Child', fr: 'Enfant', de: 'Kind', es: 'Niño' },
      options: children.map((child) => ({
        value: child.id,
        label: localize(() => cut(child.name, 40)),
      })),
    },
    {
      key: 'day',
      type: 'select',
      required: true,
      default: '1',
      label: { en: 'Day', fr: 'Jour', de: 'Tag', es: 'Día' },
      options: [0, 1, 2, 3].map((offset) => ({
        value: String(offset),
        label:
          offset === 0
            ? TODAY
            : offset === 1
              ? TOMORROW
              : localize((language) => formatDay(addDays(today, offset), language)),
      })),
    },
  ];
}

/**
 * The widget, wired to the integration state.
 *
 * @param {object} context
 * @param {object} context.gladys
 * @param {() => object} context.getConfig
 * @param {() => object} context.getService
 * @param {(result: object) => Promise<void>} context.onSynced
 */
export function createWidget({ gladys, getConfig, getService, onSynced }) {
  return {
    async get({ language }) {
      const service = getService();
      return buildWidgetContent({
        gladys,
        config: getConfig(),
        snapshot: service.snapshot,
        error: service.lastError,
        language: language ?? 'en',
      });
    },

    async action(actionKey, params, { values } = {}) {
      logger.info(`Widget action ${actionKey}`);
      const service = getService();
      if (actionKey === WIDGET_ACTIONS.REFRESH) {
        const result = await service.sync({ force: true });
        await onSynced(result);
        if (result.error) {
          throw new Error(describeError(result.error).en);
        }
        return { en: 'Portal read', fr: 'Portail lu', de: 'Portal gelesen', es: 'Portal leído' };
      }
      if (actionKey !== WIDGET_ACTIONS.ABSENCE && actionKey !== WIDGET_ACTIONS.RESERVE) {
        throw new Error(`Unknown widget action: ${actionKey}`);
      }
      // An older core drops the form and relays the tap without values:
      // refuse rather than act on a child nobody chose.
      if (!values?.child) {
        throw new Error('This Gladys version does not send the form: update Gladys');
      }
      const snapshot = service.snapshot;
      const child = snapshot?.children.find((candidate) => candidate.id === values.child);
      if (!child) {
        throw new Error('Unknown child: refresh the widget');
      }
      const day = addDays(snapshot.today, Number(values.day ?? 0));
      const entries = dayEntries(snapshot, child.id, day);
      if (actionKey === WIDGET_ACTIONS.ABSENCE) {
        const targets = entries.filter((entry) => EXPECTED_STATUSES.includes(entry.status));
        if (targets.length === 0) {
          return {
            en: `${child.name} has nothing booked that day.`,
            fr: `${child.name} n'a rien de réservé ce jour-là.`,
            de: `${child.name} hat an dem Tag nichts gebucht.`,
            es: `${child.name} no tiene nada reservado ese día.`,
          };
        }
        for (const entry of targets) {
          await onSynced(
            await service.requestAbsence({ childId: child.id, day, activityId: entry.activityId }),
          );
        }
        return {
          en: `Absence requested for ${child.name}.`,
          fr: `Absence demandée pour ${child.name}.`,
          de: `Abwesenheit für ${child.name} angefragt.`,
          es: `Ausencia solicitada para ${child.name}.`,
        };
      }
      const meals = entries.filter((entry) => matchesActivity(entry, 'cantine'));
      if (meals.some((entry) => EXPECTED_STATUSES.includes(entry.status))) {
        return {
          en: `${child.name} already has lunch booked.`,
          fr: `Le repas de ${child.name} est déjà réservé.`,
          de: `Das Essen für ${child.name} ist bereits gebucht.`,
          es: `La comida de ${child.name} ya está reservada.`,
        };
      }
      const target = meals[0];
      if (!target) {
        return {
          en: `${child.name} is not registered for the canteen that day.`,
          fr: `${child.name} n'est pas inscrit(e) à la cantine ce jour-là.`,
          de: `${child.name} ist an dem Tag nicht für die Kantine angemeldet.`,
          es: `${child.name} no está inscrito/a en el comedor ese día.`,
        };
      }
      const result = await service.requestReservation({
        childId: child.id,
        day,
        activityId: target.activityId,
      });
      await onSynced(result);
      return {
        en: `Lunch requested for ${child.name}.`,
        fr: `Repas demandé pour ${child.name}.`,
        de: `Essen für ${child.name} angefragt.`,
        es: `Comida solicitada para ${child.name}.`,
      };
    },
  };
}

function cut(text, length) {
  const value = String(text ?? '');
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}
