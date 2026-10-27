# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

Describe each change under `## [Unreleased]` as you make it. The Release workflow moves that
section under the version it ships, and the section becomes the notes of the version's GitHub
Release.

## [Unreleased]

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
- An **Agora Famille** account device (balance due, next invoice, last message) and one device
  per child (today's and tomorrow's bookings, canteen today and tomorrow).
- Scene triggers: a new invoice, an invoice due soon, a message received, a booking that
  changes state (filterable by child and state).
- Scene actions: read the portal, check a child's day, declare an absence, book a day.
- **Agora Famille** dashboard widget: balance, children today and tomorrow, invoices to pay,
  unread messages, absence and lunch forms, link to the portal.
- "Test the connection" action naming the step that fails.
- A request the portal refuses logs its address, its HTTP status and the start of the answer
  (login and password masked), to adapt the portal requests.
- Cloud transport badge on every device, unreachable while the portal cannot be read.
- English, French, German and Spanish texts and documentation.
- `SECURITY.md`, `CHANGELOG.md` and `CLAUDE.md`.
- CI (Prettier, ESLint, tests on Node 22 and 24, store checks, Docker build), UI-driven
  Release, multi-arch build, GitHub Releases and Dependabot.

[Unreleased]: https://github.com/prohand/gladys-agorafamille/commits/main
