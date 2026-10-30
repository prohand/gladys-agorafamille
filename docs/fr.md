# Agora Famille

Cette intégration relie Gladys au **portail famille Agora Famille** (édité par
Agora Plus) de votre commune : cantine, périscolaire, accueil de loisirs,
factures et messages de la mairie.

Elle lit le portail comme le ferait votre navigateur, avec votre compte, et
vous donne dans Gladys :

- un appareil **par enfant** : ce qui est réservé aujourd'hui et demain, et
  s'il mange à la cantine ;
- un appareil **compte famille** : le reste à payer, la prochaine facture, le
  dernier message ;
- des **déclencheurs de scène** (nouvelle facture, facture bientôt à
  échéance, nouveau message, réservation acceptée ou refusée) ;
- des **actions de scène** de lecture (vérifier une journée, relire le
  portail) ;
- un **widget** de tableau de bord.

## Avant de commencer

- Il faut **Gladys 5.3 ou plus récent**.
- Il vous faut un compte **actif** sur le portail Agora Famille de votre
  commune : l'adresse e-mail et le mot de passe avec lesquels vous vous y
  connectez.
- L'intégration est de type **cloud** : elle a besoin d'internet pour joindre
  le portail.

## Configuration

Dans Gladys : **Intégrations → Agora Famille → Configuration**.

| Champ                                    | Ce qu'il faut y mettre                                                                                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Adresse du portail**                   | L'adresse de votre portail telle que l'affiche votre navigateur, par ex. `https://portalssl.agoraplus.fr/maville/pck_home.home_view#/`. Le seul nom de la commune (`maville`) suffit aussi. |
| **Identifiant (e-mail)**                 | L'e-mail de votre compte famille.                                                                                                                                                           |
| **Mot de passe**                         | Le mot de passe du portail. Il est stocké comme un secret par Gladys et n'apparaît jamais dans les logs.                                                                                    |
| **Intervalle de lecture (min)**          | Fréquence de lecture du portail (60 min par défaut, 15 min minimum). Inutile d'aller plus vite : le portail change peu dans la journée.                                                     |
| **Jours de planning suivis**             | Combien de jours à venir sont lus et surveillés (14 par défaut).                                                                                                                            |
| **Rappel de facture (jours)**            | Le déclencheur « facture bientôt à échéance » part ce nombre de jours avant l'échéance (3 par défaut, 0 pour le couper).                                                                    |
| **Factures transmises au Trésor public** | Numéros des factures que la commune a transmises au Trésor public, séparés par des virgules (ex. `164513`). Voir plus bas.                                                                  |
| **Je suis en prélèvement automatique**   | À cocher si la banque paie vos factures toute seule (SEPA). Voir plus bas.                                                                                                                  |
| **Logs détaillés**                       | Journalise chaque requête au portail, pour le dépannage. Jamais le mot de passe.                                                                                                            |

Cliquez ensuite sur **Tester la connexion** : la réponse liste vos enfants, le
nombre de jours de planning lus, les factures à payer et les messages non lus.
En cas d'échec, elle dit quelle étape a échoué (connexion, enfants, planning,
factures, messages).

Puis allez dans l'onglet **Découverte** pour créer les appareils.

## Les appareils

### Agora Famille (le compte)

| Fonctionnalité   | Contenu                                                    |
| ---------------- | ---------------------------------------------------------- |
| **Balance due**  | Le reste à payer, en euros (toutes factures impayées).     |
| **Next invoice** | La prochaine facture à payer : montant, échéance, libellé. |
| **Last message** | L'objet du dernier message de la commune.                  |

### Un appareil par enfant

| Fonctionnalité       | Contenu                                                              |
| -------------------- | -------------------------------------------------------------------- |
| **Today**            | Les activités réservées aujourd'hui (« Cantine, Garderie du soir »). |
| **Tomorrow**         | Les activités réservées demain.                                      |
| **Canteen today**    | 1 si l'enfant mange à la cantine aujourd'hui, 0 sinon.               |
| **Canteen tomorrow** | 1 si l'enfant mange à la cantine demain, 0 sinon.                    |

Une journée **demandée** et pas encore validée par la commune compte comme
réservée. Les textes sont en français, comme les activités du portail.

Le repas est reconnu par son nom : « cantine », « repas », « restauration »,
« déjeuner », « pause méridienne »… Chaque commune nomme ses activités à sa
façon.

Le badge **cloud** de chaque appareil passe à **injoignable** quand le portail
ne peut pas être lu.

## Scènes (Gladys 5.1+)

### Déclencheurs

| Déclencheur                        | Quand                                                                                                  | Variables                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| **Une nouvelle facture est émise** | Une facture impayée apparaît.                                                                          | `label`, `amount`, `due_date`, `invoice_id`, `direct_debit`           |
| **Une facture arrive à échéance**  | Une facture impayée arrive à échéance dans le délai réglé. Une seule fois. Pas en prélèvement.         | `label`, `amount`, `due_date`, `days_left`, `invoice_id`              |
| **Un message est reçu**            | La commune a envoyé un message.                                                                        | `subject`, `sender`, `date`                                           |
| **Une réservation change**         | Un jour réservé ou demandé change d'état (accepté, refusé, annulé…). Filtrable par enfant et par état. | `child_name`, `activity`, `date`, `status`, `previous_status`, `meal` |

Les variables s'utilisent dans les actions suivantes, par ex.
`{{triggerEvent.data.amount}}`.

La toute première lecture du portail ne déclenche rien : tout y paraîtrait
nouveau. Les changements sont comptés à partir de là, même après un
redémarrage (l'intégration garde la dernière lecture dans `/data`).

### Actions

| Action                              | Ce qu'elle fait                                                                     | Sorties                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Lire le portail famille**         | Relit le portail tout de suite.                                                     | `success`, `balance`, `unpaid_invoices`, `unread_messages` |
| **Vérifier la journée d'un enfant** | Dit si l'enfant est réservé ce jour-là (0 = aujourd'hui, 1 = demain…) et pour quoi. | `has_meal`, `booked_count`, `activities`, `date`           |

L'intégration ne fait que **lire** le portail : elle ne réserve ni n'annule
jamais rien. Les réservations et les absences se font sur le portail.

### Exemples

- **Tous les soirs à 19 h** : _Vérifier la journée_ de chaque enfant pour
  demain, puis, si `has_meal` vaut faux, envoyer « Pas de cantine demain pour
  Léa ».
- **Une facture arrive à échéance** → envoyer « Facture de
  {{triggerEvent.data.amount}} € à payer avant le
  {{triggerEvent.data.due_date}} ».
- **Une réservation change**, filtré sur l'état _Refusé_ → notification.

## Le widget

Le widget **Agora Famille** du tableau de bord montre :

- le reste à payer (en direct) ;
- pour chaque enfant (5 au plus), ce qui est réservé aujourd'hui et demain
  (vert : réservé, orange : demande en attente, rouge : refusé) ;
- les factures à payer et les 3 derniers messages non lus ;
- l'heure de la dernière lecture, ou l'erreur en cours.

Et deux boutons : **Actualiser** et **Ouvrir le portail**. Les absences et
les réservations se font sur le portail.

## Factures transmises au Trésor public

Quand une facture n'est pas payée à temps, la commune la transmet au **Trésor
public** (« mise en impayé »). Le portail ne suit alors plus son paiement : il
la montre **impayée pour toujours**, même une fois payée au Trésor.

L'intégration met ces factures **à part** :

- elles ne comptent pas dans le **reste à payer** ni dans la **prochaine
  facture** ;
- elles ne déclenchent ni « nouvelle facture » ni « facture bientôt à
  échéance » ;
- le widget les montre en gris, avec le badge **Trésor public**.

Elles sont reconnues de deux façons :

- **toute seules**, quand le portail les marque (facture en contentieux, ou un
  état qui parle du Trésor) ;
- **par leur numéro**, dans le champ **Factures transmises au Trésor public**
  (le numéro affiché sur le portail, ex. `164513`).

## Prélèvement automatique

Quand la banque paie vos factures toute seule (prélèvement automatique, SEPA),
il n'y a rien à payer sur le portail. Cochez **Je suis en prélèvement
automatique** :

- le widget affiche **À prélever** au lieu de **À payer**, et chaque facture
  avec le badge **Prélèvement** (bleu) ;
- la **prochaine facture** affiche « 45,20 € prélevés le 20/11/2026 — … » au
  lieu de « avant le » ;
- « facture bientôt à échéance » ne part plus pour elles ;
- « nouvelle facture » part toujours, avec `direct_debit` à vrai ;
- elles restent comptées dans le **reste à payer** : l'argent est dû tant que
  la banque n'a pas payé.

Le portail ne le dit pas dans sa liste de factures. S'il l'écrit un jour dans
l'état d'une facture (« prélèvement »…), elle est reconnue sans la case. Une
facture transmise au Trésor public n'est jamais en prélèvement : la banque ne
la paie plus.

## Dépannage

- **« Le portail a refusé l'identifiant ou le mot de passe »** : vérifiez-les
  en vous connectant au portail dans un navigateur. Un compte en attente de
  validation par la mairie ne peut pas encore se connecter.
- **« Le portail ne répond pas »** : le portail est peut-être en maintenance ;
  l'intégration réessaie à chaque intervalle.
- **« Le portail a répondu quelque chose d'inattendu »** : cochez **Logs
  détaillés**, cliquez sur **Tester la connexion** et consultez les logs de
  l'intégration (Intégrations → Agora Famille → Supervision).

### Important : pas d'API officielle

Agora Plus ne publie pas d'API pour son portail famille. L'intégration
utilise les mêmes requêtes que les pages du portail ; elles sont regroupées
dans un seul fichier,
[`src/agora/endpoints.js`](../src/agora/endpoints.js). Une mise à jour du
portail, ou une commune configurée différemment, peut demander de les
ajuster : ouvrez alors une
[issue](https://github.com/prohand/gladys-agorafamille/issues) en indiquant
l'étape qui échoue et le code HTTP renvoyé (jamais votre mot de passe).

## Confidentialité

- Les identifiants servent uniquement à se connecter au portail de votre
  commune, en HTTPS.
- Le mot de passe et les cookies de session ne sont jamais écrits dans les
  logs.
- La dernière lecture du portail (planning, factures, messages) est gardée
  dans le volume privé `/data` de l'intégration, pour détecter les
  changements après un redémarrage. Rien n'est envoyé ailleurs.
