/* Substitutions stay on the variation that was actually performed. */
const assert = require('assert');
const {variationsFor, codeFor, rememberedName, lastWeight, isRealName} = require('../variations.js');

const chest = {name:'Machine Chest Press', substitution1:'DB Bench Press', substitution2:'Smith Machine Bench Press'};
const squat = {name:'Squat (Your Choice)', substitution1:'See Notes', substitution2:'See Notes'};
const hang = {name:'Dead Hang (optional)', substitution1:null, substitution2:null};
const wrist = {name:'DB Wrist Curl', substitution1:null, substitution2:'Cable Wrist Curl'};

assert.deepStrictEqual(variationsFor(chest).map(v => v.name), ['Machine Chest Press', 'DB Bench Press', 'Smith Machine Bench Press']);
assert.deepStrictEqual(variationsFor(squat).map(v => v.code), ['none'], 'placeholder notes are not alternatives');
assert.deepStrictEqual(variationsFor(hang).map(v => v.code), ['none']);
assert.deepStrictEqual(variationsFor(wrist).map(v => v.name), ['DB Wrist Curl', 'Cable Wrist Curl']);
assert.strictEqual(isRealName('See Notes'), false);

assert.strictEqual(codeFor(chest, 'DB Bench Press'), 'sub1');
assert.strictEqual(codeFor(chest, 'Smith Machine Bench Press'), 'sub2');
assert.strictEqual(codeFor(chest, 'Machine Chest Press'), 'none');
assert.strictEqual(codeFor(chest, 'Cable Chest Press'), 'custom');

const press = {name:'Leg Press', substitution1:'Barbell Squat', substitution2:'Smith Machine Squat', substitution3:'Machine Leg Press'};
assert.deepStrictEqual(variationsFor(press).map(v => v.name), ['Leg Press', 'Barbell Squat', 'Smith Machine Squat', 'Machine Leg Press']);
assert.strictEqual(codeFor(press, 'Machine Leg Press'), 'sub3');
const calf = {name:'Standing Calf Raise', substitution1:'Donkey Calf Raise', substitution2:'Leg Press Calf Press', substitution3:'Seated Calf Raise'};
assert.deepStrictEqual(variationsFor(calf).map(v => v.name), ['Standing Calf Raise', 'Donkey Calf Raise', 'Leg Press Calf Press', 'Seated Calf Raise']);
assert.strictEqual(codeFor(calf, 'Seated Calf Raise'), 'sub3');

const previous = {performedExercise:'DB Bench Press', substitutionUsed:'sub1'};
assert.strictEqual(rememberedName(chest, previous, true), 'DB Bench Press');
assert.strictEqual(rememberedName(chest, previous, false), 'Machine Chest Press');
assert.strictEqual(rememberedName(chest, {performedExercise:'See Notes', substitutionUsed:'sub1'}, true), 'Machine Chest Press');

const history = [
  {name:'Machine Chest Press', weight:80},
  {name:'DB Bench Press', weight:30},
  {name:'Machine Chest Press', weight:85}
];
assert.strictEqual(lastWeight(history, 'DB Bench Press'), 30);
assert.strictEqual(lastWeight(history, 'Machine Chest Press'), 85);
assert.strictEqual(lastWeight(history, 'Smith Machine Bench Press'), null, 'a variation with no history stays blank');

console.log('variations.test.js ok');
