import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOOKING_REFUSALS, cancellationLine, reservationLine } from '../src/agora/booking.js';
import { parsePlanning } from '../src/agora/parse.js';
import { apiDay } from './helpers/fakePortal.js';

const TODAY = '2026-11-04';

/** One planning entry, read from the API's own shape like the integration does. */
function entry(fields) {
  return parsePlanning({
    DATA: { EVENTS: [apiDay({ child: 101, date: '05/11/2026', ...fields })] },
  })[0];
}

const refusedFor = (reason) => (err) => {
  assert.equal(err.code, 'refused');
  assert.equal(err.reason, reason);
  return true;
};

test('a bookable day gives the line the calendar sends', () => {
  assert.deepEqual(reservationLine(entry({ inscription: 55 }), TODAY), {
    IdInscription: 55,
    Day: '05/11/2026',
    IdDefTarif: 3001,
    IsMajored: false,
    DeleteBasketEvent: -1,
  });
});

test('what the calendar would not book is refused, with the reason', () => {
  const cases = [
    [{ date: '03/11/2026' }, BOOKING_REFUSALS.PAST],
    [{ canSubscribe: 0 }, BOOKING_REFUSALS.CLOSED],
    [{ slots: 0 }, BOOKING_REFUSALS.FULL],
    [{ rates: [3001, 3002] }, BOOKING_REFUSALS.RATES],
    [{ rates: [] }, BOOKING_REFUSALS.RATES],
  ];
  for (const [fields, reason] of cases) {
    assert.throws(() => reservationLine(entry(fields), TODAY), refusedFor(reason), reason.en);
  }
  const unavailable = entry({});
  unavailable.refs.IS_UNAVAILABLE = 1;
  assert.throws(
    () => reservationLine(unavailable, TODAY),
    refusedFor(BOOKING_REFUSALS.UNAVAILABLE),
  );
  assert.throws(() => reservationLine({ day: TODAY }, TODAY), refusedFor(BOOKING_REFUSALS.UNKNOWN));
});

test('a booked day gives the cancellation line, basket days included', () => {
  assert.deepEqual(cancellationLine(entry({ selected: 1, inscription: 9 }), TODAY), {
    IdInscription: 9,
    Day: '05/11/2026',
    IdDefTarif: -1,
    IsMajored: false,
    DeleteBasketEvent: -1,
  });
  assert.equal(cancellationLine(entry({ selected: 1, basket: 1 }), TODAY).DeleteBasketEvent, 1);
});

test('a cancellation the calendar would not make is refused', () => {
  assert.throws(
    () => cancellationLine(entry({ selected: 0 }), TODAY),
    refusedFor(BOOKING_REFUSALS.NOT_BOOKED),
  );
  assert.throws(
    () => cancellationLine(entry({ selected: 1, canUnsubscribe: 0 }), TODAY),
    refusedFor(BOOKING_REFUSALS.TOO_LATE),
  );
  assert.throws(
    () => cancellationLine(entry({ selected: 1, majored: 1 }), TODAY),
    refusedFor(BOOKING_REFUSALS.PENALTY),
  );
});
