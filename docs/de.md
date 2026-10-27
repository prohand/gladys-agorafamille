# Agora Famille

Diese Integration verbindet Gladys mit dem **Familienportal Agora Famille**
(von Agora Plus) deiner französischen Gemeinde: Schulkantine, Vor- und
Nachmittagsbetreuung, Ferienfreizeiten, Rechnungen und Nachrichten des
Rathauses.

Sie liest das Portal so, wie es dein Browser tut, mit deinem eigenen Konto,
und bietet dir in Gladys:

- ein Gerät **pro Kind**: was heute und morgen gebucht ist und ob es in der
  Kantine isst;
- ein Gerät **Familienkonto**: der offene Betrag, die nächste Rechnung, die
  letzte Nachricht;
- **Szenen-Auslöser** (neue Rechnung, Rechnung bald fällig, neue Nachricht,
  Buchung angenommen oder abgelehnt);
- lesende **Szenen-Aktionen** (einen Tag prüfen, das Portal erneut lesen);
- ein **Dashboard-Widget**.

## Bevor du beginnst

- Es wird **Gladys 5.3 oder neuer** benötigt.
- Du brauchst ein **aktives** Konto beim Agora-Famille-Portal deiner
  Gemeinde: die E-Mail-Adresse und das Passwort, mit denen du dich anmeldest.
- Die Integration ist eine **Cloud**-Integration: Sie braucht Internet, um
  das Portal zu erreichen.

## Konfiguration

In Gladys: **Integrationen → Agora Famille → Konfiguration**.

| Feld                               | Was einzutragen ist                                                                                                                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Portaladresse**                  | Die Adresse deines Portals, wie dein Browser sie anzeigt, z. B. `https://portalssl.agoraplus.fr/meinestadt/pck_home.home_view#/`. Nur der Name der Gemeinde (`meinestadt`) genügt auch. |
| **Benutzername (E-Mail)**          | Die E-Mail deines Familienkontos.                                                                                                                                                       |
| **Passwort**                       | Das Passwort des Portals. Gladys speichert es als Geheimnis, es erscheint nie in den Protokollen.                                                                                       |
| **Aktualisierungsintervall (min)** | Wie oft das Portal gelesen wird (standardmäßig 60 min, mindestens 15 min).                                                                                                              |
| **Beobachtete Planungstage**       | Wie viele Tage im Voraus gelesen und überwacht werden (standardmäßig 14).                                                                                                               |
| **Rechnungserinnerung (Tage)**     | Der Auslöser „Rechnung bald fällig“ wird so viele Tage vor dem Fälligkeitsdatum ausgelöst (standardmäßig 3, 0 schaltet ihn ab).                                                         |
| **Ausführliche Protokolle**        | Protokolliert jede Anfrage an das Portal, zur Fehlersuche. Nie das Passwort.                                                                                                            |

Klicke dann auf **Verbindung testen**: Die Antwort nennt deine Kinder, die
Zahl der gelesenen Planungstage, die offenen Rechnungen und die ungelesenen
Nachrichten. Bei einem Fehler nennt sie den fehlgeschlagenen Schritt
(Anmeldung, Kinder, Planung, Rechnungen, Nachrichten).

Öffne anschließend den Reiter **Entdecken**, um die Geräte anzulegen.

## Geräte

### Agora Famille (das Konto)

| Funktion         | Inhalt                                                       |
| ---------------- | ------------------------------------------------------------ |
| **Balance due**  | Der offene Betrag in Euro (alle unbezahlten Rechnungen).     |
| **Next invoice** | Die nächste zu zahlende Rechnung: Betrag, Fälligkeit, Titel. |
| **Last message** | Der Betreff der letzten Nachricht der Gemeinde.              |

### Ein Gerät pro Kind

| Funktion             | Inhalt                                                         |
| -------------------- | -------------------------------------------------------------- |
| **Today**            | Die heute gebuchten Aktivitäten („Cantine, Garderie du soir“). |
| **Tomorrow**         | Die morgen gebuchten Aktivitäten.                              |
| **Canteen today**    | 1, wenn das Kind heute in der Kantine isst, sonst 0.           |
| **Canteen tomorrow** | 1, wenn das Kind morgen in der Kantine isst, sonst 0.          |

Ein **angefragter**, von der Gemeinde noch nicht bestätigter Tag zählt als
gebucht. Die Texte sind auf Französisch, wie die Aktivitäten des Portals.

Das Essen wird an seinem Namen erkannt: „cantine“, „repas“, „restauration“,
„déjeuner“, „pause méridienne“… Jede Gemeinde benennt ihre Aktivitäten auf
ihre Weise.

Das **Cloud**-Abzeichen jedes Geräts wechselt auf **nicht erreichbar**,
solange das Portal nicht gelesen werden kann.

## Szenen (Gladys 5.1+)

### Auslöser

| Auslöser                                | Wann                                                                                                                         | Variablen                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Eine neue Rechnung wird ausgestellt** | Eine unbezahlte Rechnung erscheint.                                                                                          | `label`, `amount`, `due_date`, `invoice_id`                           |
| **Eine Rechnung wird bald fällig**      | Eine unbezahlte Rechnung wird innerhalb der eingestellten Tage fällig. Nur einmal.                                           | `label`, `amount`, `due_date`, `days_left`, `invoice_id`              |
| **Eine Nachricht wird empfangen**       | Die Gemeinde hat eine Nachricht gesendet.                                                                                    | `subject`, `sender`, `date`                                           |
| **Eine Buchung ändert sich**            | Ein gebuchter oder angefragter Tag ändert seinen Status (angenommen, abgelehnt, storniert…). Nach Kind und Status filterbar. | `child_name`, `activity`, `date`, `status`, `previous_status`, `meal` |

Die Variablen lassen sich in den folgenden Aktionen verwenden, z. B.
`{{triggerEvent.data.amount}}`.

Das allererste Lesen des Portals löst nichts aus: Alles würde neu wirken. Ab
dann werden Änderungen gezählt, auch über Neustarts hinweg (die Integration
behält das letzte Lesen in `/data`).

### Aktionen

| Aktion                      | Was sie tut                                                            | Ausgaben                                                   |
| --------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Familienportal lesen**    | Liest das Portal sofort.                                               | `success`, `balance`, `unpaid_invoices`, `unread_messages` |
| **Tag eines Kindes prüfen** | Ob das Kind an dem Tag gebucht ist (0 = heute, 1 = morgen…) und wofür. | `has_meal`, `booked_count`, `activities`, `date`           |

Die Integration **liest** das Portal nur: Sie bucht und storniert nie etwas.
Buchungen und Abwesenheiten werden im Portal erledigt.

### Beispiele

- **Jeden Abend um 19 Uhr**: _Tag eines Kindes prüfen_ für morgen, dann, wenn
  `has_meal` falsch ist, „Morgen keine Kantine für Léa“ senden.
- **Eine Rechnung wird bald fällig** → „Rechnung über
  {{triggerEvent.data.amount}} € bis {{triggerEvent.data.due_date}} zahlen“
  senden.
- **Eine Buchung ändert sich**, gefiltert auf _Abgelehnt_ → Benachrichtigung.

## Das Widget

Das Dashboard-Widget **Agora Famille** zeigt:

- den offenen Betrag (live);
- für jedes Kind (höchstens 5), was heute und morgen gebucht ist (grün:
  gebucht, orange: Anfrage offen, rot: abgelehnt);
- die offenen Rechnungen und die letzten 3 ungelesenen Nachrichten;
- die Uhrzeit des letzten Lesens oder den aktuellen Fehler.

Und zwei Tasten: **Aktualisieren** und **Portal öffnen**. Abwesenheiten und
Buchungen werden im Portal erledigt.

## Fehlerbehebung

- **„Das Portal hat Benutzername oder Passwort abgelehnt“**: Prüfe sie, indem
  du dich im Browser beim Portal anmeldest. Ein Konto, das noch auf die
  Freigabe durch das Rathaus wartet, kann sich noch nicht anmelden.
- **„Das Portal antwortet nicht“**: Das Portal wird vielleicht gewartet; die
  Integration versucht es in jedem Intervall erneut.
- **„Das Portal hat etwas Unerwartetes geantwortet“**: Aktiviere
  **Ausführliche Protokolle**, klicke auf **Verbindung testen** und lies die
  Protokolle der Integration (Integrationen → Agora Famille → Überwachung).

### Wichtig: keine offizielle API

Agora Plus veröffentlicht keine API für sein Familienportal. Die Integration
stellt dieselben Anfragen wie die Seiten des Portals; sie sind in einer
einzigen Datei gesammelt,
[`src/agora/endpoints.js`](../src/agora/endpoints.js). Ein Update des Portals
oder eine anders eingerichtete Gemeinde kann Anpassungen erfordern: Eröffne
dann ein [Issue](https://github.com/prohand/gladys-agorafamille/issues) mit
dem fehlgeschlagenen Schritt und dem HTTP-Status (nie dein Passwort).

## Datenschutz

- Die Zugangsdaten dienen nur zur Anmeldung beim Portal deiner Gemeinde, über
  HTTPS.
- Das Passwort und die Sitzungs-Cookies werden nie in die Protokolle
  geschrieben.
- Das letzte Lesen des Portals (Planung, Rechnungen, Nachrichten) wird im
  privaten Volume `/data` der Integration gespeichert, um Änderungen nach
  einem Neustart zu erkennen. Nichts wird anderswohin gesendet.
