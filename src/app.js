// -----------------------------------------------------------------------------
// The integration, wired to the SDK: every handler, the refresh timer, and what
// is published after each read of the portal.
//
// Kept apart from index.js (which only creates the SDK instance and connects)
// so the tests drive the whole integration against the fake Gladys of the SDK
// and a fake portal, without a network.
// -----------------------------------------------------------------------------

import { normalizeConfig } from './config.js';
import { applyLogLevel, createLogger } from './logging.js';
import { createAgoraService } from './agora/service.js';
import { createStore } from './agora/store.js';
import { balanceOf, unpaidInvoices, unreadMessages } from './agora/snapshot.js';
import { STATE_HEARTBEAT_MS, buildDevices, buildStates, buildTransports } from './devices/index.js';
import { SCENE_ACTIONS, createSceneActions, publishEvents } from './capabilities/scenes.js';
import { FAMILY_WIDGET, createWidget } from './capabilities/widget.js';
import { describeError, formatEuros } from './messages.js';
import { localize, pick } from './i18n.js';

const logger = createLogger({ name: 'app' });

/**
 * Register every handler on a Gladys SDK instance.
 *
 * @param {object} gladys a `GladysIntegration` (or the fake of the SDK)
 * @param {object} [deps]
 * @param {typeof fetch} [deps.fetch] the portal transport
 * @param {object} [deps.store] see src/agora/store.js
 * @param {() => Date} [deps.now]
 */
export function createApp(gladys, { fetch, store = createStore(), now } = {}) {
  let config = normalizeConfig();
  let service = createAgoraService({ config, store, fetch, now });
  let generation = 0;
  let timer = null;
  let publishedDevices = null;

  const getConfig = () => config;
  const getService = () => service;

  /** Everything a read changes in Gladys. Never throws: the next read retries. */
  async function onSynced({ snapshot, events = [], error }, owner = service) {
    if (owner !== service) {
      return; // a read of a configuration replaced meanwhile
    }
    try {
      await publishDevices(snapshot);
      await gladys.publishChangedStates(buildStates(gladys, config, snapshot), {
        heartbeat: STATE_HEARTBEAT_MS,
      });
      const transports = buildTransports(gladys, config, snapshot, !error);
      if (transports.length > 0) {
        await gladys.publishTransports(transports);
      }
      await publishEvents(gladys, config, events);
      await gladys.setConnectionStatus(!error, error ? describeError(error) : undefined);
    } catch (err) {
      logger.error('Publishing the portal read to Gladys failed', err);
    }
    gladys.requestWidgetRefresh(FAMILY_WIDGET);
  }

  /** The device list, published again only when a child appears or leaves. */
  async function publishDevices(snapshot, { always = false } = {}) {
    const devices = buildDevices(gladys, config, snapshot);
    const signature = JSON.stringify(devices.map((device) => [device.external_id, device.name]));
    if (!always && signature === publishedDevices) {
      return;
    }
    await gladys.publishDiscoveredDevices(devices);
    publishedDevices = signature;
  }

  async function refresh(options) {
    const owner = service;
    const result = await owner.sync(options);
    await onSynced(result, owner);
    return result;
  }

  /** A new configuration: new account, new session, first read now. */
  async function configure(raw) {
    config = normalizeConfig(raw);
    applyLogLevel(config);
    generation += 1;
    const current = generation;
    service = createAgoraService({ config, store, fetch, now });
    publishedDevices = null;
    stopTimer();
    // The devices of the last read kept in /data come back at once, before
    // the portal answers (or while it is down).
    await service.load();
    if (current !== generation) {
      return;
    }
    await publishDevices(service.snapshot, { always: true });
    if (!config.configured) {
      await gladys.setConnectionStatus(false, describeError({ code: 'config' }));
      gladys.requestWidgetRefresh(FAMILY_WIDGET);
      return;
    }
    await refresh({ force: true });
    if (current === generation) {
      startTimer();
    }
  }

  function startTimer() {
    stopTimer();
    timer = setInterval(() => {
      refresh({ force: true }).catch((err) => logger.error('Scheduled read failed', err));
    }, config.refresh_minutes * 60_000);
    timer.unref?.();
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  // --- Discovery ---------------------------------------------------------------
  gladys.onScanRequest(async () => {
    await publishDevices(service.snapshot, { always: true });
  });

  // A device the user just created has no state yet (Gladys dropped the ones
  // sent before it existed, and the SDK forgot them): send them again.
  gladys.onDeviceCreated(async () => {
    await gladys.publishChangedStates(buildStates(gladys, config, service.snapshot), {
      heartbeat: STATE_HEARTBEAT_MS,
    });
  });

  // --- Configuration -----------------------------------------------------------
  gladys.onConfigUpdated(async (raw) => {
    logger.info('Configuration saved');
    await configure(raw);
  });

  gladys.onAction('test_connection', async () => {
    if (!config.configured) {
      return describeError({ code: 'config' });
    }
    const { snapshot, error } = await refresh({ force: true });
    if (error) {
      return describeError(error);
    }
    return describeSnapshot(snapshot);
  });

  // --- Scenes ------------------------------------------------------------------
  const sceneActions = createSceneActions({ gladys, getConfig, getService, onSynced });
  gladys.onSceneAction(SCENE_ACTIONS.REFRESH, sceneActions[SCENE_ACTIONS.REFRESH]);
  gladys.onSceneAction(SCENE_ACTIONS.CHECK_DAY, sceneActions[SCENE_ACTIONS.CHECK_DAY]);
  gladys.onSceneAction(SCENE_ACTIONS.DECLARE_ABSENCE, sceneActions[SCENE_ACTIONS.DECLARE_ABSENCE]);
  gladys.onSceneAction(
    SCENE_ACTIONS.REQUEST_RESERVATION,
    sceneActions[SCENE_ACTIONS.REQUEST_RESERVATION],
  );

  // --- Dashboard widget --------------------------------------------------------
  const widget = createWidget({ gladys, getConfig, getService, onSynced });
  gladys.onWidgetGet(FAMILY_WIDGET, (request) => widget.get(request));
  gladys.onWidgetAction(FAMILY_WIDGET, (actionKey, params, extra) =>
    widget.action(actionKey, params, extra),
  );

  // --- Lifecycle ---------------------------------------------------------------
  gladys.on('connected', async () => {
    try {
      await configure(await gladys.getConfig());
    } catch (err) {
      logger.error('Post-connection initialization failed', err);
      await gladys
        .setConnectionStatus(false, {
          en: 'Initialization failed, check the integration logs.',
          fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
          de: 'Die Initialisierung ist fehlgeschlagen, siehe die Protokolle der Integration.',
          es: 'La inicialización falló, consulte los registros de la integración.',
        })
        .catch(() => {});
    }
  });

  gladys.on('disconnected', () => {
    stopTimer();
  });

  return {
    stop: stopTimer,
    get config() {
      return config;
    },
    get service() {
      return service;
    },
  };
}

/** The answer of "Test the connection": what the portal says, in one paragraph. */
export function describeSnapshot(snapshot) {
  return localize((language) => {
    const names = snapshot.children.map((child) => child.name).join(', ');
    const parts = [
      pick(language, {
        en: 'Connected to the portal.',
        fr: 'Connecté au portail.',
        de: 'Mit dem Portal verbunden.',
        es: 'Conectado al portal.',
      }),
      pick(language, {
        en: `Children: ${names || 'none found'}.`,
        fr: `Enfants : ${names || 'aucun trouvé'}.`,
        de: `Kinder: ${names || 'keine gefunden'}.`,
        es: `Hijos: ${names || 'ninguno encontrado'}.`,
      }),
      pick(language, {
        en: `${snapshot.planning.length} planned day(s) watched.`,
        fr: `${snapshot.planning.length} jour(s) de planning suivis.`,
        de: `${snapshot.planning.length} geplante Tag(e) beobachtet.`,
        es: `${snapshot.planning.length} día(s) de planificación seguidos.`,
      }),
    ];
    if (snapshot.modules.invoices) {
      const unpaid = unpaidInvoices(snapshot).length;
      const balance = formatEuros(balanceOf(snapshot), language);
      parts.push(
        pick(language, {
          en: `${unpaid} invoice(s) to pay, ${balance} in all.`,
          fr: `${unpaid} facture(s) à payer, ${balance} au total.`,
          de: `${unpaid} offene Rechnung(en), insgesamt ${balance}.`,
          es: `${unpaid} factura(s) por pagar, ${balance} en total.`,
        }),
      );
    }
    if (snapshot.modules.messages) {
      const unread = unreadMessages(snapshot).length;
      parts.push(
        pick(language, {
          en: `${unread} unread message(s).`,
          fr: `${unread} message(s) non lu(s).`,
          de: `${unread} ungelesene Nachricht(en).`,
          es: `${unread} mensaje(s) sin leer.`,
        }),
      );
    }
    return parts.join(' ');
  });
}
