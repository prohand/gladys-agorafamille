# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and to human contributors when
working with code in this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one runtime
dependency: `@gladysassistant/integration-sdk`) for the **Agora Famille** family portal of
French municipalities (Agora Plus): school canteen, before/after-school care, holiday clubs,
invoices, messages. Requires Gladys 5.3+. Cloud transport, France only.

It signs in to the portal with the family's account and reads it on a timer: one account device
(balance, next invoice, last message), one device per child (today / tomorrow bookings, canteen
today / tomorrow), scene triggers (`invoice_issued`, `invoice_due_soon`, `message_received`,
`reservation_changed`), scene actions (`refresh`, `check_day`, `declare_absence`,
`request_reservation`) and a `family` dashboard widget.

## Commands

```bash
npm install
npm test                                  # node --test (built-in runner)
node --test test/snapshot.test.js         # one file
node --test --test-name-pattern "absence" # tests whose name matches
npm run lint                              # eslint .
npm run format:check                      # prettier --check . (CI gate)
npm run format                            # prettier --write .
npx github:GladysAssistant/integration-store .   # store admission checks
```

CI runs `format:check`, `lint`, `test` on Node 22 and 24, the store checks and a Docker build on
pull requests. Run the three commands before pushing.

## Architecture

```
index.js                SDK bootstrap only (createApp + connect)
src/app.js              every handler, the refresh timer, what a read publishes
src/config.js           DEFAULT_CONFIG (mirrors the manifest defaults), portal URL parsing
src/agora/endpoints.js  THE portal requests — the one file to adjust to a portal change
src/agora/client.js     HTTP session (cookie), re-login on expiry, typed AgoraError
src/agora/parse.js      tolerant readers (many field spellings), reservation states
src/agora/snapshot.js   one read + diffSnapshots() → scene events
src/agora/service.js    one account in sync, single-flight reads, optional modules (404)
src/agora/store.js      last read in /data (AGORA_DATA_DIR) so restarts diff correctly
src/devices/index.js    account + child devices, states, transport badges
src/capabilities/       scenes.js (triggers + actions), widget.js
src/i18n.js, messages.js  { en, fr, de, es } texts
```

### Invariants worth knowing

- **No official API.** Every request lives in `src/agora/endpoints.js`; the readers in
  `parse.js` look a value up under several names and DROP an entry they cannot read rather
  than guess (a wrong guess books the wrong lunch). Add a spelling there, not a special case
  elsewhere.
- **The API is `https://<commune>.agoraplus.fr/InternalApi/…`**, not the portal pages host
  (`portalssl.agoraplus.fr/<commune>`): `config.apiBase` vs `config.portalBase`. Sign-in is
  `POST InternalApi/API_DASHBOARD/authentication` with JSON `{LOGIN, PASSWORD}` and headers
  `session_id: null`, `ref_year: null`, `a_access: agora` (captured from a real browser); the
  session id answered goes back in `session_id`. A 401/403 (or a login page / redirect on older
  portals) means "session expired": `client.js` signs in again once.
- **Data requests not captured yet have `path: null`**: the client signs in, then throws
  `UNMAPPED` naming the step. Never invent a path: capture it ("Copy as cURL" in the browser).
  Tests give them `InternalApi/TEST/<name>` through `useTestPaths()` (test/helpers/fakePortal.js).
- **Events are differences between two reads.** The first read of an account fires nothing; a
  day entering the watched window is not a change; the read that follows a request made by an
  action never fires events (no loops through scenes). The last read is persisted in `/data`.
- **Days are `YYYY-MM-DD` in Europe/Paris** (`src/agora/dates.js`), never UTC instants.
- **Invoices and messages are optional modules**: a 404 there means "not bought by the
  municipality", not a failure.
- **External ids are forever**: account = commune + SHA-256 of the login (never the e-mail in
  clear), child = the portal's child id. Manifest keys (config, actions, triggers, widget) too.
- **Secrets**: never log the password, the cookies, or the planning/invoice contents at info.
- **Polling** is the integration's own timer (`refresh_minutes`, ≥ 15): devices publish no
  `poll_frequency`. States go through `publishChangedStates` with a heartbeat.
- **Widget budget**: ≤ 8 components, 1 focal, 1 status (≤ 10 rows → 5 children), 4 buttons;
  form labels are multi-language objects. `test/app.test.js` and `test/widget.test.js` run
  `validateWidgetContent`.

## Rules

- **Versions belong to the Release workflow** (Actions → Release). Never edit `version` in
  `package.json` or the manifest, nor the `docker_image` tag, by hand. `test/manifest.test.js`
  checks they agree.
- **Changelog**: every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`). Never write a version
  heading: the Release workflow does.
- **Manifest**: every text is `{ en, fr, de, es }`; `test/manifest.test.js` ties it to the code
  (defaults, handlers, trigger keys, widget). Change both sides together.
- **User-facing text** is in the four languages; `docs/en.md`, `docs/fr.md`, `docs/de.md`,
  `docs/es.md` are kept in sync.
- **Style**: Prettier formats, ESLint catches mistakes. Comments explain why, in English. Tests
  never touch the network (`test/helpers/fakePortal.js`, `createFakeGladys` of the SDK).
- **The container rootfs is read-only**: write only under `/data`.
