# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

Describe each change under `## [Unreleased]` as you make it. The Release workflow moves that
section under the version it ships, and the section becomes the notes of the version's GitHub
Release.

## [Unreleased]

### Changed

- A new cover for the store.

## [2.0.0] - 2026-10-27

### Added

- Agora Famille integration for Gladys 5.3+, started from the official JavaScript template:
  sign-in to the API of the municipality's family portal (`<commune>.agoraplus.fr`), read on a
  timer (15 minutes minimum). The requests reading the children, the planning, the invoices and
  the messages are not captured yet: "Test the connection" checks the sign-in and names them.
- The planning answer of the API (`DATA.EVENTS`) is read: day, activity, child and whether the
  day is booked. Until the request listing the children is known, the children are the ones the
  planning names ("Enfant <id>").
- The planning is asked with the request of the portal (`API_CALENDAR_COMPONENT/events`), for
  the children found in the sign-in answer.
- The invoices are read with the request of the portal (`API_DASHBOARD/invoicesAgpGrid`):
  amount, amount paid, due date, state.
- The messages are read with the request of the portal (`API_DASHBOARD/emailLogs`): the last
  ten, with their subject, sender, date and whether they were read.
- Amounts are never rounded: shown with at least two decimals (64,80), to the last decimal the
  portal gives.
- Invoices and messages are asked as the portal's code asks them: a POST of the list query
  (order, page size, page, filter), not a GET.
- The children and their first names come from the menu of the sign-in answer (`kids/<id>`
  links), as the portal pages read them.
- An answer of the portal with a negative `TYPE_RESULT` (its way of saying an error, an expired
  session among them) is no longer read as an empty planning, which showed "nothing booked" for
  every child: the integration signs in again once, then reports the portal's error.
- The children are the targets of the reservation calendar (`API_CALENDAR_COMPONENT/target`),
  the sign-in menu remaining the fallback.
- An **Agora Famille** account device (balance due, next invoice, last message) and one device
  per child (today's and tomorrow's bookings, canteen today and tomorrow).
- Scene triggers: a new invoice, an invoice due soon, a message received, a booking that
  changes state (filterable by child and state).
- Read-only by design: the integration never books nor cancels anything on the portal. Scene
  actions: read the portal, check a child's day.
- **Agora Famille** dashboard widget: balance with at least two decimals and never rounded,
  children today and tomorrow,
  invoices to pay, the last 3 unread messages, a refresh button and a link to the portal.
- "Test the connection" action naming the step that fails, with the portal's own message.
- The sign-in follows the portal pages: the password, Base64-encoded, is first encrypted by the
  portal, and that is what the sign-in sends (sent as typed, the portal answered "Exception
  detected"): `API_DASHBOARD/encryptText`, then `authentication`, as read in the portal's code;
  the session id and school year come from `DATA.session`. A staff account
  (`USER_TYPE_ID` 1) is turned away, as the portal does.
- A successful sign-in is no longer taken for a refusal: the portal says how a request went in
  `TYPE_RESULT` only (positive: done), and its successful answer carries an empty `ERROR`.
- Requests are sent with a French `Accept-Language` and a `User-Agent` naming the integration.
- A request the portal refuses logs its address, its HTTP status and the start of the answer
  (login and password masked), to adapt the portal requests.
- Cloud transport badge on every device, unreachable while the portal cannot be read.
- English, French, German and Spanish texts and documentation.
- `SECURITY.md`, `CHANGELOG.md` and `CLAUDE.md`.
- CI (Prettier, ESLint, tests on Node 22 and 24, store checks, Docker build), UI-driven
  Release, multi-arch build, GitHub Releases and Dependabot.

[Unreleased]: https://github.com/prohand/gladys-agorafamille/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/prohand/gladys-agorafamille/releases/tag/v2.0.0
