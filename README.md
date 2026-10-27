# Agora Famille — Gladys Assistant integration

External integration connecting [Gladys Assistant](https://gladysassistant.com)
to the **Agora Famille** family portal (published by Agora Plus) that many
French municipalities use for the school canteen, before/after-school care,
holiday clubs, invoices and messages to families.

Built on the official
[JavaScript integration template](https://github.com/GladysAssistant/integration-template-js)
and the SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).
Requires **Gladys 5.3.0 or later**. Transport: **cloud** (the portal is a web
service). Country: **France**.

User documentation: [Français](./docs/fr.md) · [English](./docs/en.md) ·
[Deutsch](./docs/de.md) · [Español](./docs/es.md).

## What it does

| Device                  | Gladys features                                                            |
| ----------------------- | -------------------------------------------------------------------------- |
| Agora Famille (account) | Balance due (€), next invoice (text), last message (text)                  |
| One device per child    | Today / tomorrow bookings (text), canteen today / tomorrow (read-only 0/1) |

On top of the devices (`src/capabilities/`):

| Capability                  | Keys                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------- |
| Scene triggers              | `invoice_issued`, `invoice_due_soon`, `message_received`, `reservation_changed`     |
| Scene actions (read-only)   | `refresh`, `check_day`                                                              |
| Dashboard widget            | `family`: balance, children today/tomorrow, invoices to pay, last 3 unread messages |
| Configuration screen action | `test_connection`                                                                   |

Every user-facing text is in English, French, German and Spanish.

> **No official API.** Agora Plus publishes no API for its family portal: the
> integration makes the requests of the portal's own pages, gathered in
> [`src/agora/endpoints.js`](./src/agora/endpoints.js), and reads the answers
> tolerantly ([`src/agora/parse.js`](./src/agora/parse.js)). Check them
> against a real account (browser developer tools, Network tab) before a
> first release, and after a portal update.

## Project structure

```
.
├─ index.js                          # SDK bootstrap only
├─ src/
│  ├─ app.js                         # every handler, the refresh timer, what a read publishes
│  ├─ config.js                      # defaults, portal address parsing, account id
│  ├─ i18n.js                        # en / fr / de / es helpers
│  ├─ logging.js                     # "Detailed logs" switch
│  ├─ messages.js                    # shared user-facing texts
│  ├─ agora/
│  │  ├─ endpoints.js                # the portal requests (one place to adjust)
│  │  ├─ client.js                   # HTTP session: login, cookie, re-login, errors
│  │  ├─ parse.js                    # tolerant readers: children, planning, invoices, messages
│  │  ├─ dates.js                    # calendar days in Europe/Paris
│  │  ├─ snapshot.js                 # one read of the portal + the events between two reads
│  │  ├─ service.js                  # one account kept in sync (single-flight reads)
│  │  └─ store.js                    # last read kept in /data across restarts
│  ├─ devices/index.js               # account + child devices, states, transport badges
│  └─ capabilities/
│     ├─ scenes.js                   # scene triggers and actions
│     └─ widget.js                   # dashboard widget
├─ docs/{en,fr,de,es}.md             # user documentation (re-hosted by Gladys)
├─ test/                             # node --test, fake portal + fake Gladys of the SDK
├─ gladys-assistant-integration.json # manifest
├─ Dockerfile                        # Node 24 Alpine, read-only rootfs ready
├─ CHANGELOG.md · CLAUDE.md · SECURITY.md
└─ .github/                          # CI, release, build, GitHub releases, Dependabot
```

## Development

```bash
npm install
npm test               # node --test (no network: fake portal + fake Gladys)
npm run lint           # ESLint
npm run format:check   # Prettier, as the CI runs it
npm run format         # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run it against a Gladys instance:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="agora-famille" \
AGORA_DATA_DIR=./data \
LOG_LEVEL=debug \
npm start
```

## CI and releases

Same workflows as [prohand/gladys-devmel](https://github.com/prohand/gladys-devmel):

- **CI** (`ci.yml`) — Prettier, ESLint and tests on Node 22 and 24 for every
  push to `main` and every pull request; pull requests also run the store
  admission checks and build the Docker image.
- **Release** (`release.yml`) — Actions → Release → Run workflow → `patch`,
  `minor` or `major`: bumps `package.json` and the manifest (`version`,
  `docker_image`), moves `## [Unreleased]` of the changelog under the new
  version, tags, builds the `linux/amd64` + `linux/arm64` image to `ghcr.io`,
  publishes the GitHub Release and runs the full store checks.
- **Build** (`build.yml`) — multi-arch image, from a tag, a manual run or the
  Release workflow.
- **GitHub releases** (`github-release.yml`) — a Release for every `vX.Y.Z`
  tag, with its changelog section as notes.
- **Dependabot** — weekly npm, monthly GitHub Actions and Docker base image.

To publish: add the GitHub topic `gladys-assistant-integration`, describe the
changes under `## [Unreleased]` in [`CHANGELOG.md`](./CHANGELOG.md), then run
the Release workflow. Turn on **Private vulnerability reporting** in the
repository settings: [`SECURITY.md`](./SECURITY.md) sends reporters there.

## License

Apache-2.0
