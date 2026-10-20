/* Listed program substitutions and per-variation identity.
   "See Notes" and blank names are not real alternatives. History matches the performed name only. */
(function(root, factory){
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MinMaxVariations = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  function norm(s){
    return String(s||'').toLowerCase().replace(/\(.*?\)/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  }

  function isRealName(name){
    const n = String(name||'').trim();
    if (!n) return false;
    if (/^see notes$/i.test(n)) return false;
    if (/^n\/a$/i.test(n)) return false;
    if (n === '-' || n === '—' || n === 'none') return false;
    return true;
  }

  function variationsFor(exercise){
    if (!exercise || !isRealName(exercise.name)) return [];
    const out = [{code:'none', name:String(exercise.name).trim()}];
    for (let i = 1; i <= 6; i++) {
      const raw = exercise['substitution'+i];
      if (!isRealName(raw)) continue;
      const name = String(raw).trim();
      if (out.some(function(v){ return norm(v.name)===norm(name); })) continue;
      out.push({code: 'sub'+i, name: name});
    }
    return out;
  }

  function codeFor(exercise, performedName){
    const list = variationsFor(exercise);
    const hit = list.find(function(v){ return norm(v.name)===norm(performedName); });
    if (hit) return hit.code;
    if (!isRealName(performedName) || (exercise && norm(performedName)===norm(exercise.name))) return 'none';
    return 'custom';
  }

  function memoryKey(dayId, exerciseId){
    return String(dayId || '') + ':' + String(exerciseId || '');
  }

  /* Explicit choice for this day + slot. The planned name is a real value: it means the swap was reset. */
  function variationChoice(memory, dayId, exerciseId){
    if (!memory || !dayId || !exerciseId) return null;
    const value = memory[memoryKey(dayId, exerciseId)];
    return isRealName(value) ? String(value).trim() : null;
  }

  function rememberVariation(memory, dayId, exerciseId, performedName, plannedName){
    const next = Object.assign({}, memory || {});
    const key = memoryKey(dayId, exerciseId);
    if (!dayId || !exerciseId) return next;
    const name = isRealName(performedName) ? String(performedName).trim() : (isRealName(plannedName) ? String(plannedName).trim() : '');
    if (!name) delete next[key];
    else next[key] = name;
    return next;
  }

  function rememberedName(exercise, previousEntry, remember, explicitName){
    const planned = exercise && isRealName(exercise.name) ? String(exercise.name).trim() : '';
    if (remember === false) return planned;
    if (isRealName(explicitName)) return String(explicitName).trim();
    const performed = previousEntry && previousEntry.performedExercise;
    if (!isRealName(performed)) return planned;
    return String(performed).trim();
  }

  /* Last working weight for this exact performed name. Other variations are ignored. */
  function lastWeight(records, performedName){
    const n = norm(performedName);
    let weight = null;
    (records || []).forEach(function(r){
      if (!r || norm(r.name)!==n || r.weight==null || r.weight==='') return;
      weight = +r.weight;
    });
    return weight==null || !isFinite(weight) ? null : weight;
  }

  /* A logged set keeps the name it was performed as. Older sets fall back to the entry name. */
  function variationOf(entry, set){
    const stamped = set && set.variation;
    if (isRealName(stamped)) return String(stamped).trim();
    const performed = entry && entry.performedExercise;
    return isRealName(performed) ? String(performed).trim() : '';
  }

  function byWhen(a, b){
    return ((a && a.date || '') + (a && a.startTime || '')).localeCompare((b && b.date || '') + (b && b.startTime || ''));
  }

  function workingSetsFor(entry, performedName){
    const n = norm(performedName);
    return ((entry && entry.sets) || []).filter(function(set){
      return set && set.setType === 'working' && set.weightKg != null && set.weightKg !== '' && norm(variationOf(entry, set)) === n;
    });
  }

  /* Last session's heaviest working weight for this variation only, plus that exposure's last reps. */
  function lastExposure(sessions, performedName, beforeDate){
    const list = (sessions || []).filter(function(s){
      return s && s.status !== 'skipped' && (!beforeDate || String(s.date || '') < beforeDate);
    }).sort(byWhen);
    let found = null;
    list.forEach(function(session){
      (session.entries || []).forEach(function(entry){
        const sets = workingSetsFor(entry, performedName);
        if (!sets.length) return;
        const nums = sets.map(function(set){ return +set.weightKg; }).filter(function(w){ return isFinite(w); });
        if (!nums.length) return;
        const last = sets[sets.length - 1];
        const reps = last.reps == null || last.reps === '' || !isFinite(+last.reps) ? null : +last.reps;
        found = {weight: Math.max.apply(null, nums), reps: reps, name: variationOf(entry, sets[sets.length - 1])};
      });
    });
    return found;
  }

  return {norm, isRealName, variationsFor, codeFor, memoryKey, variationChoice, rememberVariation, rememberedName, lastWeight, variationOf, workingSetsFor, lastExposure};
});
