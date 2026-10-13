/* Per-user offline cache. Never reads another account's key or the legacy shared key. */
(function(root, factory){
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MinMaxAccount = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  const LEGACY_KEY = 'minmax-tracker-v1';

  function cacheKey(userId){
    return 'minmax-tracker-v1:' + userId;
  }

  function blankTracker(){
    return {
      version: 1,
      settings: {currentWeek:null, anchorDate:null, nextDayOverride:null, nextDayPinned:false, defaultTime:'12:00'},
      sessions: [],
      measurements: [],
      baselineBests: [],
      seeded: false
    };
  }

  function readScoped(storage, userId){
    if (!storage || !userId) return null;
    try {
      const raw = storage.getItem(cacheKey(userId));
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data && data.version) return data;
    } catch (e) {}
    return null;
  }

  function writeScoped(storage, userId, data){
    if (!storage || !userId || !data) return;
    storage.setItem(cacheKey(userId), JSON.stringify(data));
  }

  /* remoteError: the account row could not be read, so an empty local tracker must not be uploaded. */
  function loadDecision(remote, scopedLocal, remoteError){
    if (remoteError) {
      if (scopedLocal && scopedLocal.version) return {data: scopedLocal, source: 'local', upload: false};
      return {data: blankTracker(), source: 'blank', upload: false};
    }
    if (remote && remote.version) return {data: remote, source: 'remote', upload: false};
    if (scopedLocal && scopedLocal.version) return {data: scopedLocal, source: 'local', upload: true};
    return {data: blankTracker(), source: 'blank', upload: true};
  }

  function canPush(activeUserId, scheduledUserId){
    return !!activeUserId && activeUserId === scheduledUserId;
  }

  return {LEGACY_KEY, cacheKey, blankTracker, readScoped, writeScoped, loadDecision, canPush};
});
