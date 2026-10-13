/* Next training day from the split sequence, not the calendar weekday.
   Rest slots are skipped. Skipped sessions do not count as completed. */
(function(root, factory){
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MinMaxNext = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  const FALLBACK = ['upper1','lower1','upper2','lower2','armsDelts'];

  function trainingDays(split){
    const seq = (split || []).map(function(slot){ return slot && slot.dayId; }).filter(function(id){ return id && id !== 'rest'; });
    return seq.length ? seq : FALLBACK.slice();
  }

  function byWhen(a, b){
    return ((a.date || '') + (a.startTime || '')).localeCompare((b.date || '') + (b.startTime || ''));
  }

  function hasWork(session){
    return (session.entries || []).some(function(entry){
      return (entry.sets || []).some(function(set){
        return set && set.weightKg != null && set.weightKg !== '' && set.setType !== 'warmup';
      });
    });
  }

  function nextAfter(seq, dayId){
    const i = seq.indexOf(dayId);
    if (i < 0) return seq[0];
    return seq[(i + 1) % seq.length];
  }

  function suggestedDay(split, sessions, today, settings){
    const seq = trainingDays(split);
    settings = settings || {};
    sessions = sessions || [];
    if (settings.nextDayPinned && seq.indexOf(settings.nextDayOverride) >= 0) return settings.nextDayOverride;

    const cmp = byWhen;
    const trained = sessions.filter(function(s){
      return s && s.status !== 'skipped' && seq.indexOf(s.dayId) >= 0 && hasWork(s);
    }).sort(cmp);
    const last = trained.length ? trained[trained.length - 1] : null;
    const computed = last ? (last.date === today ? last.dayId : nextAfter(seq, last.dayId)) : seq[0];

    const todayOpen = sessions.filter(function(s){
      return s && s.date === today && s.status !== 'skipped' && s.dayId === computed;
    }).sort(cmp).pop();
    if (todayOpen) return todayOpen.dayId;
    if (last && last.date === today) return last.dayId;
    return computed;
  }

  return { trainingDays: trainingDays, suggestedDay: suggestedDay, nextAfter: nextAfter };
});
