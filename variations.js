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
    ['substitution1','substitution2'].forEach(function(field, i){
      const raw = exercise[field];
      if (!isRealName(raw)) return;
      const name = String(raw).trim();
      if (out.some(function(v){ return norm(v.name)===norm(name); })) return;
      out.push({code: i===0 ? 'sub1' : 'sub2', name: name});
    });
    return out;
  }

  function codeFor(exercise, performedName){
    const list = variationsFor(exercise);
    const hit = list.find(function(v){ return norm(v.name)===norm(performedName); });
    if (hit) return hit.code;
    if (!isRealName(performedName) || (exercise && norm(performedName)===norm(exercise.name))) return 'none';
    return 'custom';
  }

  function rememberedName(exercise, previousEntry, remember){
    const planned = exercise && isRealName(exercise.name) ? String(exercise.name).trim() : '';
    if (remember === false) return planned;
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

  return {norm, isRealName, variationsFor, codeFor, rememberedName, lastWeight, variationOf, workingSetsFor, lastExposure};
});
