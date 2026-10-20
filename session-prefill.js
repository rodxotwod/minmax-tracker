/* New-session prefill and per-account reminder visibility.
   Load jumps use progressionRules.suggestedIncrementKg. An exercise incrementKg wins when set. */
(function(root, factory){
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MinMaxPrefill = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  function round2(n){ return Math.round(n * 100) / 100; }

  /* iOS decimal keyboards type a comma. One separator style is the decimal mark. */
  function parseDecimal(v){
    if (v == null) return null;
    let s = String(v).trim().replace(/\s/g, '');
    if (!s) return null;
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma >= 0 && lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    if (!isFinite(+s)) return null;
    return +s;
  }
  function asNumber(v, fallback){
    const n = +v;
    return isFinite(n) ? n : fallback;
  }

  function incrementKg(name, exercise, progressionRules){
    if (exercise) {
      const specific = exercise.incrementKg != null ? exercise.incrementKg
        : exercise.minIncrementKg != null ? exercise.minIncrementKg
        : exercise.suggestedIncrementKg;
      if (typeof specific === 'number' && isFinite(specific) && specific > 0) return specific;
    }
    const add = ((progressionRules && progressionRules.rules) || []).find(function(r){ return r.id === 'add_load'; });
    const table = (add && add.then && add.then.suggestedIncrementKg) || {barbell:2.5, dumbbell:2, default:2.5};
    const n = String(name || '');
    if (/\bdb\b|dumbbell/i.test(n)) return asNumber(table.dumbbell, 2);
    if (/barbell|smith|squat|\brdl\b|romanian|deadlift|leg press|hip thrust|lunge/i.test(n)) return asNumber(table.barbell, 2.5);
    if (typeof table.machine_or_cable === 'number') {
      if (/machine|cable|pulldown|press|curl|extension|raise|row|deck|fly|kickback|crunch|shrug|abduction/i.test(n)) return table.machine_or_cable;
    } else if (/machine|cable|pulldown|press|curl|extension|raise|row|deck|fly|kickback|crunch|shrug|abduction/i.test(n)) {
      return asNumber(table.default, 2.5);
    }
    return asNumber(table.default, 2.5);
  }

  function prefillWeight(prevWeightKg, increment){
    if (prevWeightKg == null || prevWeightKg === '' || !isFinite(+prevWeightKg)) return null;
    const inc = increment == null || !isFinite(+increment) ? 0 : +increment;
    return round2(+prevWeightKg + inc);
  }

  function prefillReps(prevReps, repRange){
    if (prevReps != null && prevReps !== '' && isFinite(+prevReps)) return +prevReps;
    if (repRange && repRange.length && repRange[0] != null) return repRange[0];
    return null;
  }

  function weekBannerVisible(settings){
    settings = settings || {};
    return !settings.currentWeek && !settings.dismissWeekBanner;
  }

  function gapKey(gap){
    if (gap && typeof gap === 'object' && gap.key) return gap.key;
    const text = String(gap && gap.text != null ? gap.text : gap);
    if (/back-fill\?/.test(text)) return 'backfill';
    return 'text:' + text;
  }

  function gapText(gap){
    return gap && typeof gap === 'object' && gap.text != null ? String(gap.text) : String(gap);
  }

  function dismissedKeySet(settings){
    const dismissed = {};
    ((settings && settings.dismissedGapKeys) || []).forEach(function(k){ dismissed[k] = true; });
    if (settings && settings.dismissBackfillBanner) dismissed.backfill = true;
    return dismissed;
  }

  function visibleGaps(gaps, settings){
    const dismissed = dismissedKeySet(settings);
    return (gaps || []).filter(function(g){ return !dismissed[gapKey(g)]; });
  }

  function dismissedGapKeys(gaps, settings){
    const keys = dismissedKeySet(settings);
    (gaps || []).forEach(function(g){ keys[gapKey(g)] = true; });
    return Object.keys(keys);
  }

  return {parseDecimal, incrementKg, prefillWeight, prefillReps, weekBannerVisible, visibleGaps, gapKey, gapText, dismissedGapKeys};
});
