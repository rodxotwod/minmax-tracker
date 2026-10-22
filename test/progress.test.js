/* Progress status: Epley top-set trend, one set of thresholds. */
const assert = require('assert');
const PG = require('../progress.js');

function point(weight, reps){
  const top = PG.topSet([{weight: weight, reps: reps}]);
  assert.ok(top);
  return top;
}

assert.strictEqual(PG.trendStatus([]), 'new');
assert.strictEqual(PG.trendStatus([point(60, 8)]), 'new');
assert.strictEqual(PG.sinceLabel([point(60, 8)]), 'First session');
assert.strictEqual(PG.sinceLabel([]), 'No sessions yet');

const upTwo = [point(60, 8), point(67.5, 8)];
assert.strictEqual(PG.trendStatus(upTwo), 'progressing');
assert.strictEqual(PG.sinceLabel(upTwo), '+7.5 kg since first');
assert.strictEqual(PG.recentLabel(upTwo), '+7.5 kg over last 2');

const repsOnly = [point(40, 8), point(40, 8), point(40, 10)];
assert.strictEqual(PG.trendStatus(repsOnly), 'progressing', 'reps at the same weight count via Epley');
assert.ok(PG.epley(40, 10) > PG.epley(40, 8));
assert.strictEqual(PG.sinceLabel(repsOnly), '+2 reps since first');
assert.strictEqual(PG.recentLabel(repsOnly), '+2 reps over last 3');

const heldThenUp = [point(60, 8), point(62.5, 8), point(65, 8), point(67.5, 8)];
assert.strictEqual(PG.trendStatus(heldThenUp), 'progressing');
assert.strictEqual(PG.sinceLabel(heldThenUp), '+7.5 kg since first');
assert.strictEqual(PG.recentLabel(heldThenUp), '+5 kg over last 3');

const flat = [point(100, 6), point(100, 6), point(100, 6)];
assert.strictEqual(PG.trendStatus(flat), 'stalled');
assert.strictEqual(PG.sinceLabel(flat), 'same since first');
assert.strictEqual(PG.recentLabel(flat), 'same over last 3');

const flatAfterRise = [point(50, 8), point(60, 8), point(60, 8), point(60, 8)];
assert.strictEqual(PG.trendStatus(flatAfterRise), 'stalled', 'the last 3 sessions did not improve');

assert.strictEqual(PG.trendStatus([point(80, 8), point(80, 8)]), 'new', 'two unchanged sessions are not a stall yet');

const dropped = [point(80, 10), point(82.5, 10), point(77.5, 8)];
assert.strictEqual(PG.trendStatus(dropped), 'regressing');
assert.strictEqual(PG.changeLabel(point(80, 10), point(77.5, 8)), '-2.5 kg');
assert.strictEqual(PG.sinceLabel(dropped), '-2.5 kg since first');

const bounce = [point(100, 8), point(90, 8), point(95, 8)];
assert.strictEqual(PG.trendStatus(bounce), 'regressing', 'still down versus two sessions back');

const heavierFewerReps = [point(80, 10), point(82.5, 8)];
assert.ok(PG.epley(82.5, 8) < PG.epley(80, 10));
assert.strictEqual(PG.trendStatus(heavierFewerReps), 'regressing');

assert.strictEqual(PG.topSet([{weight: 22.5, reps: 10}, {weight: 20, reps: 12}]).weight, 22.5);
assert.strictEqual(PG.topSet([{weight: '22.5', reps: 8}]).weight, 22.5);
assert.strictEqual(PG.formatSet(PG.topSet([{weight: 122.5, reps: 8}])), '122.5 × 8');

const tie = PG.topSet([{weight: 80, reps: 6}, {weight: 80, reps: 8}, {weight: 70, reps: 12}]);
assert.strictEqual(tie.weight, 80);
assert.strictEqual(tie.reps, 8);

const missingReps = [PG.topSet([{weight: 50, reps: null}]), PG.topSet([{weight: 55, reps: null}])];
assert.strictEqual(missingReps[0].scoredBy, 'weight');
assert.strictEqual(PG.trendStatus(missingReps), 'progressing');

const line = PG.sparkGeometry(heldThenUp);
assert.strictEqual(line.length, 4);
assert.ok(line[line.length - 1].y < line[0].y, 'a rising Epley trend draws upward');
assert.deepStrictEqual(PG.sparkGeometry([]), []);

console.log('progress.test.js ok');
