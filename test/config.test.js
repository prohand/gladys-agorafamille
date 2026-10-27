import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parsePortalUrl } from '../src/config.js';

test('the portal address is read whatever shape it was pasted in', () => {
  const expected = {
    url: 'https://portalssl.agoraplus.fr/lognes',
    base: 'https://portalssl.agoraplus.fr/lognes',
    apiBase: 'https://lognes.agoraplus.fr',
    commune: 'lognes',
  };
  for (const pasted of [
    'lognes',
    'Lognes',
    'portalssl.agoraplus.fr/lognes',
    'https://portalssl.agoraplus.fr/lognes',
    'https://portalssl.agoraplus.fr/lognes/',
    'https://portalssl.agoraplus.fr/lognes/pck_home.home_view#/',
    'http://portalssl.agoraplus.fr/lognes/pck_home.home_view',
    'https://lognes.agoraplus.fr/InternalApi/API_DASHBOARD/authentication',
    'lognes.agoraplus.fr',
    '  https://portalssl.agoraplus.fr/lognes?x=1  ',
  ]) {
    assert.deepEqual(parsePortalUrl(pasted), expected, pasted);
  }
});

test('a municipality behind its own host keeps it', () => {
  assert.deepEqual(parsePortalUrl('https://famille.ma-ville.fr/agora/pck_home.home_view#/'), {
    url: 'https://famille.ma-ville.fr/agora',
    base: 'https://famille.ma-ville.fr/agora',
    apiBase: 'https://famille.ma-ville.fr',
    commune: 'agora',
  });
});

test('nothing usable is no portal', () => {
  for (const pasted of [
    '',
    '   ',
    null,
    undefined,
    'https://portalssl.agoraplus.fr/',
    'ftp://x/y',
  ]) {
    assert.equal(parsePortalUrl(pasted), null, String(pasted));
  }
});

test('defaults apply and numbers are kept in range', () => {
  const config = normalizeConfig({});
  assert.equal(config.refresh_minutes, DEFAULT_CONFIG.refresh_minutes);
  assert.equal(config.days_ahead, DEFAULT_CONFIG.days_ahead);
  assert.equal(config.configured, false);
  assert.equal(config.accountId, null);

  const clamped = normalizeConfig({ refresh_minutes: '5', days_ahead: 500, due_reminder_days: '' });
  assert.equal(clamped.refresh_minutes, 15);
  assert.equal(clamped.days_ahead, 60);
  assert.equal(clamped.due_reminder_days, DEFAULT_CONFIG.due_reminder_days);
});

test('the account id never carries the e-mail address', () => {
  const config = normalizeConfig({
    portal_url: 'lognes',
    username: ' Parent@Example.com ',
    password: 'x',
  });
  assert.equal(config.configured, true);
  assert.match(config.accountId, /^lognes-[0-9a-f]{12}$/);
  assert.ok(!config.accountId.includes('example'));
  // Same login, other case: same account (same devices).
  assert.equal(
    normalizeConfig({ portal_url: 'lognes', username: 'parent@example.com', password: 'y' })
      .accountId,
    config.accountId,
  );
});
