/* Next session follows the split, not the weekday and not a stale override. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { suggestedDay } = require('../next-day.js');

const specSrc = fs.readFileSync(path.join(__dirname, '../data/spec.js'), 'utf8');
const SPEC = JSON.parse(specSrc.replace(/^window\.MINMAX_SPEC=/, '').replace(/;\s*$/, ''));
const split = SPEC.program.weeklySplit;

function trained(dayId, date, time){
  return {
    date: date, startTime: time || '12:00', dayId: dayId, status: 'completed',
    entries: [{ sets: [{ setType: 'working', weightKg: 60, reps: 8, rir: 1 }] }]
  };
}
function skipped(dayId, date){
  return { date: date, startTime: '12:00', dayId: dayId, status: 'skipped', skipReason: 'soreness', entries: [] };
}

const upperThenLower = [
  trained('upper1', '2026-10-07', '17:00'),
  trained('lower1', '2026-10-08', '18:00'),
  skipped('armsDelts', '2026-10-09'),
  skipped('rest', '2026-10-10')
];
const legacyOverride = { nextDayOverride: 'armsDelts' };

assert.strictEqual(
  suggestedDay(split, upperThenLower, '2026-10-13', legacyOverride),
  'upper2',
  'after Upper 1 and Lower 1, soreness skips must not leave the next day on Arms + Delts'
);
assert.strictEqual(
  suggestedDay(split, upperThenLower, '2026-10-14', legacyOverride),
  'upper2',
  'the calendar weekday does not pick the session'
);
assert.strictEqual(
  suggestedDay(split, upperThenLower.concat([skipped('upper2', '2026-10-11')]), '2026-10-13', {}),
  'upper2',
  'skipping the next training day does not advance past it'
);
assert.strictEqual(
  suggestedDay(split, [trained('armsDelts', '2026-10-12')], '2026-10-13', {}),
  'upper1',
  'after Arms + Delts the split wraps to Upper 1, skipping the rest slot'
);
assert.strictEqual(
  suggestedDay(split, upperThenLower.concat([trained('upper2', '2026-10-13', '18:10')]), '2026-10-13', legacyOverride),
  'upper2',
  'a workout already logged today stays the current session'
);
assert.strictEqual(
  suggestedDay(split, upperThenLower, '2026-10-13', { nextDayOverride: 'lower2', nextDayPinned: true }),
  'lower2',
  'an explicit settings pin still wins'
);
assert.strictEqual(
  suggestedDay(split, [], '2026-10-13', legacyOverride),
  'upper1',
  'with no completed sessions the split starts at Upper 1'
);

const order = split.map(function(slot){ return slot.dayId; }).filter(function(id){ return id !== 'rest'; });
assert.deepStrictEqual(order, ['upper1','lower1','upper2','lower2','armsDelts']);
console.log('next-day tests passed');
