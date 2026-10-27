import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESERVATION_STATUS,
  isMeal,
  parseAmount,
  parseChildren,
  parseInvoices,
  parseMessages,
  parsePlanning,
  parseReservationStatus,
} from '../src/agora/parse.js';
import { addDays, dayOf, daysBetween, parseDay } from '../src/agora/dates.js';

test('children are read under the names portals give them', () => {
  assert.deepEqual(parseChildren({ enfants: [{ idEnfant: 7, prenom: 'Léa', nom: 'Martin' }] }), [
    { id: '7', firstName: 'Léa', lastName: 'Martin', name: 'Léa' },
  ]);
  assert.deepEqual(
    parseChildren({ data: [{ id: 'A1', firstName: 'Tom', lastName: 'Dupont' }] }).map((c) => c.id),
    ['A1'],
  );
  // No id, no first name, or twice the same: dropped.
  assert.equal(parseChildren([{ prenom: 'X' }, { idEnfant: 1 }]).length, 0);
  assert.equal(
    parseChildren([
      { id: 1, prenom: 'A' },
      { id: 1, prenom: 'A' },
    ]).length,
    1,
  );
});

test('two children with the same first name are told apart', () => {
  const children = parseChildren([
    { id: 1, prenom: 'Léa', nom: 'Martin' },
    { id: 2, prenom: 'Léa', nom: 'Durand' },
  ]);
  assert.deepEqual(
    children.map((child) => child.name),
    ['Léa Martin', 'Léa Durand'],
  );
});

test('reservation states are read from the labels of the portal', () => {
  const cases = {
    Réservé: RESERVATION_STATUS.RESERVED,
    'Réservation acceptée': RESERVATION_STATUS.RESERVED,
    Présent: RESERVATION_STATUS.RESERVED,
    'Demande de réservation': RESERVATION_STATUS.REQUESTED,
    'En attente de validation': RESERVATION_STATUS.REQUESTED,
    "Demande d'absence": RESERVATION_STATUS.ABSENCE_REQUESTED,
    Absent: RESERVATION_STATUS.ABSENT,
    Annulé: RESERVATION_STATUS.ABSENT,
    'Demande refusée': RESERVATION_STATUS.REFUSED,
    Inscrit: RESERVATION_STATUS.REGISTERED,
    'Non réservé': RESERVATION_STATUS.REGISTERED,
    absence_requested: RESERVATION_STATUS.ABSENCE_REQUESTED,
    reserved: RESERVATION_STATUS.RESERVED,
  };
  for (const [label, status] of Object.entries(cases)) {
    assert.equal(parseReservationStatus(label), status, label);
  }
  assert.equal(parseReservationStatus('???'), null);
  assert.equal(parseReservationStatus(''), null);
});

test('the planning keeps readable days only, once each', () => {
  const children = [{ id: '7', firstName: 'Léa' }];
  const planning = parsePlanning(
    {
      planning: [
        {
          idEnfant: 7,
          date: '05/11/2026',
          libelleActivite: 'Cantine',
          idActivite: 'C',
          etat: 'Réservé',
        },
        {
          idEnfant: 7,
          date: '2026-11-05',
          libelleActivite: 'Cantine',
          idActivite: 'C',
          etat: 'Réservé',
        },
        { prenomEnfant: 'Léa', date: '2026-11-04', activite: 'Garderie soir', etat: 'Inscrit' },
        { idEnfant: 7, date: 'demain', activite: 'Cantine', etat: 'Réservé' },
        { idEnfant: 7, date: '2026-11-06', activite: 'Cantine', etat: 'Bizarre' },
      ],
    },
    children,
  );
  assert.deepEqual(planning, [
    {
      childId: '7',
      day: '2026-11-04',
      activity: 'Garderie soir',
      activityId: 'garderie-soir',
      status: RESERVATION_STATUS.REGISTERED,
    },
    {
      childId: '7',
      day: '2026-11-05',
      activity: 'Cantine',
      activityId: 'C',
      status: RESERVATION_STATUS.RESERVED,
    },
  ]);
});

test('amounts are read the French way and the English way', () => {
  assert.equal(parseAmount('45,20 €'), 45.2);
  assert.equal(parseAmount('1 234,50'), 1234.5);
  assert.equal(parseAmount('1.234,50 EUR'), 1234.5);
  assert.equal(parseAmount('12.5'), 12.5);
  assert.equal(parseAmount(7.005), 7.01);
  assert.equal(parseAmount('n/a'), null);
  assert.equal(parseAmount(null), null);
});

test('invoices know what is left to pay', () => {
  const invoices = parseInvoices({
    factures: [
      {
        numFacture: 'F1',
        libelle: 'Octobre',
        montant: '45,20',
        dateEcheance: '15/11/2026',
        etat: 'À payer',
      },
      {
        numFacture: 'F0',
        libelle: 'Septembre',
        montant: 30,
        payee: true,
        dateFacture: '2026-10-01',
      },
      { numFacture: 'F2', libelle: 'Novembre', montant: 50, resteAPayer: '10,00' },
      { libelle: 'sans numéro', montant: 1 },
    ],
  });
  const byId = Object.fromEntries(invoices.map((invoice) => [invoice.id, invoice]));
  assert.equal(invoices.length, 3);
  assert.equal(byId.F1.paid, false);
  assert.equal(byId.F1.remaining, 45.2);
  assert.equal(byId.F1.dueOn, '2026-11-15');
  assert.equal(byId.F0.paid, true);
  assert.equal(byId.F0.remaining, 0);
  assert.equal(byId.F2.remaining, 10);
  assert.equal(byId.F2.paid, false);
});

test('messages are read, unread unless the portal says otherwise', () => {
  const messages = parseMessages([
    { idMessage: 1, objet: 'Grève du 12', expediteur: 'Service enfance', dateEnvoi: '10/11/2026' },
    { idMessage: 2, objet: 'Menu', lu: 'O' },
    { idMessage: 3 },
  ]);
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], {
    id: '1',
    subject: 'Grève du 12',
    sender: 'Service enfance',
    date: '2026-11-10',
    read: false,
  });
  assert.equal(messages[1].read, true);
});

test('meals are recognised whatever the municipality calls them', () => {
  for (const label of ['Cantine', 'Restauration scolaire', 'Repas midi', 'Pause méridienne']) {
    assert.ok(isMeal(label), label);
  }
  assert.ok(!isMeal('Garderie du soir'));
});

test('days are counted in Paris, not in UTC', () => {
  // 23:30 UTC on 4 November is 00:30 on 5 November in Paris.
  assert.equal(dayOf(new Date('2026-11-04T23:30:00Z')), '2026-11-05');
  assert.equal(addDays('2026-10-24', 2), '2026-10-26'); // over the DST change
  assert.equal(daysBetween('2026-11-04', '2026-11-15'), 11);
  assert.equal(parseDay('05/11/26'), '2026-11-05');
  assert.equal(parseDay('20261105'), '2026-11-05');
  assert.equal(parseDay('31/02/2026'), null);
  assert.equal(parseDay('2026-11-04T23:30:00Z'), '2026-11-05');
});
