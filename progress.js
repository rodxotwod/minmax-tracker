/* Day-by-day progress status. Thresholds live only in trendStatus. */
(function(root, factory){
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MinMaxProgress = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  /* Status thresholds — the only place they are decided.

     An exposure is one completed session of a single variation. The caller
     drops skipped exercises and skipped sessions; discarded workouts are
     already gone. The top set is the heaviest working set. Tied weights
     go to the set with more reps.

     Score is the Epley estimate of that top set: weight × (1 + reps / 30).
     Extra reps at the same weight raise the score. If reps are missing the
     score is the weight alone, and any comparison that mixes that with an
     Epley score uses weight, then reps, so the two scales are not mixed.

     Tolerance is 0.05 so floating-point noise is not a trend. A plate
     change or a single rep is much larger.
     - under 2 exposures → new (not enough data)
     - latest score below the previous exposure → regressing (it dropped)
     - latest score above the exposure two sessions back (the previous
       exposure, when only two exist) → progressing
     - latest score below that earlier exposure → regressing
     - otherwise, with 3 or more exposures → stalled
       (no improvement over the last 3 sessions)
     - exactly 2 exposures with the same score → new
       (a stall needs three sessions without a gain)
  */
  const MIN_EXPOSURES = 2;
  const STALL_EXPOSURES = 3;
  const LOOKBACK = 2;
  const EPS = 0.05;

  function fmtNum(n){
    return (Math.round((+n) * 100) / 100).toString();
  }

  function epley(weight, reps){
    return weight * (1 + (reps || 0) / 30);
  }

  function asReps(reps){
    if (reps == null || reps === '' || !isFinite(+reps)) return null;
    return +reps;
  }

  function topSet(sets){
    let best = null;
    (sets || []).forEach(function(set){
      const weight = set && set.weight != null && set.weight !== '' ? +set.weight : NaN;
      if (!isFinite(weight)) return;
      const reps = asReps(set.reps);
      const betterWeight = !best || weight > best.weight + 1e-9;
      const sameWeight = best && Math.abs(weight - best.weight) <= 1e-9;
      const betterReps = sameWeight && (reps || 0) > (best.reps || 0);
      if (!betterWeight && !betterReps) return;
      best = {
        weight: weight,
        reps: reps,
        score: reps == null ? weight : epley(weight, reps),
        scoredBy: reps == null ? 'weight' : 'epley'
      };
    });
    return best;
  }

  function cmpPoint(a, b){
    if (!a || !b) return 0;
    if (a.scoredBy === 'epley' && b.scoredBy === 'epley') {
      if (a.score > b.score + EPS) return 1;
      if (a.score < b.score - EPS) return -1;
      return 0;
    }
    if (Math.abs(a.weight - b.weight) >= EPS) return a.weight > b.weight ? 1 : -1;
    if (a.reps != null && b.reps != null && a.reps !== b.reps) return a.reps > b.reps ? 1 : -1;
    return 0;
  }

  function trendStatus(points){
    const list = points || [];
    const n = list.length;
    if (n < MIN_EXPOSURES) return 'new';
    const latest = list[n - 1];
    const prev = list[n - 2];
    if (cmpPoint(latest, prev) < 0) return 'regressing';
    const back = n >= STALL_EXPOSURES ? list[n - 1 - LOOKBACK] : prev;
    const versus = cmpPoint(latest, back);
    if (versus > 0) return 'progressing';
    if (versus < 0) return 'regressing';
    if (n >= STALL_EXPOSURES) return 'stalled';
    return 'new';
  }

  function changeLabel(from, to){
    if (!from || !to) return '';
    const dw = Math.round((to.weight - from.weight) * 100) / 100;
    if (Math.abs(dw) >= EPS) return (dw > 0 ? '+' : '') + fmtNum(dw) + ' kg';
    if (from.reps != null && to.reps != null && from.reps !== to.reps) {
      const dr = to.reps - from.reps;
      return (dr > 0 ? '+' : '') + dr + ' ' + (Math.abs(dr) === 1 ? 'rep' : 'reps');
    }
    return 'same';
  }

  function sinceLabel(points){
    if (!points || !points.length) return 'No sessions yet';
    if (points.length < MIN_EXPOSURES) return 'First session';
    return changeLabel(points[0], points[points.length - 1]) + ' since first';
  }

  function recentLabel(points){
    if (!points || points.length < MIN_EXPOSURES) return '';
    const n = points.length;
    const back = n >= STALL_EXPOSURES ? points[n - 1 - LOOKBACK] : points[n - 2];
    const span = n >= STALL_EXPOSURES ? STALL_EXPOSURES : MIN_EXPOSURES;
    return changeLabel(back, points[n - 1]) + ' over last ' + span;
  }

  function formatSet(point){
    if (!point) return '—';
    return fmtNum(point.weight) + ' × ' + (point.reps == null ? '—' : point.reps);
  }

  /* Sparkline plots Epley when every point has reps, otherwise top-set weight. */
  function sparkGeometry(points, width, height){
    const list = points || [];
    if (!list.length) return [];
    const epleyOnly = list.every(function(p){ return p.scoredBy === 'epley'; });
    const vals = list.map(function(p){ return epleyOnly ? p.score : p.weight; });
    const w = width || 68;
    const h = height || 24;
    let min = Math.min.apply(null, vals);
    let max = Math.max.apply(null, vals);
    if (max - min < 1e-6) { min -= 1; max += 1; }
    const n = vals.length;
    return vals.map(function(v, i){
      const x = n === 1 ? w / 2 : 2 + (i / (n - 1)) * (w - 4);
      const y = (h - 3) - ((v - min) / (max - min)) * (h - 6);
      return {x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10};
    });
  }

  return {epley, topSet, trendStatus, changeLabel, sinceLabel, recentLabel, formatSet, sparkGeometry};
});
