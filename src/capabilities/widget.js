// -----------------------------------------------------------------------------
// Dashboard widget (Gladys 5.1+): the family portal at a glance.
//
// What a parent opens the portal for, on the dashboard: what is owed, who eats
// at the canteen today and tomorrow, the invoices to pay and the last unread
// messages. Read-only, kept short: booking and absences are scene actions,
// and the portal is one tap away.
//
// The content is declarative (the core renders it, no HTML): see the "Dashboard
// widgets" section of the SDK README for the vocabulary and the budget — at
// most 8 components, 1 focal, 6 tiles, 2 texts, 1 status list, 4 buttons.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { createLogger } from '../logging.js';
import { PAGES } from '../agora/endpoints.js';
import { addDays, daysBetween } from '../agora/dates.js';
import { RESERVATION_STATUS } from '../agora/parse.js';
import {
  balanceOf,
  dayEntries,
  expectedActivities,
  treasuryInvoices,
  unpaidInvoices,
  unreadMessages,
} from '../agora/snapshot.js';
import { pick } from '../i18n.js';
import {
  NOTHING_PLANNED,
  TODAY,
  TOMORROW,
  describeError,
  formatAmount,
  formatEuros,
} from '../messages.js';

const logger = createLogger({ name: 'widget' });

/** Key of the manifest widget. Never renamed: dashboards store it. */
export const FAMILY_WIDGET = 'family';

/** The widget actions, relayed back by key. Never renamed. */
export const WIDGET_ACTIONS = { REFRESH: 'refresh' };

/** The status list holds 10 rows: two per child. */
const MAX_CHILDREN = 5;

/** The card list holds 8 rows. */
const MAX_CARDS = 8;

/** Unread messages listed: the last ones only, the list stays readable. */
export const MAX_MESSAGES = 3;

/** Texts of the vocabulary are capped by the core; cut them ourselves, cleanly. */
const LIMITS = { statusLabel: 40, statusValue: 40, cardTitle: 60, caption: 80 };

/**
 * The content of the `family` widget.
 *
 * @param {object} state
 * @param {object} state.config normalized configuration
 * @param {object|null} state.snapshot last read of the portal
 * @param {object|null} state.error the error of the last read, if it failed
 * @param {string} [state.language] the reader's language
 */
export function buildWidgetContent({ config, snapshot, error, language = 'en' }) {
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

  // Written here rather than bound to the balance feature: a bound tile
  // shows the raw state (64.8), an amount reads with its cents (64,80), never
  // rounded. The widget is nudged after every read, so it follows the balance
  // all the same.
  const components = [
    {
      type: 'value',
      label: say({ en: 'To pay', fr: 'À payer', de: 'Zu zahlen', es: 'A pagar' }),
      icon: 'credit-card',
      value: formatAmount(balanceOf(snapshot), language),
      unit: '€',
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

/**
 * The invoices to pay first, then the ones sent to the Trésor public (in
 * grey: not counted in what is owed), then the unread messages.
 */
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
  for (const invoice of treasuryInvoices(snapshot)) {
    cards.push({
      title: cut(invoice.label, LIMITS.cardTitle),
      subtitle: formatEuros(invoice.remaining, language),
      ...(invoice.dueOn ? { date: invoice.dueOn } : {}),
      badge: { text: pick(language, TREASURY_BADGE), color: WIDGET_COLORS.NEUTRAL },
      description: pick(language, TREASURY_NOTE),
    });
  }
  for (const message of unreadMessages(snapshot).slice(0, MAX_MESSAGES)) {
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

const TREASURY_BADGE = { en: 'Treasury', fr: 'Trésor public', de: 'Staatskasse', es: 'Tesoro' };

const TREASURY_NOTE = {
  en: 'Sent to the Trésor public: the portal no longer follows its payment and will keep showing it unpaid. It is not counted in the balance. Paid to the Trésor? Nothing more to do.',
  fr: "Transmise au Trésor public : le portail ne suit plus son paiement et la montrera toujours impayée. Elle n'est pas comptée dans le reste à payer. Payée au Trésor ? Il n'y a rien d'autre à faire.",
  de: 'An den Trésor public übergeben: Das Portal verfolgt die Zahlung nicht mehr und zeigt sie weiter als unbezahlt. Sie zählt nicht zum offenen Betrag. Beim Trésor bezahlt? Dann ist nichts mehr zu tun.',
  es: 'Transmitida al Trésor public: el portal ya no sigue su pago y la seguirá mostrando impagada. No se cuenta en el saldo pendiente. ¿Pagada al Trésor? No hay nada más que hacer.',
};

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

    async action(actionKey) {
      logger.info(`Widget action ${actionKey}`);
      if (actionKey !== WIDGET_ACTIONS.REFRESH) {
        throw new Error(`Unknown widget action: ${actionKey}`);
      }
      const result = await getService().sync({ force: true });
      await onSynced(result);
      if (result.error) {
        throw new Error(describeError(result.error).en);
      }
      return { en: 'Portal read', fr: 'Portail lu', de: 'Portal gelesen', es: 'Portal leído' };
    },
  };
}

function cut(text, length) {
  const value = String(text ?? '');
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}
