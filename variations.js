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

  return {norm, isRealName, variationsFor, codeFor, rememberedName, lastWeight};
});
