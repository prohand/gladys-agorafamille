# Agora Famille

This integration connects Gladys to the **Agora Famille family portal**
(published by Agora Plus) of your French municipality: school canteen,
before/after-school care, holiday clubs, invoices and messages from the town
hall.

It reads the portal the way your browser does, with your own account, and
gives you in Gladys:

- one device **per child**: what is booked today and tomorrow, and whether
  they eat at the canteen;
- one **family account** device: the balance due, the next invoice, the last
  message;
- **scene triggers** (new invoice, invoice due soon, new message, booking
  accepted or refused);
- **scene actions** (declare an absence, book a lunch, check a day, read the
  portal again);
- a dashboard **widget**.

## Before you start

- **Gladys 5.3 or later** is required.
- You need an **active** account on your municipality's Agora Famille
  portal: the e-mail address and password you sign in with.
- The integration is a **cloud** one: it needs internet access to reach the
  portal.

## Configuration

In Gladys: **Integrations → Agora Famille → Configuration**.

| Field                        | What to enter                                                                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Portal address**           | The address of your portal as your browser shows it, e.g. `https://portalssl.agoraplus.fr/mycity/pck_home.home_view#/`. The name of the municipality alone (`mycity`) works too. |
| **Login (e-mail)**           | The e-mail of your family account.                                                                                                                                               |
| **Password**                 | The portal password. Gladys stores it as a secret, and it never appears in the logs.                                                                                             |
| **Refresh interval (min)**   | How often the portal is read (60 min by default, 15 min minimum). There is no point going faster: the portal changes little in a day.                                            |
| **Days of planning watched** | How many days ahead are read and watched (14 by default).                                                                                                                        |
| **Invoice reminder (days)**  | The "invoice due soon" trigger fires this many days before the due date (3 by default, 0 turns it off).                                                                          |
| **Detailed logs**            | Logs every request to the portal, for troubleshooting. Never the password.                                                                                                       |

Then click **Test the connection**: the answer lists your children, the
number of planned days read, the invoices to pay and the unread messages. On
failure, it says which step failed (sign-in, children, planning, invoices,
messages).

Then open the **Discover** tab to create the devices.

## Devices

### Agora Famille (the account)

| Feature          | Content                                                |
| ---------------- | ------------------------------------------------------ |
| **Balance due**  | What is left to pay, in euros (all unpaid invoices).   |
| **Next invoice** | The next invoice to pay: amount, due date, label.      |
| **Last message** | The subject of the last message from the municipality. |

### One device per child

| Feature              | Content                                                     |
| -------------------- | ----------------------------------------------------------- |
| **Today**            | The activities booked today ("Cantine, Garderie du soir").  |
| **Tomorrow**         | The activities booked tomorrow.                             |
| **Canteen today**    | 1 when the child eats at the canteen today, 0 otherwise.    |
| **Canteen tomorrow** | 1 when the child eats at the canteen tomorrow, 0 otherwise. |

A day **requested** and not yet approved by the municipality counts as
booked. The texts are in French, like the activities of the portal.

The meal is recognised by its name: "cantine", "repas", "restauration",
"déjeuner", "pause méridienne"… Each municipality names its activities its
own way.

The **cloud** badge of every device turns **unreachable** while the portal
cannot be read.

## Scenes (Gladys 5.1+)

### Triggers

| Trigger                     | When                                                                                                            | Variables                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **A new invoice is issued** | An unpaid invoice appears.                                                                                      | `label`, `amount`, `due_date`, `invoice_id`                           |
| **An invoice is due soon**  | An unpaid invoice reaches its due date within the configured days. Once.                                        | `label`, `amount`, `due_date`, `days_left`, `invoice_id`              |
| **A message is received**   | The municipality sent a message.                                                                                | `subject`, `sender`, `date`                                           |
| **A booking changes**       | A booked or requested day changed state (accepted, refused, cancelled…). Can be filtered by child and by state. | `child_name`, `activity`, `date`, `status`, `previous_status`, `meal` |

Use the variables in the following actions, e.g.
`{{triggerEvent.data.amount}}`.

The very first read of the portal fires nothing: everything would look new.
Changes are counted from there on, across restarts too (the integration keeps
the last read in `/data`).

### Actions

| Action                        | What it does                                                                               | Outputs                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| **Read the family portal**    | Reads the portal right now.                                                                | `success`, `balance`, `unpaid_invoices`, `unread_messages` |
| **Check a child's day**       | Whether the child is booked that day (0 = today, 1 = tomorrow…) and for what.              | `has_meal`, `booked_count`, `activities`, `date`           |
| **Declare a child's absence** | Asks to cancel the booked activities of a day. Empty activity = all; "canteen" = the meal. | `requested_count`, `activities`, `date`                    |
| **Book a day for a child**    | Asks for a day of an activity the child is registered to (the canteen by default).         | `requested`, `already_booked`, `activity`, `date`          |

Requests go through the portal: the municipality approves them, within its
own deadlines. The "a booking changes" trigger tells you its answer.

### Examples

- **Every evening at 7 p.m.**: _Check a child's day_ for tomorrow, then, when
  `has_meal` is false, send "No canteen for Léa tomorrow".
- **An invoice is due soon** → send "Invoice of {{triggerEvent.data.amount}} €
  to pay before {{triggerEvent.data.due_date}}".
- **A booking changes**, filtered on _Refused_ → notification.
- A "Sick child" button → _Declare a child's absence_ for today.

## The widget

The **Agora Famille** dashboard widget shows:

- the balance due (live);
- for each child (5 at most), what is booked today and tomorrow (green:
  booked, orange: request pending, red: refused);
- the invoices to pay and the unread messages;
- the time of the last read, or the current error.

And four buttons: **Refresh**, **Absence** and **Book a lunch** (a short form
asks for the child and the day), **Open portal**.

## Troubleshooting

- **"The portal refused the login or the password"**: check them by signing
  in to the portal in a browser. An account still waiting for the town hall's
  approval cannot sign in yet.
- **"The portal does not answer"**: the portal may be under maintenance; the
  integration tries again at every interval.
- **"The portal answered something unexpected"**: tick **Detailed logs**,
  click **Test the connection** and read the integration logs (Integrations →
  Agora Famille → Supervision).

### Important: no official API

Agora Plus publishes no API for its family portal. The integration makes the
same requests as the portal's own pages; they are gathered in a single file,
[`src/agora/endpoints.js`](../src/agora/endpoints.js). A portal update, or a
municipality configured differently, may require adjusting them: open an
[issue](https://github.com/prohand/gladys-agorafamille/issues) naming the
failing step and the HTTP status returned (never your password).

## Privacy

- The credentials are only used to sign in to your municipality's portal,
  over HTTPS.
- The password and the session cookies are never written to the logs.
- The last read of the portal (planning, invoices, messages) is kept in the
  integration's private `/data` volume, to detect changes after a restart.
  Nothing is sent anywhere else.
