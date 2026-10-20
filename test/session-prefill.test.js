/* Prefill uses last load plus the program increment. Reminders stay dismissed per account. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {parseDecimal, incrementKg, prefillWeight, prefillReps, weekBannerVisible, visibleGaps} = require('../session-prefill.js');

const specSrc = fs.readFileSync(path.join(__dirname, '../data/spec.js'), 'utf8');
const SPEC = JSON.parse(specSrc.replace(/^window\.MINMAX_SPEC=/, '').replace(/;\s*$/, ''));
const rules = SPEC.progressionRules;

assert.strictEqual(incrementKg('Squat (Your Choice)', null, rules), 2.5, 'lower compound uses the barbell increment');
assert.strictEqual(incrementKg('Smith Machine Lunge', null, rules), 2.5);
assert.strictEqual(incrementKg('Leg Press', null, rules), 2.5);
assert.strictEqual(incrementKg('Barbell RDL', null, rules), 2.5);
assert.strictEqual(incrementKg('Incline DB Y-Raise', null, rules), 2, 'dumbbell isolation uses the smaller increment');
assert.strictEqual(incrementKg('DB Wrist Curl', null, rules), 2);
assert.strictEqual(incrementKg('Lying Leg Curl', null, rules), 2.5, 'machine default is the program minimum');
assert.strictEqual(incrementKg('Bayesian Cable Curl', null, rules), 2.5);
assert.strictEqual(incrementKg('Custom Lift', {incrementKg: 1.25}, rules), 1.25, 'exercise increment wins');

assert.strictEqual(parseDecimal('22,5'), 22.5);
assert.strictEqual(parseDecimal('22.5'), 22.5);
assert.strictEqual(parseDecimal('22,50'), 22.5);
assert.strictEqual(parseDecimal(' 22,5 '), 22.5);
assert.strictEqual(parseDecimal(''), null);
assert.strictEqual(parseDecimal('abc'), null);
assert.strictEqual(prefillWeight(parseDecimal('22,5'), 2.5), 25, 'a comma-typed weight still progresses by the program increment');

assert.strictEqual(prefillWeight(40, 2.5), 42.5);
assert.strictEqual(prefillWeight(100, 2.5), 102.5);
assert.strictEqual(prefillWeight(10, 2), 12);
assert.strictEqual(prefillWeight(null, 2.5), null, 'no history leaves weight blank');
assert.strictEqual(prefillWeight('', 2.5), null);

assert.strictEqual(prefillReps(8, [6, 8]), 8, 'reps come from the previous session');
assert.strictEqual(prefillReps(null, [6, 8]), 6, 'otherwise the program target');
assert.strictEqual(prefillReps(null, null), null);

assert.strictEqual(weekBannerVisible({}), true);
assert.strictEqual(weekBannerVisible({currentWeek: 3}), false);
assert.strictEqual(weekBannerVisible({dismissWeekBanner: true}), false);

const gaps = ['nothing logged since Wed 1 Oct — back-fill?', 'Wed 1 Oct Lower 1: reps/RIR missing'];
assert.deepStrictEqual(visibleGaps(gaps, {}), gaps);
assert.deepStrictEqual(visibleGaps(gaps, {dismissBackfillBanner: true}), ['Wed 1 Oct Lower 1: reps/RIR missing']);
assert.deepStrictEqual(visibleGaps(['nothing logged since Wed 1 Oct — back-fill?'], {dismissBackfillBanner: true}), []);

const keyed = [
  {key:'backfill', text:'nothing logged since Wed 1 Oct — back-fill?'},
  {key:'s1:missing', text:'Wed 1 Oct Lower 1: 3 exercise(s) without sets'},
  {key:'s2:noreps', text:'Thu 2 Oct Upper 1: reps/RIR missing'}
];
const {dismissedGapKeys} = require('../session-prefill.js');
const dismissed = dismissedGapKeys(keyed, {});
assert.deepStrictEqual(visibleGaps(keyed, {dismissedGapKeys: dismissed}), []);
const later = [
  {key:'backfill', text:'nothing logged since Fri 10 Oct — back-fill?'},
  {key:'s1:missing', text:'Wed 1 Oct Lower 1: 4 exercise(s) without sets'}
];
assert.deepStrictEqual(visibleGaps(later, {dismissedGapKeys: dismissed}), [], 'the same gaps stay hidden when only the wording changes');
const withNew = later.concat([{key:'s3:missing', text:'Sat 3 Oct Upper 2: 1 exercise(s) without sets'}]);
assert.deepStrictEqual(visibleGaps(withNew, {dismissedGapKeys: dismissed}).map(g => g.key), ['s3:missing']);

console.log('session-prefill.test.js ok');
