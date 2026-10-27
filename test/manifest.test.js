// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG } from '../src/config.js';
import { SCENE_ACTIONS, SCENE_TRIGGERS, TRIGGER_STATUSES } from '../src/capabilities/scenes.js';
import { FAMILY_WIDGET } from '../src/capabilities/widget.js';
import { LANGUAGES } from '../src/i18n.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const appSource = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');

test('the version is the same everywhere, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/prohand/gladys-agorafamille:${pkg.version}`);
});

test('every manifest action is registered', () => {
  for (const action of manifest.actions ?? []) {
    assert.match(appSource, new RegExp(`onAction\\('${action.key}'`), action.key);
  }
});

test('the integration only reads: no scene action books or cancels', () => {
  assert.deepEqual(manifest.scene_actions.map((action) => action.key).sort(), [
    'check_day',
    'refresh',
  ]);
});

test('every scene action of the manifest has a handler, and the other way round', () => {
  assert.deepEqual(
    manifest.scene_actions.map((action) => action.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  for (const key of Object.keys(SCENE_ACTIONS)) {
    assert.match(appSource, new RegExp(`onSceneAction\\(\\s*SCENE_ACTIONS\\.${key}`), key);
  }
});

test('the scene triggers the code fires are the ones the manifest declares', () => {
  assert.deepEqual(
    manifest.scene_triggers.map((trigger) => trigger.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
  const statuses = manifest.scene_triggers
    .find((trigger) => trigger.key === SCENE_TRIGGERS.RESERVATION_CHANGED)
    .fields.find((field) => field.key === 'status')
    .options.map((option) => option.value);
  assert.deepEqual(statuses.sort(), [...TRIGGER_STATUSES].sort());
});

test('the widget of the manifest is the one the code serves', () => {
  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key),
    [FAMILY_WIDGET],
  );
  assert.match(appSource, /onWidgetGet\(FAMILY_WIDGET/);
  assert.match(appSource, /onWidgetAction\(FAMILY_WIDGET/);
});

// The store schema is the admission authority: a field type outside this list
// gets the integration rejected by the indexer.
const FIELD_TYPES = ['string', 'number', 'boolean', 'select', 'multi_select', 'secret', 'section'];

test('every field uses a type the store accepts', () => {
  const allFields = [
    ...manifest.config_schema,
    ...(manifest.actions ?? []).flatMap((a) => a.fields ?? []),
    ...(manifest.widgets ?? []).flatMap((w) => w.settings ?? []),
    ...(manifest.scene_triggers ?? []).flatMap((t) => t.fields ?? []),
    ...(manifest.scene_actions ?? []).flatMap((a) => a.fields ?? []),
  ];
  for (const field of allFields) {
    assert.ok(FIELD_TYPES.includes(field.type), `field "${field.key}": type "${field.type}"`);
    assert.match(field.key, /^[a-z0-9_]+$/, `field key "${field.key}" must be snake_case`);
    if (field.placeholder !== undefined) {
      assert.ok(
        ['string', 'number', 'secret'].includes(field.type),
        `field "${field.key}": a ${field.type} field cannot have a placeholder`,
      );
    }
    if (field.min !== undefined || field.max !== undefined) {
      assert.equal(field.type, 'number', `field "${field.key}": min/max are number-only`);
    }
    if (field.source !== undefined) {
      assert.equal(field.source, 'devices');
      assert.equal(field.options, undefined, `field "${field.key}": source and options`);
    }
  }
  // Scene trigger filters: no secret, no boolean (the store refuses them).
  for (const field of manifest.scene_triggers.flatMap((t) => t.fields ?? [])) {
    assert.ok(['string', 'number', 'select', 'multi_select', 'section'].includes(field.type));
  }
});

test('the password is a secret field, never a plain one', () => {
  const field = manifest.config_schema.find((entry) => entry.key === 'password');
  assert.equal(field.type, 'secret');
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      assert.ok(!(field.key in DEFAULT_CONFIG), `section "${field.key}" stores no value`);
      assert.equal(field.default, undefined);
      continue;
    }
    assert.ok(field.key in DEFAULT_CONFIG, `config key "${field.key}" missing in DEFAULT_CONFIG`);
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `default of "${field.key}"`);
    }
  }
});

const CATEGORIES = [
  'climate',
  'lighting',
  'energy',
  'security',
  'multimedia',
  'appliances',
  'environment',
  'protocols',
  'network',
  'notifications',
  'assistants',
  'services',
  'transport',
  'vehicles',
  'servers',
  'leisure',
];

test('categories, keywords and countries follow the store rules', () => {
  const { categories, keywords, countries } = manifest;
  assert.ok(categories.length >= 1 && categories.length <= 3);
  for (const category of categories) {
    assert.ok(CATEGORIES.includes(category), `unknown category "${category}"`);
  }
  assert.ok(keywords.length >= 1 && keywords.length <= 10);
  const normalized = keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.equal(new Set(normalized).size, keywords.length, 'keywords must be unique');
  for (const keyword of normalized) {
    assert.ok(keyword.length >= 2 && keyword.length <= 30, `keyword "${keyword}"`);
  }
  // Agora Famille serves French municipalities only.
  assert.deepEqual(countries, ['FR']);
});

test('the Gladys floor covers every field the manifest declares', () => {
  // keywords/countries need 5.3.0; scenes and widgets 5.1.0; widget forms 5.2.
  assert.equal(manifest.gladys_version, '>=5.3.0');
});

test('the portal is a cloud service: the transport says so', () => {
  assert.deepEqual(manifest.transports, ['cloud']);
});

/** Every multi-language object of the manifest, with where it sits. */
function multiLanguageTexts(node, path = 'manifest') {
  if (Array.isArray(node)) {
    return node.flatMap((child, index) => multiLanguageTexts(child, `${path}[${index}]`));
  }
  if (node === null || typeof node !== 'object') {
    return [];
  }
  const keys = Object.keys(node);
  if (keys.includes('en') && keys.every((key) => /^[a-z]{2}$/.test(key))) {
    return [{ path, text: node }];
  }
  return keys.flatMap((key) => multiLanguageTexts(node[key], `${path}.${key}`));
}

test('every multi-language text of the manifest carries en, fr, de and es', () => {
  const texts = multiLanguageTexts(manifest);
  assert.ok(texts.length > 60, `only ${texts.length} texts found`);
  for (const { path, text } of texts) {
    assert.deepEqual(Object.keys(text).sort(), [...LANGUAGES].sort(), `${path}: languages`);
    for (const language of LANGUAGES) {
      assert.ok(text[language].trim().length > 0, `${path}.${language} is empty`);
    }
  }
});

test('the per-language length limits of the store hold in every language', () => {
  const within = (text, min, max, where) => {
    for (const language of LANGUAGES) {
      const { length } = text[language];
      assert.ok(length >= min && length <= max, `${where}.${language}: ${length} characters`);
    }
  };
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  within(manifest.description, 10, 100, 'description');
  for (const widget of manifest.widgets) {
    within(widget.label, 3, 30, `widget ${widget.key} label`);
    within(widget.description, 1, 100, `widget ${widget.key} description`);
  }
});

test('the user documentation exists in every language', async () => {
  for (const language of LANGUAGES) {
    const text = await readFile(new URL(`../docs/${language}.md`, import.meta.url), 'utf8');
    assert.ok(text.length > 1000, `docs/${language}.md is too short`);
  }
});
