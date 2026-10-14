/* A swapped set stays on the variation that was performed, and the next prefill follows that name. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const VV = require('../variations.js');
const PF = require('../session-prefill.js');

const specSrc = fs.readFileSync(path.join(__dirname, '../data/spec.js'), 'utf8');
const SPEC = JSON.parse(specSrc.replace(/^window\.MINMAX_SPEC=/, '').replace(/;\s*$/, ''));
const chest = SPEC.program.days['2'].upper2.find(function(row){ return row.exerciseId === 'machine-chest-press'; });

function working(variation, weight, reps){
  return {setType:'working', weightKg:weight, reps:reps, rir:1, variation:variation};
}
function session(date, performed, variation, weight){
  return {
    date: date, startTime: '18:00', dayId: 'upper2', status: 'completed', finished: true,
    entries: [{
      plannedExerciseId: 'machine-chest-press',
      plannedName: 'Machine Chest Press',
      performedExercise: performed,
      substitutionUsed: performed === 'Machine Chest Press' ? 'none' : 'custom',
      sets: [working(variation || performed, weight, 8)]
    }]
  };
}

const sessions = [
  session('2026-10-01', 'Barbell Bench', 'Barbell Bench', 80),
  session('2026-10-08', 'DB Bench Press', 'DB Bench Press', 30)
];

assert.strictEqual(VV.lastExposure(sessions, 'Barbell Bench', '2026-10-14').weight, 80);
assert.strictEqual(VV.lastExposure(sessions, 'DB Bench Press', '2026-10-14').weight, 30);
assert.strictEqual(VV.lastExposure(sessions, 'Machine Chest Press', '2026-10-14'), null, 'the slot name does not inherit either variation');
assert.strictEqual(VV.lastExposure(sessions, 'Cable Fly', '2026-10-14'), null);

const moved = session('2026-10-01', 'Machine Chest Press', 'Barbell Bench', 80);
moved.entries[0].performedExercise = 'Machine Chest Press';
assert.strictEqual(VV.lastExposure([moved], 'Barbell Bench', '2026-10-14').weight, 80, 'a later rename of the slot does not move the logged set');
assert.strictEqual(VV.lastExposure([moved], 'Machine Chest Press', '2026-10-14'), null);

const legacy = session('2026-10-01', 'DB Bench Press', null, 30);
delete legacy.entries[0].sets[0].variation;
assert.strictEqual(VV.lastExposure([legacy], 'DB Bench Press', '2026-10-14').weight, 30, 'older sets still follow the entry name');

function prefill(name){
  const hit = VV.lastExposure(sessions, name, '2026-10-14');
  const inc = PF.incrementKg(name, chest, SPEC.progressionRules);
  return PF.prefillWeight(hit && hit.weight, inc);
}
assert.strictEqual(PF.incrementKg('DB Bench Press', chest, SPEC.progressionRules), 2);
assert.strictEqual(PF.incrementKg('Barbell Bench', chest, SPEC.progressionRules), 2.5);
assert.strictEqual(prefill('DB Bench Press'), 32, 'remembered DB Bench prefills from 30 plus the dumbbell increment');
assert.strictEqual(prefill('Barbell Bench'), 82.5, 'switching back to Barbell Bench prefills from 80 plus the barbell increment');
assert.strictEqual(prefill('Cable Fly'), null, 'a custom name with no history stays blank');
assert.strictEqual(prefill('Machine Chest Press'), null);

const remembered = VV.rememberedName(chest, sessions[1].entries[0], true);
assert.strictEqual(remembered, 'DB Bench Press');

console.log('variation-history.test.js ok');
