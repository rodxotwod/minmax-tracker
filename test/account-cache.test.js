/* A new account stays empty, and one browser cannot read or upload another user's cache. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {cacheKey, blankTracker, readScoped, writeScoped, loadDecision, canPush, LEGACY_KEY} = require('../account-cache.js');

const specSrc = fs.readFileSync(path.join(__dirname, '../data/spec.js'), 'utf8');
const SPEC = JSON.parse(specSrc.replace(/^window\.MINMAX_SPEC=/, '').replace(/;\s*$/, ''));

function memory(){
  const m = {};
  return {
    getItem(k){ return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    setItem(k, v){ m[k] = String(v); },
    removeItem(k){ delete m[k]; }
  };
}

const rodrigo = SPEC.athleteState;
assert.ok(rodrigo.sessions.length >= 2, 'spec still holds the original personal history');
assert.ok(rodrigo.recentBestsKg.length > 0, 'spec still holds the original bests');
assert.ok(SPEC.program.weeklySplit.length >= 5, 'program template stays in the spec');

const fresh = loadDecision(null, null, false);
assert.strictEqual(fresh.source, 'blank');
assert.strictEqual(fresh.upload, true);
assert.strictEqual(fresh.data.sessions.length, 0);
assert.strictEqual(fresh.data.baselineBests.length, 0);
assert.strictEqual(fresh.data.seeded, false);
assert.ok(!fresh.data.sessions.some(s => rodrigo.sessions.some(r => r.date === s.date)));

const offlineFresh = loadDecision(null, null, true);
assert.strictEqual(offlineFresh.source, 'blank');
assert.strictEqual(offlineFresh.upload, false, 'offline with no cache must not upload an empty tracker over unknown remote data');

const storage = memory();
storage.setItem(LEGACY_KEY, JSON.stringify({
  version: 1,
  sessions: rodrigo.sessions.map(s => ({date: s.date, dayId: s.dayId, status: 'completed'})),
  baselineBests: rodrigo.recentBestsKg.slice(),
  settings: {}
}));
writeScoped(storage, 'user-a', {
  version: 1,
  sessions: [{date: '2026-10-08', dayId: 'lower2', status: 'completed'}],
  baselineBests: [{exercise: 'Local A Best'}],
  settings: {}
});

assert.strictEqual(cacheKey('user-a'), 'minmax-tracker-v1:user-a');
assert.notStrictEqual(cacheKey('user-a'), cacheKey('user-b'));
assert.notStrictEqual(cacheKey('user-b'), LEGACY_KEY);

assert.strictEqual(readScoped(storage, 'user-b'), null);
const userB = loadDecision(null, readScoped(storage, 'user-b'), false);
assert.strictEqual(userB.data.sessions.length, 0);
assert.strictEqual(userB.data.baselineBests.length, 0);
assert.ok(storage.getItem(LEGACY_KEY), 'legacy shared cache is left unread');

const userA = readScoped(storage, 'user-a');
assert.strictEqual(userA.sessions[0].dayId, 'lower2');
const remoteWins = loadDecision(
  {version: 1, sessions: [{date: '2026-11-01', dayId: 'upper2'}], baselineBests: []},
  userA,
  false
);
assert.strictEqual(remoteWins.source, 'remote');
assert.strictEqual(remoteWins.upload, false);
assert.strictEqual(remoteWins.data.sessions[0].dayId, 'upper2');

const ownLocal = loadDecision(null, userA, false);
assert.strictEqual(ownLocal.source, 'local');
assert.strictEqual(ownLocal.upload, true);
assert.strictEqual(ownLocal.data.sessions[0].dayId, 'lower2');

assert.strictEqual(canPush('user-a', 'user-a'), true);
assert.strictEqual(canPush('user-b', 'user-a'), false);
assert.strictEqual(canPush(null, 'user-a'), false);

const blank = blankTracker();
blank.sessions.push({date: '2026-10-07'});
assert.strictEqual(blankTracker().sessions.length, 0, 'blank tracker is a new object');

console.log('account-cache.test.js ok');
