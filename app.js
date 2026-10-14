/* Min-Max Tracker — static SPA, Supabase sync + localStorage offline cache. */
(function(){
'use strict';
const SPEC = window.MINMAX_SPEC;
const P = SPEC.program;
const AC = window.MinMaxAccount;
const PF = window.MinMaxPrefill;
const SEQ = MinMaxNext.trainingDays(P.weeklySplit);
const DAY_LABEL = {upper1:'Upper 1',lower1:'Lower 1',upper2:'Upper 2',lower2:'Lower 2',armsDelts:'Arms + Delts'};
const MUSCLE_LABEL = m => m.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
const $ = (s,el=document)=>el.querySelector(s);
const esc = s => String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id'+Date.now()+Math.random().toString(16).slice(2));
const pad = n => String(n).padStart(2,'0');
const iso = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const todayISO = () => iso(new Date());
const parseD = s => { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); };
const addDays = (s,n) => { const d=parseD(s); d.setDate(d.getDate()+n); return iso(d); };
const mondayOf = s => { const d=parseD(s); const wd=(d.getDay()+6)%7; d.setDate(d.getDate()-wd); return iso(d); };
const daysBetween = (a,b) => Math.round((parseD(b)-parseD(a))/864e5);
const fmtD = s => parseD(s).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});
const num = v => (v===''||v==null||isNaN(+v)) ? null : +v;

/* ---------- exercise catalogue ---------- */
const exById = {};      // exerciseId -> base (week 2) row
Object.values(P.days['2']).flat().forEach(e => exById[e.exerciseId]=e);
const norm = s => String(s||'').toLowerCase().replace(/\(.*?\)/g,'').replace(/[^a-z0-9]+/g,' ').trim();
function findExIdByName(name){
  const n = norm(name);
  for (const id in exById) if (norm(exById[id].name)===n) return id;
  return null;
}
function prescription(week, dayId){
  const w = String(week && week>=1 && week<=12 ? week : 2);
  return (P.days[w] && P.days[w][dayId]) || [];
}
function weekInfo(w){ return P.weeks.find(x=>x.week===w) || null; }

/* ---------- state ---------- */
const SB_URL='https://ftoypdcokckdnrtxlnvj.supabase.co';
const SB_KEY='sb_publishable_KD0g-iX3A8zy1GxOtniXcg_hJ-eyi-e';
const sb = window.supabase.createClient(SB_URL, SB_KEY, {auth:{persistSession:true, autoRefreshToken:true, storage:window.localStorage, storageKey:'minmax-auth', detectSessionInUrl:true, flowType:'implicit'}});
let USER=null, syncT=null, syncState='', allowSync=false;
let S = null;
function blank(){ return AC.blankTracker(); }
function save(){
  if(!USER || !S) return;
  allowSync = true;
  AC.writeScoped(localStorage, USER.id, S);
  renderHeader();
  queueSync();
}
function queueSync(){
  if(!allowSync || !USER || !S) return;
  const userId = USER.id, payload = S;
  clearTimeout(syncT);
  syncT = setTimeout(() => pushFor(userId, payload), 1200);
}
async function pushFor(userId, payload){
  if(!AC.canPush(USER && USER.id, userId) || !payload) return;
  const {error}=await sb.from('tracker_data').upsert({user_id:userId, data:payload});
  if(!AC.canPush(USER && USER.id, userId)) return;
  syncState=error?'offline – will retry':'synced';
  if(error){ console.warn('sync failed',error.message); clearTimeout(syncT); syncT=setTimeout(()=>pushFor(userId, payload),15000); }
}
window.addEventListener('online', ()=>queueSync());
async function loadRemote(){
  const userId = USER.id;
  const {data,error}=await sb.from('tracker_data').select('data').eq('user_id',userId).maybeSingle();
  if(!USER || USER.id!==userId) return;
  const scoped = AC.readScoped(localStorage, userId);
  const remote = !error && data && data.data;
  const decision = AC.loadDecision(remote, scoped, !!error);
  S = decision.data;
  allowSync = !(decision.source==='blank' && !decision.upload);
  if(decision.source!=='blank' || decision.upload) AC.writeScoped(localStorage, userId, S);
  syncState = error ? 'offline' : 'synced';
  if(error) toast('Offline – using local cache');
  if(decision.upload) await pushFor(userId, S);
}

/* ---------- program position ---------- */
function weekFor(date){
  const st = S.settings;
  if (!st.currentWeek || !st.anchorDate) return null;
  const w = st.currentWeek + Math.floor(daysBetween(mondayOf(st.anchorDate), mondayOf(date))/7);
  return Math.max(1, Math.min(12, w));
}
const sesWeek = s => s.weekOverride || weekFor(s.date);
function nextDay(){
  return MinMaxNext.suggestedDay(P.weeklySplit, S.sessions, todayISO(), S.settings);
}
const cmpSes = (a,b) => (a.date+a.startTime).localeCompare(b.date+b.startTime);

/* ---------- analytics helpers ---------- */
const workSets = en => en.sets.filter(x=>x.setType==='working' && num(x.weightKg)!=null);
const e1rm = (w,r,rir) => w*(1+((r||0)+(rir||0))/30);
function exposures(performedName, beforeDate){
  const n = norm(performedName), out=[];
  S.sessions.filter(s=>s.status!=='skipped' && (!beforeDate || s.date<beforeDate)).sort(cmpSes).forEach(s=>{
    s.entries.forEach(en=>{ if (norm(en.performedExercise)===n){ const ws=workSets(en); if (ws.length) out.push({ses:s, en, ws, week:sesWeek(s)}); }});
  });
  return out;
}
function increment(name, exercise){
  return PF.incrementKg(name, exercise, SPEC.progressionRules);
}
function targetFor(pid, week){
  if (!pid) return null;
  for (const d of SEQ){ const r = prescription(week, d).find(e=>e.exerciseId===pid); if (r) return r; }
  return exById[pid]||null;
}
/* Progression engine — returns {status, text, load, range} */
function progression(performedName, pid, beforeDate){
  const ex = exposures(performedName, beforeDate);
  const base = targetFor(pid, 2) || (pid?exById[pid]:null);
  const baseline = S.baselineBests.find(b=>norm(b.exercise)===norm(performedName));
  if (!ex.length){
    if (baseline){ const L = Array.isArray(baseline.loadKg)?baseline.loadKg[baseline.loadKg.length-1]:baseline.loadKg;
      return {status: baseline.status==='stalled'?'stall':'na', load:L, text:`Recent best ${fmtLoad(baseline)}${baseline.status==='stalled'?' — marked stalled: consider a substitution or check RIR honesty':''}. Log reps & RIR to start progression checks.`}; }
    return {status:'na', text:'No history yet — log reps and RIR to enable suggestions.'};
  }
  const range0 = base && base.repRange ? base.repRange.slice() : null;
  let extended=false, lastAction=null, prevLoad=null, prevReps=null, noGain=0, status='na', text='';
  ex.forEach((x,i)=>{
    const load = Math.max(...x.ws.map(s=>+s.weightKg));
    const totReps = x.ws.reduce((a,s)=>a+(+s.reps||0),0);
    const hasReps = x.ws.every(s=>num(s.reps)!=null);
    const deload = x.week===7;
    if (i>0){ const gain = load>prevLoad || (load===prevLoad && totReps>prevReps); noGain = gain?0:noGain+1; }
    prevLoad=load; prevReps=totReps;
    if (deload){ status='deload'; text='Deload week — no progression check.'; return; }
    if (!hasReps || !range0){ status='na'; text='Reps not logged for last session — suggestion unavailable.'; return; }
    const tgt = targetFor(pid, x.week || 2);
    const rirT = [tgt?tgt.rirSet1:null, tgt?tgt.rirSet2:null];
    const maxR = range0[1] + (extended?2:0);
    const allTop = x.ws.every(s=>+s.reps>=maxR);
    const rirOk = x.ws.every((s,j)=>{ const t=rirT[Math.min(j,1)]; return num(s.rir)==null || t==null || +s.rir<=t; });
    const below = x.ws.some(s=>+s.reps<range0[0]);
    if (allTop && rirOk){ status='add'; lastAction='add'; extended=false; }
    else if (lastAction==='add' && below){ status='hold'; extended=true; lastAction='hold'; }
    else { status='reps'; if (lastAction==='add') lastAction='after-add'; }
    x._load=load;
  });
  const last = ex[ex.length-1]; const L = Math.max(...last.ws.map(s=>+s.weightKg));
  const inc = increment(performedName, pid && exById[pid]);
  const rng = range0 ? `${range0[0]}–${range0[1]+(extended?2:0)}` : '';
  if (status==='add') text = `All working sets hit the top of the range at target RIR → add load: try ${inc?fmt(L+inc)+' kg':'the next stack step above '+fmt(L)+' kg'}.`;
  else if (status==='hold') text = `Reps fell below range after the load jump → keep ${fmt(L)} kg; rep range extended to ${rng} until all sets reach it.`;
  else if (status==='reps') text = `Keep ${fmt(L)} kg and add reps (target ${rng} reps).`;
  if (noGain>=3 && status!=='deload'){ status='stall'; text = `No load/rep gain for 3 exposures at ~${fmt(L)} kg — flagged stalled. Options: check RIR honesty, try sub 1/sub 2, review sleep/recovery.`; }
  return {status, text, load:L, range:rng, extended};
}
const fmt = n => (Math.round(n*100)/100).toString();
const fmtLoad = b => (Array.isArray(b.loadKg)?b.loadKg.join('→'):b.loadKg)+' kg'+(b.perSide?' /side':'')+(b.reps?' × '+b.reps:'')+(b.approx?' (≈)':'');

/* ---------- UI shell ---------- */
let tab = 'log';
const ui = { date: todayISO(), dayId: null, progEx: null, focusId: null, pad: {}, edit: null, restUntil: 0, restTotal: 0, restLabel: '', undo: null, _hold: null, logging: false, homeDay: null };
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{ tab=b.dataset.tab; document.querySelectorAll('.tabs button').forEach(x=>x.classList.toggle('active',x===b)); render(); scrollTo(0,0); });
function toast(m, opts){
  const t=$('#toast');
  t.replaceChildren();
  const span=document.createElement('span');
  span.textContent=m;
  t.appendChild(span);
  if(opts && opts.undo){
    const b=document.createElement('button');
    b.type='button';
    b.className='toast-undo';
    b.textContent='Undo';
    b.onclick=ev=>{ ev.stopPropagation(); const fn=opts.undo; t.classList.remove('show'); fn(); };
    t.appendChild(b);
  }
  t.classList.add('show');
  clearTimeout(t._h);
  t._h=setTimeout(()=>t.classList.remove('show'), opts&&opts.undo?5000:1600);
}
function renderHeader(){
  const w = weekFor(todayISO()); const wi = w&&weekInfo(w);
  const h=$('#hdrWeek'); h.textContent = w ? `Wk ${w}${wi.deload?' · deload':wi.intro?' · intro':''}` : 'Week ?'; h.className='pill'+(w?'':' warn');
  $('#hdrNext').textContent = 'Next: '+DAY_LABEL[nextDay()];
}
function render(){
  renderHeader();
  charts.forEach(c=>c.destroy()); charts=[];
  const gym = tab==='log' && !!ui.logging;
  document.body.classList.toggle('tab-log', gym);
  if(!gym){
    document.body.classList.remove('resting');
    document.body.style.paddingBottom='';
    const t=$('#toast'); if(t) t.style.bottom='';
  }
  ({log:renderLog,history:renderHistory,progress:renderProgress,settings:renderSettings})[tab]();
  if(tab!=='log') keepAwake(false);
}
let charts=[];
let wakeLock=null;
async function keepAwake(on){
  try{
    if(!('wakeLock' in navigator)) return;
    if(on){
      if(wakeLock) return;
      wakeLock=await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', ()=>{ wakeLock=null; });
    } else if(wakeLock){
      const held=wakeLock; wakeLock=null; await held.release();
    }
  }catch(e){}
}
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState==='visible' && tab==='log') keepAwake(true);
});
if(!window._minmaxHoldStop){
  window._minmaxHoldStop=()=>{ if(ui._hold){ clearTimeout(ui._hold.delay); clearInterval(ui._hold.iv); ui._hold=null; } };
  window.addEventListener('pointerup', window._minmaxHoldStop);
  window.addEventListener('pointercancel', window._minmaxHoldStop);
}
window.addEventListener('resize', ()=>{ if(tab==='log' && ui.logging) fitDock(); });

/* ---------- LOG view ---------- */
function getSession(date, dayId, create){
  let s = S.sessions.find(x=>x.date===date && x.dayId===dayId && x.status!=='skipped');
  if (!s && create){
    s = {id:uid(), date, startTime:S.settings.defaultTime||'12:00', weekOverride:null, dayId, durationMin:null, soreness:null, energy:null, bodyweightKg:null, status:'completed', skipReason:null, loggedLate: date<todayISO(), notes:null, entries:[], _draft:true};
  }
  return s;
}
function ensureEntries(s){
  const rows = prescription(sesWeek(s), s.dayId);
  rows.forEach(r=>{
    if (!s.entries.some(e=>e.plannedExerciseId===r.exerciseId)){
      const prev = lastEntryFor(r.exerciseId, s.date);
      const performed = prev && prev.substitutionUsed!=='none' && S.settings.stickySubs ? prev.performedExercise : r.name;
      s.entries.push(newEntry(r, performed, s));
    }
  });
  const order = rows.map(r=>r.exerciseId);
  s.entries.sort((a,b)=>{ const ia=order.indexOf(a.plannedExerciseId), ib=order.indexOf(b.plannedExerciseId); return (ia<0?99:ia)-(ib<0?99:ib); });
}
function newEntry(r, performed, s){
  const sets=[]; const n = r? r.workingSets : 2;
  for (let i=0;i<n;i++) sets.push({setType:'working',techniqueCode:null,weightKg:null,perSide:false,reps:null,rir:null,durationSec:null,notes:null});
  return {id:uid(), plannedExerciseId:r?r.exerciseId:null, plannedName:r?r.name:null, performedExercise:performed, substitutionUsed: r && performed!==r.name ? (performed===r.substitution1?'sub1':performed===r.substitution2?'sub2':'custom') : (r?'none':'custom'), substitutionReason:null, cutShort:false, discomfort:null, notes:null, sets};
}
function lastEntryFor(pid, before){
  const ss = S.sessions.filter(s=>s.date<before).sort(cmpSes).reverse();
  for (const s of ss){ const e=s.entries.find(e=>e.plannedExerciseId===pid); if (e) return e; }
  return null;
}
function commit(s){ if (s._draft){ delete s._draft; S.sessions.push(s); } save(); }
let keepScroll=false;
let restTick=null;
function nowHHMM(){ const d=new Date(); return pad(d.getHours())+':'+pad(d.getMinutes()); }
function fmtClock(sec){ sec=Math.max(0,sec|0); return Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0'); }
function plateStep(name){ const n=increment(name); return n||2.5; }
function prescriptionRow(s,e){
  if(!e || !e.plannedExerciseId) return null;
  return prescription(sesWeek(s), s.dayId).find(x=>x.exerciseId===e.plannedExerciseId)||null;
}
function workingLogged(e){ return e.sets.filter(x=>x.setType==='working' && num(x.weightKg)!=null).length; }
function workingTarget(e,s){ const r=prescriptionRow(s,e); return r?r.workingSets:2; }
function savedSession(date, dayId){ return S.sessions.find(x=>x.date===date && x.dayId===dayId && x.status!=='skipped')||null; }
function progressOf(s){
  const rows=prescription(sesWeek(s)||2, s.dayId);
  let done=0, total=0;
  const seen={};
  rows.forEach(r=>{
    total+=r.workingSets; seen[r.exerciseId]=1;
    const en=s.entries.find(e=>e.plannedExerciseId===r.exerciseId);
    if(en) done+=workingLogged(en);
  });
  s.entries.forEach(e=>{ if(e.plannedExerciseId && seen[e.plannedExerciseId]) return; total+=2; done+=workingLogged(e); });
  return {done, total};
}
function firstIncomplete(s){ return s.entries.find(e=>workingLogged(e)<workingTarget(e,s))||s.entries[0]||null; }
function blankSet(type, tech, perSide){
  return {setType:type, techniqueCode:tech||null, weightKg:null, perSide:!!perSide, reps:null, rir:null, durationSec:null, notes:null};
}
function previousLoad(name, beforeDate){
  const prev=exposures(name, beforeDate).pop();
  if(prev && prev.ws.length) return Math.max(...prev.ws.map(x=>+x.weightKg));
  const baseline=S.baselineBests.find(b=>norm(b.exercise)===norm(name));
  if(!baseline) return null;
  const L=Array.isArray(baseline.loadKg)?baseline.loadKg[baseline.loadKg.length-1]:baseline.loadKg;
  return num(L);
}
function previousReps(name, beforeDate){
  const prev=exposures(name, beforeDate).pop();
  const prevWs=prev&&prev.ws.length?prev.ws[prev.ws.length-1]:null;
  if(prevWs && num(prevWs.reps)!=null) return +prevWs.reps;
  const baseline=S.baselineBests.find(b=>norm(b.exercise)===norm(name));
  if(baseline && num(baseline.reps)!=null) return +baseline.reps;
  return null;
}
function suggestedPad(s,e){
  const r=prescriptionRow(s,e);
  const logged=e.sets.filter(x=>x.setType==='working' && num(x.weightKg)!=null);
  const lastThis=logged.length?logged[logged.length-1]:null;
  const exercise=e.plannedExerciseId?exById[e.plannedExerciseId]:null;
  const inc=increment(e.performedExercise, exercise);
  const weight=lastThis?+lastThis.weightKg:PF.prefillWeight(previousLoad(e.performedExercise, s.date), inc);
  const reps=lastThis && num(lastThis.reps)!=null ? +lastThis.reps : PF.prefillReps(previousReps(e.performedExercise, s.date), r && r.repRange);
  let rir=null;
  const done=logged.length;
  if(r) rir=done===0?r.rirSet1:(r.rirSet2!=null?r.rirSet2:r.rirSet1);
  else if(lastThis && num(lastThis.rir)!=null) rir=+lastThis.rir;
  return {weightKg:weight, reps, rir};
}
function padOf(s,e){ if(!ui.pad[e.id]) ui.pad[e.id]=suggestedPad(s,e); return ui.pad[e.id]; }
function logCopy(s,e){
  const p=padOf(s,e);
  const done=workingLogged(e), tgt=workingTarget(e,s);
  const w=num(p.weightKg), reps=num(p.reps);
  const load=(w==null?'Set weight':fmt(w)+' kg')+(reps==null?'':' × '+fmt(reps));
  if(ui.edit && ui.edit.eid===e.id) return {kick:'Editing this set', main:'Update '+load};
  if(done>=tgt) return {kick:'Target met', main:'Log another · '+load};
  return {kick:'Set '+(done+1)+' of '+tgt, main:'Log '+load};
}
function syncLogBtn(s,e){
  const copy=logCopy(s,e);
  const kick=$('#logKick'), main=$('#logMain');
  if(kick) kick.textContent=copy.kick;
  if(main) main.textContent=copy.main;
}
function bumpPad(s,e,key,dir){
  const p=padOf(s,e);
  const step=key==='weightKg'?plateStep(e.performedExercise):1;
  let cur=num(p[key]); if(cur==null) cur=0;
  let next=Math.round((cur+dir*step)*100)/100;
  if(next<0) next=0;
  if(key==='reps') next=Math.min(100, next);
  if(key==='rir') next=Math.min(10, next);
  if(key==='weightKg') next=Math.min(500, next);
  p[key]=next;
  const inp=document.querySelector('[data-pad="'+key+'"]');
  if(inp) inp.value=fmt(next);
  syncLogBtn(s,e);
}
function ensureRestTick(){
  if(restTick) return;
  restTick=setInterval(()=>{
    const left=Math.ceil((ui.restUntil-Date.now())/1000);
    const el=document.getElementById('restTime');
    const bar=document.getElementById('restBar');
    if(left<=0){
      clearInterval(restTick); restTick=null;
      document.body.classList.remove('resting');
      if(bar) bar.remove();
      fitDock();
      try{ navigator.vibrate&&navigator.vibrate([200,100,200]); }catch(err){}
      return;
    }
    if(el) el.textContent=fmtClock(left);
  },250);
}
function fitDock(){
  const dock=document.querySelector('.dock');
  if(!dock) return;
  const fixed=getComputedStyle(dock).position==='fixed';
  const toastEl=$('#toast');
  if(!fixed){ document.body.style.paddingBottom=''; if(toastEl) toastEl.style.bottom=''; return; }
  const nav=document.querySelector('.tabs');
  const navH=nav && getComputedStyle(nav).display!=='none'?nav.offsetHeight:0;
  document.body.style.paddingBottom=(dock.offsetHeight+navH+8)+'px';
  if(toastEl) toastEl.style.bottom=(dock.offsetHeight+navH+12)+'px';
}
function findUndoSession(u){ return S.sessions.find(x=>x.date===u.date && x.dayId===u.dayId && x.status!=='skipped'); }
function applyUndo(){
  const u=ui.undo; if(!u) return;
  const s=findUndoSession(u);
  ui.undo=null;
  if(!s){ toast('Nothing to undo'); return; }
  const e=s.entries.find(x=>x.id===u.eid);
  if(!e){ toast('Nothing to undo'); return; }
  if(u.kind==='insert') e.sets.splice(u.idx,1);
  else if(u.kind==='fill') e.sets[u.idx]=u.prev;
  else if(u.kind==='delete') e.sets.splice(u.idx,0,u.set);
  ui.focusId=e.id; ui.edit=null; ui.restUntil=0; ui.logging=true; ui.date=s.date; ui.dayId=s.dayId;
  save();
  keepScroll=true;
  if(tab!=='log'){ tab='log'; document.querySelectorAll('.tabs button').forEach(x=>x.classList.toggle('active', x.dataset.tab==='log')); }
  render();
  toast('Undone');
}
function flashNeedWeight(){
  const el=document.querySelector('.stepper.weight');
  if(el){ el.classList.remove('need'); void el.offsetWidth; el.classList.add('need'); }
  toast('Set a weight');
}
function doLog(s,e,type){
  const p=padOf(s,e);
  const w=num(p.weightKg);
  if(w==null){ flashNeedWeight(); return; }
  const reps=num(p.reps);
  const rir=num(p.rir);
  const perSide=e.sets.some(x=>x.perSide);
  const rr=targetFor(e.plannedExerciseId, sesWeek(s));
  if(ui.edit && ui.edit.eid===e.id && type==='working'){
    const idx=ui.edit.idx;
    const prev=Object.assign({}, e.sets[idx]);
    const setType=prev.setType||'working';
    Object.assign(e.sets[idx], {weightKg:w, reps, rir:setType==='warmup'?null:rir});
    ui.undo={kind:'fill', date:s.date, dayId:s.dayId, eid:e.id, idx, prev};
    ui.edit=null;
    commit(s);
    toast('Set updated', {undo:applyUndo});
    keepScroll=true; renderLog(); return;
  }
  if(type==='working'){
    let idx=e.sets.findIndex(x=>x.setType==='working' && num(x.weightKg)==null);
    let kind='fill';
    if(idx<0){ e.sets.push(blankSet('working', null, perSide)); idx=e.sets.length-1; kind='insert'; }
    const prev=Object.assign({}, e.sets[idx]);
    Object.assign(e.sets[idx], {weightKg:w, reps, rir, perSide});
    ui.undo={kind, date:s.date, dayId:s.dayId, eid:e.id, idx, prev};
    commit(s);
    const r=prescriptionRow(s,e);
    const done=workingLogged(e), tgt=workingTarget(e,s);
    if(r && r.rest){
      const sec=Math.round(r.rest.minMinutes*60);
      ui.restUntil=Date.now()+sec*1000; ui.restTotal=sec; ui.restLabel=e.performedExercise;
      ensureRestTick();
    }
    if(done>=tgt){
      const next=s.entries.find(en=>en.id!==e.id && workingLogged(en)<workingTarget(en,s));
      if(next) ui.focusId=next.id;
    } else if(r){
      const p2=padOf(s,e);
      const nextIdx=workingLogged(e);
      p2.rir=nextIdx===0?r.rirSet1:(r.rirSet2!=null?r.rirSet2:r.rirSet1);
    }
    try{ navigator.vibrate&&navigator.vibrate(15); }catch(err){}
    toast('Set logged', {undo:applyUndo});
    keepScroll=true; renderLog(); return;
  }
  const ns=blankSet(type, type==='technique'?(rr&&rr.intensityTechniqueCode)||null:null, perSide);
  ns.weightKg=w; ns.reps=reps; ns.rir=type==='technique'?rir:null;
  let idx;
  if(type==='warmup'){ const k=e.sets.findIndex(y=>y.setType!=='warmup'); idx=k<0?e.sets.length:k; e.sets.splice(idx,0,ns); }
  else { e.sets.push(ns); idx=e.sets.length-1; }
  ui.undo={kind:'insert', date:s.date, dayId:s.dayId, eid:e.id, idx};
  commit(s);
  toast(type==='warmup'?'Warm-up logged':'Technique set logged', {undo:applyUndo});
  keepScroll=true; renderLog();
}
function finishWorkout(s){
  commit(s);
  if(S.settings){ S.settings.nextDayPinned=false; S.settings.nextDayOverride=null; }
  save();
  toast('Workout saved');
  ui.dayId=null; ui.focusId=null; ui.edit=null; ui.restUntil=0; ui.logging=false; ui.homeDay=null;
  render();
}
function startSession(dayId){
  ui.date=todayISO();
  ui.dayId=dayId;
  ui.homeDay=dayId;
  ui.focusId=null;
  ui.edit=null;
  const existing=savedSession(ui.date, dayId);
  const s=getSession(ui.date, dayId, true);
  ensureEntries(s);
  if(!existing) s.startTime=nowHHMM();
  commit(s);
  ui.logging=true;
  render();
}
function weekBannerHtml(){
  if(!PF.weekBannerVisible(S.settings)) return '';
  return `<div class="banner banner-row"><span>Program week not set. Suggestions use standard targets until you <a href="#" id="goSet" style="color:inherit">set your current week</a>.</span><button type="button" class="banner-x" id="dismissWeek">Dismiss</button></div>`;
}
function bindWeekBanner(){
  const g=$('#goSet'); if(g) g.onclick=ev=>{ ev.preventDefault(); document.querySelector('[data-tab=settings]').click(); };
  const d=$('#dismissWeek'); if(d) d.onclick=()=>{ S.settings.dismissWeekBanner=true; save(); render(); };
}
function shownGaps(){ return PF.visibleGaps(loggingGaps(), S.settings); }
function renderHome(){
  const v=$('#view');
  const planned=nextDay();
  const day=(ui.homeDay && SEQ.includes(ui.homeDay))?ui.homeDay:planned;
  ui.homeDay=day;
  const saved=savedSession(todayISO(), day);
  const w=weekFor(todayISO()), wi=w&&weekInfo(w);
  const rows=prescription(w||2, day);
  const prog=saved?progressOf(saved):null;
  const items=rows.map(r=>{
    const en=saved&&saved.entries.find(e=>e.plannedExerciseId===r.exerciseId);
    const done=en?workingLogged(en):0;
    const reps=r.repRange?r.repRange[0]+'–'+r.repRange[1]:'hold';
    return {name:en?en.performedExercise:r.name, done, tgt:r.workingSets, reps, on:done>=r.workingSets && done>0};
  });
  const showN=4;
  v.innerHTML=`
  ${weekBannerHtml()}
  <section class="card hero">
    <div class="hero-kicker">${saved?'In progress':'Next up'}</div>
    <h2 class="hero-title">${esc(DAY_LABEL[day])}</h2>
    <p class="hero-meta">${w?`Week ${w}${wi&&wi.deload?' · Deload':''}${wi&&wi.intro?' · Intro':''}`:'Week not set'} · ${rows.length} exercises${prog?` · ${prog.done}/${prog.total} sets`:''}${saved&&saved.startTime?` · ${esc(saved.startTime)}`:''}</p>
    ${day!==planned?`<p class="hero-note">Program next is ${esc(DAY_LABEL[planned])}</p>`:''}
    <ul class="preview">${items.slice(0,showN).map(it=>`<li class="${it.on?'on':''}"><span>${esc(it.name)}</span><span class="pv-sets">${it.done?it.done+'/':''}${it.tgt}× ${it.reps}</span></li>`).join('')}</ul>
    ${items.length>showN?`<div class="small muted" style="margin-top:6px">+${items.length-showN} more</div>`:''}
    <button type="button" class="btn pri start-btn" id="startBtn">${saved?'Continue '+esc(DAY_LABEL[day]):'Start '+esc(DAY_LABEL[day])}</button>
    <div class="switch-line"><span>Switch workout</span><div class="chips wrap">${SEQ.map(d=>`<button type="button" class="chip mini ${d===day?'on':''}" data-home-day="${d}">${esc(DAY_LABEL[d])}</button>`).join('')}</div></div>
  </section>`;
  bindWeekBanner();
  $('#startBtn').onclick=()=>startSession(day);
  v.querySelectorAll('[data-home-day]').forEach(b=>b.onclick=()=>{ ui.homeDay=b.dataset.homeDay; renderHome(); });
  const on=v.querySelector('[data-home-day].on');
  if(on && on.parentElement){ const p=on.parentElement; p.scrollLeft=Math.max(0, on.offsetLeft-16); }
  keepAwake(true);
}
function renderLog(){
  if(!ui.logging){ renderHome(); return; }
  const y=keepScroll?window.scrollY:0;
  keepScroll=false;
  const v=$('#view');
  if(!ui.dayId) ui.dayId=nextDay();
  const s=getSession(ui.date, ui.dayId, true);
  ensureEntries(s);
  if(!ui.focusId || !s.entries.some(e=>e.id===ui.focusId)){ const inc=firstIncomplete(s); ui.focusId=inc?inc.id:null; }
  if(ui.edit && !s.entries.some(e=>e.id===ui.edit.eid)) ui.edit=null;
  const e=s.entries.find(x=>x.id===ui.focusId)||null;
  const w=sesWeek(s), wi=w&&weekInfo(w);
  const late=ui.date<todayISO();
  const allDone=s.entries.length>0 && s.entries.every(en=>workingLogged(en)>=workingTarget(en,s));
  document.body.classList.toggle('resting', ui.restUntil>Date.now());
  const r=e?prescriptionRow(s,e):null;
  const pg=e?progression(e.performedExercise, e.plannedExerciseId, s.date):null;
  const prev=e?exposures(e.performedExercise, s.date).pop():null;
  const isRDL=e&&/rdl|romanian|deadlift/i.test((e.plannedName||'')+' '+e.performedExercise);
  const prevFlag=e&&isRDL&&S.sessions.some(x=>x.date<s.date && x.entries.some(y=>/rdl/i.test(y.performedExercise+(y.plannedName||'')) && y.discomfort));
  const tech=r&&r.intensityTechnique&&w>=8;
  const p=e?padOf(s,e):null;
  const perSide=e&&e.sets.some(x=>x.perSide);
  const copy=e?logCopy(s,e):{kick:'',main:'Log set'};
  const idx=e?s.entries.findIndex(x=>x.id===e.id):-1;
  const STATUS={add:'Add load',hold:'Hold weight',stall:'Stalled',reps:'Add reps',deload:'Deload'};
  let loggedHtml='';
  if(e){
    let wn=0;
    e.sets.forEach((x,j)=>{
      if(x.setType==='working' && num(x.weightKg)==null) return;
      const tag=x.setType==='warmup'?'Warm-up':x.setType==='technique'?'Tech':'Set '+(++wn);
      const editing=ui.edit&&ui.edit.eid===e.id&&ui.edit.idx===j;
      loggedHtml+=`<div class="logged-row${editing?' editing':''}"><button type="button" class="logged-main" data-editset="${j}"><span class="logged-tag">${tag}</span><span class="logged-val">${x.weightKg==null?'—':fmt(+x.weightKg)}×${x.reps==null?'—':fmt(+x.reps)}${x.perSide?' /side':''}${x.rir==null?'':' · '+fmt(+x.rir)+' RIR'}</span></button><button type="button" class="logged-x" data-delset="${j}" aria-label="Remove set">×</button></div>`;
    });
  }
  const wu=r?r.warmupSets:null;
  const pctTxt=(wu&&pg&&pg.load)?(SPEC.warmupProtocol.specificSetsPercentOfWorkingWeight[String(wu[1])]||[]).map(pc=>fmt(Math.round(pg.load*pc/100*2)/2)).join(' / ')+' kg':'';
  const restLeft=Math.ceil((ui.restUntil-Date.now())/1000);
  const restBlock=restLeft>0?`<div class="rest" id="restBar"><div class="rest-clock" id="restTime" aria-live="polite">${fmtClock(restLeft)}</div><div class="rest-meta"><b>Rest</b><span>${esc(ui.restLabel||'')}</span></div><button type="button" class="rest-btn" id="restPlus">+30s</button><button type="button" class="rest-btn" id="restSkip">Skip</button></div>`:'';
  v.innerHTML=`<div class="log-wrap">
  ${weekBannerHtml()}
  <div class="card context-card">
    <div class="row between"><button type="button" class="home-link" id="toHome">Home</button><span class="pill ${wi&&wi.deload?'warn':'blue'}">${w?`Wk ${w}`:'Wk ?'}</span></div>
    <div class="row between" style="margin-top:6px"><h2 style="margin:0">${late?'Back-fill':'Today'} · ${fmtD(ui.date)}</h2><span class="muted small">${esc(DAY_LABEL[s.dayId])}${s.startTime?' · '+esc(s.startTime):''}</span></div>
    <div class="chips" style="margin-top:8px">
      ${[0,-1,-2].map(o=>{const d=addDays(todayISO(),o);return `<button type="button" class="chip mini ${d===ui.date?'on':''}" data-date="${d}">${o===0?'Today':o===-1?'Yesterday':fmtD(d)}</button>`;}).join('')}
      <input type="date" class="date-pick" id="pickDate" value="${ui.date}" max="${todayISO()}">
    </div>
    ${late?`<div class="small muted" style="margin-top:6px">Past date — flagged logged late.</div>`:''}
  </div>
  <div class="rail" role="tablist">${s.entries.map((en,i)=>{
    const done=workingLogged(en), tgt=workingTarget(en,s), on=e&&en.id===e.id, complete=done>=tgt&&done>0;
    return `<button type="button" class="rail-btn ${on?'on':''} ${complete?'done':''}" data-focus="${en.id}" aria-label="${esc(en.performedExercise)}">${complete?'✓':i+1}<span class="rail-c">${done}/${tgt}</span></button>`;
  }).join('')}<button type="button" class="rail-btn add" id="addCustom" aria-label="Add exercise">+</button></div>
  ${e?`<div class="card logger">
    <div class="ex-nav">
      <button type="button" class="nav-arrow" id="exPrev" aria-label="Previous exercise">‹</button>
      <div><div class="ex-kicker">Exercise ${idx+1} of ${s.entries.length}${pg&&STATUS[pg.status]?` · ${STATUS[pg.status]}`:''}</div><div class="ex-name">${esc(e.performedExercise)}</div>
      ${e.substitutionUsed!=='none'&&e.plannedName?`<div class="ex-planned">swap for ${esc(e.plannedName)}</div>`:''}
      ${!e.plannedName?`<div class="ex-planned">extra</div>`:''}</div>
      <button type="button" class="nav-arrow" id="exNext" aria-label="Next exercise">›</button>
    </div>
    ${r?`<p class="meta-line">${r.workingSets} × ${r.repRange?r.repRange[0]+'–'+r.repRange[1]:'max hold'} · RIR ${r.rirSet1}${r.rirSet2!=null?'/'+r.rirSet2:''} · Rest ${r.rest.minMinutes}–${r.rest.maxMinutes} min</p>`:''}
    ${prev?`<p class="last-line small muted">Last ${fmtD(prev.ses.date)} · ${prev.ws.map(x=>fmt(+x.weightKg)+(x.reps!=null?'×'+x.reps:'')+(x.rir!=null?'@'+x.rir:'')).join(', ')}</p>`:''}
    ${prevFlag?`<div class="sugg hold">Low-back flag on this lift before. Swap below if you want a substitute.</div>`:''}
    <div class="steppers">
      <div class="stepper weight"><button type="button" class="step" data-inc="weightKg" data-dir="-1" aria-label="Decrease weight">−</button><label class="step-mid"><input inputmode="decimal" enterkeyhint="done" autocomplete="off" autocorrect="off" spellcheck="false" data-pad="weightKg" value="${p.weightKg==null?'':fmt(p.weightKg)}"><span class="unit">kg${perSide?' / side':''}</span></label><button type="button" class="step plus" data-inc="weightKg" data-dir="1" aria-label="Increase weight">+</button></div>
      <div class="stepper"><button type="button" class="step" data-inc="reps" data-dir="-1" aria-label="Decrease reps">−</button><label class="step-mid"><input inputmode="numeric" enterkeyhint="done" autocomplete="off" data-pad="reps" value="${p.reps==null?'':fmt(p.reps)}"><span class="unit">reps</span></label><button type="button" class="step plus" data-inc="reps" data-dir="1" aria-label="Increase reps">+</button></div>
      <div class="stepper"><button type="button" class="step" data-inc="rir" data-dir="-1" aria-label="Decrease RIR">−</button><label class="step-mid"><input inputmode="decimal" enterkeyhint="done" autocomplete="off" data-pad="rir" value="${p.rir==null?'':fmt(p.rir)}"><span class="unit">rir</span></label><button type="button" class="step plus" data-inc="rir" data-dir="1" aria-label="Increase RIR">+</button></div>
    </div>
    <div class="logged">${loggedHtml||'<p class="muted empty-sets">No sets yet. Set the numbers, then log.</p>'}</div>
    ${ui.edit&&ui.edit.eid===e.id?`<button type="button" class="btn ghost sm" id="cancelEdit" style="margin-top:8px">Cancel edit</button>`:''}
    <details class="more"><summary>Swap, warm-up, flags</summary>
      ${pg?`<div class="sugg ${pg.status==='hold'?'hold':pg.status==='stall'?'stall':pg.status==='add'?'':'info'}">${esc(pg.text)}</div>`:''}
      ${pctTxt?`<div class="small muted">Warm-up ladder: ${pctTxt}</div>`:''}
      ${w>=8?`<div class="small" style="margin-top:6px;color:#86198f">Block 2: last-set intensity techniques active.</div>`:''}
      ${r?`<div class="chips" data-subs style="margin-top:8px">
        <button type="button" class="chip mini sub ${e.substitutionUsed==='none'?'on':''}" data-sub="none">${esc(r.name)}</button>
        <button type="button" class="chip mini sub ${e.substitutionUsed==='sub1'?'on':''}" data-sub="sub1">${esc(r.substitution1)}</button>
        <button type="button" class="chip mini sub ${e.substitutionUsed==='sub2'?'on':''}" data-sub="sub2">${esc(r.substitution2)}</button>
        <button type="button" class="chip mini sub ${e.substitutionUsed==='custom'?'on':''}" data-sub="custom">${e.substitutionUsed==='custom'?'✎ '+esc(e.performedExercise):'Other…'}</button>
      </div>`:''}
      <div class="row" style="margin-top:8px">
        <button type="button" class="btn sm" id="wuBtn">Warm-up</button>
        ${tech?`<button type="button" class="btn sm" id="techBtn">${esc(r.intensityTechnique.split(' (')[0])}</button>`:''}
      </div>
      <div class="chips wrap" style="margin-top:8px">
        <button type="button" class="chip mini flag ${perSide?'on':''}" data-perside>Per side</button>
        <button type="button" class="chip mini flag ${e.cutShort?'on':''}" data-cut>Cut short</button>
        <button type="button" class="chip mini flag ${e.discomfort?'on':''}" data-disc>${isRDL?'Low-back flag':'Discomfort'}</button>
        <button type="button" class="chip mini ${e.notes?'on':''}" data-note>Note</button>
      </div>
      ${e.notes?`<div class="small muted" style="margin-top:6px">${esc(e.notes)}</div>`:''}
      ${e.discomfort?`<div class="small muted" style="margin-top:4px">Flag: ${esc(e.discomfort)}</div>`:''}
    </details>
  </div>`:''}
  <details class="card session-more"><summary>Session details</summary>
    <div class="grid3" style="margin-top:8px">
      <div><label>Start</label><input type="time" data-sf="startTime" value="${esc(s.startTime||'')}"></div>
      <div><label>Duration (min)</label><input inputmode="numeric" data-sf="durationMin" value="${s.durationMin??''}"></div>
      <div><label>Bodyweight kg</label><input inputmode="decimal" data-sf="bodyweightKg" value="${s.bodyweightKg??''}"></div>
    </div>
    <div class="grid2" style="margin-top:8px">
      <div><label>Soreness (1–5)</label><div class="chips" data-scale="soreness">${[1,2,3,4,5].map(n=>`<button type="button" class="chip mini ${s.soreness===n?'on':''}" data-n="${n}">${n}</button>`).join('')}</div></div>
      <div><label>Energy (1–5)</label><div class="chips" data-scale="energy">${[1,2,3,4,5].map(n=>`<button type="button" class="chip mini ${s.energy===n?'on':''}" data-n="${n}">${n}</button>`).join('')}</div></div>
    </div>
    <div class="grid2" style="margin-top:8px">
      <div><label>Week override</label><select data-sf="weekOverride"><option value="">Auto (${weekFor(s.date)||'?'})</option>${P.weeks.map(x=>`<option ${s.weekOverride===x.week?'selected':''}>${x.week}</option>`).join('')}</select></div>
      <div><label>Status</label><select data-sf="status">${['completed','partial'].map(x=>`<option ${s.status===x?'selected':''}>${x}</option>`).join('')}</select></div>
    </div>
    <div style="margin-top:8px"><label>Notes</label><textarea data-sf="notes">${esc(s.notes||'')}</textarea></div>
    <label class="row" style="margin-top:8px;color:var(--txt)"><input type="checkbox" data-sf="loggedLate" ${s.loggedLate?'checked':''} style="width:22px;min-height:22px"> Logged late</label>
    <div class="chips wrap" style="margin-top:10px">${SEQ.map(d=>`<button type="button" class="chip mini ${d===ui.dayId?'on':''}" data-day="${d}">${esc(DAY_LABEL[d])}</button>`).join('')}</div>
    <div class="end-row"><button type="button" class="btn" id="skipBtn">Mark skipped</button><button type="button" class="btn" id="finishBtn2">Finish workout</button></div>
  </details>
  <div class="dock">
    ${restBlock}
    ${allDone?`<button type="button" class="btn pri log-btn" id="finishBtn"><span class="log-kicker">All sets logged</span><span class="log-main">Finish workout</span></button>`:''}
    ${e?`<button type="button" class="btn ${allDone?'log-secondary':'pri'} log-btn" id="logBtn"><span class="log-kicker" id="logKick">${esc(copy.kick)}</span><span class="log-main" id="logMain">${esc(copy.main)}</span></button>`:''}
  </div>
  </div>`;
  bindLog(s,e);
  if(ui.restUntil>Date.now()) ensureRestTick();
  keepAwake(true);
  const railOn=v.querySelector('.rail-btn.on');
  if(railOn&&railOn.parentElement){ const p=railOn.parentElement; p.scrollLeft=Math.max(0, railOn.offsetLeft-(p.clientWidth-railOn.clientWidth)/2); }
  requestAnimationFrame(fitDock);
  window.scrollTo(0,y);
}
function bindLog(s,e){
  const v=$('#view');
  const touch=()=>{ commit(s); };
  bindWeekBanner();
  const home=$('#toHome'); if(home) home.onclick=()=>{ ui.logging=false; ui.restUntil=0; render(); scrollTo(0,0); };
  v.querySelectorAll('[data-date]').forEach(b=>b.onclick=()=>{ ui.date=b.dataset.date; ui.focusId=null; ui.edit=null; ui.pad={}; renderLog(); });
  const pick=$('#pickDate'); if(pick) pick.onchange=ev=>{ if(ev.target.value){ ui.date=ev.target.value; ui.focusId=null; ui.edit=null; ui.pad={}; renderLog(); } };
  v.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>{ ui.dayId=b.dataset.day; ui.homeDay=b.dataset.day; ui.focusId=null; ui.edit=null; ui.pad={}; const ex=savedSession(ui.date, ui.dayId); if(!ex && ui.date===todayISO()){ startSession(ui.dayId); return; } renderLog(); });
  v.querySelectorAll('[data-sf]').forEach(inp=>inp.onchange=()=>{
    const f=inp.dataset.sf; let val=inp.type==='checkbox'?inp.checked:inp.value;
    if(['durationMin','bodyweightKg','weekOverride'].includes(f)) val=num(val);
    s[f]=val; touch(); if(f==='weekOverride'){ keepScroll=true; renderLog(); }
  });
  v.querySelectorAll('[data-scale]').forEach(c=>c.querySelectorAll('[data-n]').forEach(b=>b.onclick=()=>{ const f=c.dataset.scale, n=+b.dataset.n; s[f]=s[f]===n?null:n; touch(); keepScroll=true; renderLog(); }));
  const add=$('#addCustom'); if(add) add.onclick=()=>{ const name=prompt('Extra exercise name:'); if(!name) return; const en=newEntry(null, name.trim(), s); s.entries.push(en); ui.focusId=en.id; touch(); renderLog(); };
  if(!e){ fitDock(); return; }
  const shift=dir=>{ const i=s.entries.findIndex(x=>x.id===e.id); const j=(i+dir+s.entries.length)%s.entries.length; ui.focusId=s.entries[j].id; ui.edit=null; renderLog(); };
  const prevB=$('#exPrev'); if(prevB) prevB.onclick=()=>shift(-1);
  const nextB=$('#exNext'); if(nextB) nextB.onclick=()=>shift(1);
  v.querySelectorAll('[data-focus]').forEach(b=>b.onclick=()=>{ ui.focusId=b.dataset.focus; ui.edit=null; renderLog(); });
  v.querySelectorAll('[data-inc]').forEach(b=>{
    b.addEventListener('pointerdown', ()=>{
      ui._heldBump=false;
      if(ui._hold){ clearTimeout(ui._hold.delay); clearInterval(ui._hold.iv); }
      const key=b.dataset.inc, dir=+b.dataset.dir;
      const delay=setTimeout(()=>{ ui._heldBump=true; const iv=setInterval(()=>bumpPad(s,e,key,dir),70); if(ui._hold) ui._hold.iv=iv; },380);
      ui._hold={delay, iv:null};
    });
    b.addEventListener('click', ()=>{ if(ui._heldBump){ ui._heldBump=false; return; } bumpPad(s,e,b.dataset.inc,+b.dataset.dir); });
  });
  v.querySelectorAll('[data-pad]').forEach(inp=>{
    inp.addEventListener('input', ()=>{ const p=padOf(s,e); p[inp.dataset.pad]=inp.value.trim()===''?null:num(inp.value); syncLogBtn(s,e); });
    inp.addEventListener('keydown', ev=>{ if(ev.key==='Enter'){ ev.preventDefault(); inp.blur(); } });
    inp.addEventListener('focus', ()=>{ try{ inp.select(); }catch(err){} });
    inp.addEventListener('blur', ()=>{ const p=padOf(s,e); const n=num(p[inp.dataset.pad]); if(n!=null) inp.value=fmt(n); });
  });
  const logBtn=$('#logBtn'); if(logBtn) logBtn.onclick=()=>doLog(s,e,'working');
  const wu=$('#wuBtn'); if(wu) wu.onclick=()=>doLog(s,e,'warmup');
  const tech=$('#techBtn'); if(tech) tech.onclick=()=>doLog(s,e,'technique');
  v.querySelectorAll('[data-editset]').forEach(b=>b.onclick=()=>{
    const idx=+b.dataset.editset; const x=e.sets[idx]; if(!x || num(x.weightKg)==null) return;
    ui.edit={eid:e.id, idx}; ui.pad[e.id]={weightKg:x.weightKg, reps:x.reps, rir:x.rir}; keepScroll=true; renderLog();
  });
  v.querySelectorAll('[data-delset]').forEach(b=>b.onclick=ev=>{
    ev.stopPropagation();
    const idx=+b.dataset.delset; const set=e.sets[idx];
    e.sets.splice(idx,1);
    ui.undo={kind:'delete', date:s.date, dayId:s.dayId, eid:e.id, idx, set};
    if(ui.edit && ui.edit.eid===e.id) ui.edit=null;
    commit(s); toast('Set removed', {undo:applyUndo}); keepScroll=true; renderLog();
  });
  const cancel=$('#cancelEdit'); if(cancel) cancel.onclick=()=>{ ui.edit=null; delete ui.pad[e.id]; keepScroll=true; renderLog(); };
  const exBase=e.plannedExerciseId?exById[e.plannedExerciseId]:null;
  v.querySelectorAll('[data-sub]').forEach(b=>b.onclick=async()=>{
    const k=b.dataset.sub; const r=exBase;
    if(k==='custom'){ const name=prompt('Exercise performed instead:', e.substitutionUsed==='custom'?e.performedExercise:''); if(!name) return; e.performedExercise=name.trim(); }
    else if(r) e.performedExercise=k==='none'?r.name:k==='sub1'?r.substitution1:r.substitution2;
    e.substitutionUsed=k;
    if(k!=='none' && !e.substitutionReason) e.substitutionReason=await pickReason();
    if(k==='none') e.substitutionReason=null;
    delete ui.pad[e.id]; ui.edit=null; touch(); keepScroll=true; renderLog();
    toast(k==='none'?'Back to planned exercise':'Swapped → '+e.performedExercise);
  });
  const ps=v.querySelector('[data-perside]'); if(ps) ps.onclick=()=>{ const on=!e.sets.some(x=>x.perSide); e.sets.forEach(x=>x.perSide=on); touch(); keepScroll=true; renderLog(); };
  const cut=v.querySelector('[data-cut]'); if(cut) cut.onclick=()=>{ e.cutShort=!e.cutShort; if(e.cutShort && s.status==='completed') s.status='partial'; touch(); keepScroll=true; renderLog(); };
  const disc=v.querySelector('[data-disc]'); if(disc) disc.onclick=()=>{ if(e.discomfort) e.discomfort=null; else { const where=prompt('Where / what? (saved as a note, e.g. "low back")', /rdl/i.test(e.performedExercise+(e.plannedName||''))?'low back':''); if(where===null) return; e.discomfort=where||'yes'; } touch(); keepScroll=true; renderLog(); };
  const note=v.querySelector('[data-note]'); if(note) note.onclick=()=>{ const n=prompt('Note for '+e.performedExercise, e.notes||''); if(n===null) return; e.notes=n.trim()||null; touch(); keepScroll=true; renderLog(); };
  const finish=fn=>{ if(fn) fn.onclick=()=>finishWorkout(s); };
  finish($('#finishBtn')); finish($('#finishBtn2'));
  const skip=$('#skipBtn'); if(skip) skip.onclick=async()=>{
    const reason=await pickReason(['soreness','illness','schedule','other'], 'Skip reason');
    if(!reason) return;
    const idx=S.sessions.indexOf(s); if(idx>=0 && !s.entries.some(en=>en.sets.some(x=>x.weightKg!=null))) S.sessions.splice(idx,1);
    S.sessions.push({id:uid(), date:ui.date, startTime:s.startTime||S.settings.defaultTime, weekOverride:null, dayId:ui.dayId, durationMin:null, soreness:null, energy:null, bodyweightKg:null, status:'skipped', skipReason:reason, loggedLate:ui.date<todayISO(), notes:null, entries:[]});
    save(); toast('Marked skipped ('+reason+')'); ui.logging=false; ui.homeDay=null; render();
  };
  fitDock();
}
function pickReason(opts=['equipment_unavailable','discomfort','preference','other'], title='Why swap? (optional)'){
  return new Promise(res=>{
    const d=$('#dlg');
    d.innerHTML=`<h3 style="margin-top:0">${title}</h3><div class="sets">${opts.map(o=>`<button class="btn" data-r="${o}">${o.replace(/_/g,' ')}</button>`).join('')}<button class="btn ghost" data-r="">Skip</button></div>`;
    d.querySelectorAll('[data-r]').forEach(b=>b.onclick=()=>{ d.close(); res(b.dataset.r||null); });
    d.showModal();
  });
}

/* ---------- HISTORY ---------- */
function renderHistory(){
  const v=$('#view'); const ss=[...S.sessions].sort(cmpSes).reverse();
  const gaps = shownGaps();
  v.innerHTML = `<div class="card"><div class="row between"><h2 style="margin:0">History</h2><button class="btn sm pri" id="bf">+ Back-fill a past day</button></div>
   ${gaps.length?`<div class="banner banner-row" style="margin-top:10px"><span>${gaps.length} possible logging gap(s): ${gaps.slice(0,3).map(g=>esc(PF.gapText(g))).join('; ')}</span><button type="button" class="banner-x" id="dismissGaps">Dismiss</button></div>`:''}</div>
   ${ss.map(s=>{ const w=sesWeek(s); const sets=s.entries.reduce((a,e)=>a+workSets(e).length,0);
     return `<div class="card"><div class="hist-item"><div><b>${DAY_LABEL[s.dayId]}</b> <span class="muted small">${fmtD(s.date)} · wk ${w||'?'}</span><br>
     <span class="badge ${s.status==='completed'?'b-add':s.status==='partial'?'b-hold':'b-stall'}">${s.status}${s.skipReason?' · '+s.skipReason:''}</span>
     ${s.loggedLate?'<span class="badge b-na">logged late</span>':''} ${s.entries.some(e=>e.discomfort)?'<span class="badge b-hold">discomfort</span>':''}
     <div class="small muted" style="margin-top:4px">${sets} working sets · ${s.entries.filter(e=>e.substitutionUsed!=='none').length} subs</div></div>
     <div class="row">${s.status!=='skipped'?`<button class="btn sm" data-open="${s.id}">Open</button>`:''}<button class="btn sm danger" data-del="${s.id}">Delete</button></div></div>
     ${s.entries.length?`<div class="small" style="margin-top:8px">${s.entries.map(e=>`${esc(e.performedExercise)}${e.cutShort?' ✂':''}: ${workSets(e).map(x=>fmt(+x.weightKg)+(x.reps!=null?'×'+x.reps:'')).join(', ')||'—'}`).join('<br>')}</div>`:''}
     </div>`}).join('')}`;
  $('#bf').onclick=()=>{ ui.date=addDays(todayISO(),-1); ui.dayId=null; ui.homeDay=null; ui.focusId=null; ui.edit=null; ui.logging=true; tab='log'; document.querySelector('[data-tab=log]').click(); };
  const db=$('#dismissGaps'); if(db) db.onclick=()=>{ S.settings.dismissedGapKeys=PF.dismissedGapKeys(loggingGaps(), S.settings); save(); renderHistory(); };
  v.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{ const s=S.sessions.find(x=>x.id===b.dataset.open); ui.date=s.date; ui.dayId=s.dayId; ui.homeDay=s.dayId; ui.focusId=null; ui.edit=null; ui.logging=true; document.querySelector('[data-tab=log]').click(); });
  v.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{ if(!confirm('Delete this session?')) return; S.sessions=S.sessions.filter(x=>x.id!==b.dataset.del); save(); renderHistory(); });
}
function loggingGaps(){
  const out=[];
  S.sessions.forEach(s=>{ if(s.status==='skipped') return;
    const missing=s.entries.filter(e=>!e.cutShort && e.plannedExerciseId && !workSets(e).length).length;
    const noReps=s.entries.some(e=>workSets(e).some(x=>x.reps==null));
    if (missing) out.push({key:s.id+':missing', text:`${fmtD(s.date)} ${DAY_LABEL[s.dayId]}: ${missing} exercise(s) without sets`});
    else if (noReps) out.push({key:s.id+':noreps', text:`${fmtD(s.date)} ${DAY_LABEL[s.dayId]}: reps/RIR missing`});
  });
  const dates = S.sessions.map(s=>s.date).sort(); const last=dates[dates.length-1];
  if (last && daysBetween(last, todayISO())>=3) out.unshift({key:'backfill', text:`nothing logged since ${fmtD(last)} — back-fill?`});
  return out;
}

/* ---------- PROGRESS ---------- */
function renderProgress(){
  const v=$('#view');
  const names = [...new Set(S.sessions.flatMap(s=>s.entries.filter(e=>workSets(e).length).map(e=>e.performedExercise)))].sort();
  if (!ui.progEx || !names.includes(ui.progEx)) ui.progEx = names[0];
  const weeks = [...new Set(S.sessions.map(s=>mondayOf(s.date)))].sort();
  if (!ui.volWeek) ui.volWeek = weeks[weeks.length-1] || mondayOf(todayISO());
  v.innerHTML = `
  <div class="card"><div class="row between"><h2 style="margin:0">Progress</h2>
    <select id="exSel" style="max-width:260px">${names.map(n=>`<option ${n===ui.progEx?'selected':''}>${esc(n)}</option>`).join('')}</select></div></div>
  <div class="charts">
    <div class="card"><h3>1 · Estimated 1RM trend</h3><div class="small muted">Epley w×(1+(reps+RIR)/30), top working set</div><div class="chartbox"><canvas id="c1"></canvas></div></div>
    <div class="card"><h3>2 · Top-set load & reps</h3><div class="chartbox"><canvas id="c2"></canvas></div></div>
    <div class="card"><h3>3 · Weekly hard sets per muscle vs target</h3>
      <div class="row small muted">Week of <select id="volW" style="width:auto;min-height:44px;padding:8px;font-size:16px">${weeks.map(w=>`<option value="${w}" ${w===ui.volWeek?'selected':''}>${fmtD(w)}</option>`).join('')}</select></div>
      <div class="small muted">Primary muscle = 1 set, others 0.5. <b>Targets are estimates</b> derived from the program layout.</div><div class="chartbox" style="height:320px"><canvas id="c3"></canvas></div></div>
    <div class="card"><h3>4 · PR feed</h3><ul class="feed" id="prFeed"></ul></div>
    <div class="card"><h3>5 · Adherence calendar</h3><div id="cal"></div></div>
    <div class="card"><h3>6 · RIR accuracy</h3><div class="small muted">Logged RIR − target RIR per working set (positive = left more in the tank)</div><div class="chartbox"><canvas id="c6"></canvas></div></div>
    <div class="card"><h3>7 · Substitution rate</h3><div class="chartbox"><canvas id="c7"></canvas></div></div>
    <div class="card"><h3>8 · Progression status</h3><div id="progTbl" style="max-height:320px;overflow:auto"></div></div>
    <div class="card"><h3>9 · Wellness</h3><div class="small muted">Soreness / energy (1–5), bodyweight, weekly working sets</div><div class="chartbox"><canvas id="c9"></canvas></div></div>
    <div class="card"><h3>10 · Logging gaps</h3><ul class="feed" id="gaps"></ul></div>
  </div>`;
  $('#exSel').onchange=ev=>{ui.progEx=ev.target.value; renderProgress();};
  const vw=$('#volW'); if (vw) vw.onchange=ev=>{ui.volWeek=ev.target.value; renderProgress();};
  Chart.defaults.color='#6b7280'; Chart.defaults.borderColor='#e5e7eb'; Chart.defaults.font.family='system-ui';
  const base={responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{boxWidth:12}}}};
  // 1 & 2
  const ex = ui.progEx ? exposures(ui.progEx) : [];
  const pts = ex.map(x=>{ const top = x.ws.reduce((a,s)=> e1rm(+s.weightKg,+s.reps,+s.rir) > e1rm(+a.weightKg,+a.reps,+a.rir) ? s : a); return {d:x.ses.date, e:e1rm(+top.weightKg, num(top.reps)||0, num(top.rir)||0), w:+top.weightKg, r:num(top.reps), hasReps:num(top.reps)!=null}; });
  const bl = S.baselineBests.find(b=>norm(b.exercise)===norm(ui.progEx||''));
  charts.push(new Chart($('#c1'),{type:'line',data:{labels:pts.map(p=>fmtD(p.d)),datasets:[{label:'e1RM kg',data:pts.map(p=>p.hasReps?+p.e.toFixed(1):null),borderColor:'#16a34a',backgroundColor:'#16a34a',tension:.3,spanGaps:true}]},options:{...base,plugins:{...base.plugins,subtitle:{display:!pts.some(p=>p.hasReps),text:'Log reps to compute e1RM',color:'#d97706'}}}}));
  charts.push(new Chart($('#c2'),{type:'line',data:{labels:pts.map(p=>fmtD(p.d)),datasets:[{label:'Top load kg',data:pts.map(p=>p.w),borderColor:'#2563eb',backgroundColor:'#2563eb',yAxisID:'y'},{label:'Reps',data:pts.map(p=>p.r),borderColor:'#c026d3',backgroundColor:'#c026d3',yAxisID:'y1',borderDash:[4,4]}].concat(bl?[{label:'Recent best',data:pts.map(()=>Array.isArray(bl.loadKg)?bl.loadKg[bl.loadKg.length-1]:bl.loadKg),borderColor:'#fbbf2488',pointRadius:0,borderDash:[2,4]}]:[])},options:{...base,scales:{y:{title:{display:true,text:'kg'}},y1:{position:'right',grid:{display:false},title:{display:true,text:'reps'}}}}}));
  // 3 volume
  const tgt = SPEC.metrics.find(m=>m.id==='weekly_hard_sets_vs_target').targets[String(weekFor(ui.volWeek)||2)];
  const vol={}; Object.keys(tgt).forEach(k=>vol[k]=0);
  S.sessions.filter(s=>s.status!=='skipped' && mondayOf(s.date)===ui.volWeek).forEach(s=>s.entries.forEach(e=>{
    const r = e.plannedExerciseId?exById[e.plannedExerciseId]:findExIdByName(e.performedExercise)&&exById[findExIdByName(e.performedExercise)];
    const ms = r?r.muscles:[]; const n=workSets(e).length;
    ms.forEach((m,i)=>{ vol[m]=(vol[m]||0)+n*(i===0?1:.5); });
  }));
  const mk=Object.keys(tgt);
  charts.push(new Chart($('#c3'),{type:'bar',data:{labels:mk.map(MUSCLE_LABEL),datasets:[{label:'Done',data:mk.map(k=>vol[k]),backgroundColor:'#16a34a'},{label:'Target (est.)',data:mk.map(k=>tgt[k]),backgroundColor:'#cbd5e1'}]},options:{...base,indexAxis:'y'}}));
  // 4 PR feed
  $('#prFeed').innerHTML = prFeed().map(p=>`<li>${p}</li>`).join('') || '<li class="muted">No PRs yet.</li>';
  // 5 calendar
  $('#cal').innerHTML = calendar();
  // 6 RIR accuracy
  const dev={};
  S.sessions.forEach(s=>s.entries.forEach(e=>{ const r=targetFor(e.plannedExerciseId, sesWeek(s)||2); if(!r) return; let k=0; e.sets.forEach(x=>{ if(x.setType!=='working') return; const t=k===0?r.rirSet1:(r.rirSet2??r.rirSet1); k++; if(num(x.rir)==null||t==null) return; (dev[e.performedExercise]=dev[e.performedExercise]||[]).push(+x.rir-t); }); }));
  const dk=Object.keys(dev);
  charts.push(new Chart($('#c6'),{type:'bar',data:{labels:dk.length?dk:['(no RIR logged yet)'],datasets:[{label:'avg RIR deviation',data:dk.map(k=>+(dev[k].reduce((a,b)=>a+b,0)/dev[k].length).toFixed(2)),backgroundColor:dk.map(k=>{const a=dev[k].reduce((x,y)=>x+y,0)/dev[k].length;return Math.abs(a)<=.5?'#16a34a':'#d97706'})}]},options:{...base,indexAxis:'y'}}));
  // 7 substitution rate
  const sub={};
  S.sessions.forEach(s=>s.entries.forEach(e=>{ if(!e.plannedName) return; const o=sub[e.plannedName]=sub[e.plannedName]||{n:0,s:0}; o.n++; if(e.substitutionUsed!=='none') o.s++; }));
  const sk=Object.keys(sub);
  const tot=sk.reduce((a,k)=>a+sub[k].n,0), tsub=sk.reduce((a,k)=>a+sub[k].s,0);
  charts.push(new Chart($('#c7'),{type:'bar',data:{labels:sk,datasets:[{label:`% substituted (overall ${tot?Math.round(100*tsub/tot):0}%)`,data:sk.map(k=>Math.round(100*sub[k].s/sub[k].n)),backgroundColor:'#2563eb'}]},options:{...base,indexAxis:'y',scales:{x:{max:100}}}}));
  // 8 progression table
  const rows = names.map(n=>{ const e=S.sessions.flatMap(s=>s.entries).find(x=>x.performedExercise===n); return [n, progression(n, e&&e.plannedExerciseId)]; });
  S.baselineBests.forEach(b=>{ if(!names.some(n=>norm(n)===norm(b.exercise))) rows.push([b.exercise, progression(b.exercise, b.exerciseId)]); });
  const bcls={add:'b-add',hold:'b-hold',stall:'b-stall',reps:'b-reps',na:'b-na',deload:'b-na'}, blab={add:'add load',hold:'hold · ext. range',stall:'stalled',reps:'add reps',na:'need reps',deload:'deload'};
  $('#progTbl').innerHTML = `<table><tr><th>Exercise</th><th>Last kg</th><th>Status</th></tr>${rows.map(([n,p])=>`<tr><td>${esc(n)}</td><td>${p.load!=null?fmt(p.load):'—'}</td><td><span class="badge ${bcls[p.status]}">${blab[p.status]}</span></td></tr>`).join('')}</table>`;
  // 9 wellness
  const ws=[...S.sessions].filter(s=>s.status!=='skipped').sort(cmpSes);
  const meas=S.measurements;
  charts.push(new Chart($('#c9'),{type:'line',data:{labels:ws.map(s=>fmtD(s.date)),datasets:[
    {label:'Soreness',data:ws.map(s=>s.soreness),borderColor:'#dc2626',yAxisID:'y',spanGaps:true},
    {label:'Energy',data:ws.map(s=>s.energy),borderColor:'#16a34a',yAxisID:'y',spanGaps:true},
    {label:'Bodyweight kg',data:ws.map(s=>s.bodyweightKg ?? (meas.find(m=>m.weekStart===mondayOf(s.date))||{}).bodyweightAvgKg ?? null),borderColor:'#2563eb',yAxisID:'y1',spanGaps:true},
    {label:'Working sets',type:'bar',data:ws.map(s=>s.entries.reduce((a,e)=>a+workSets(e).length,0)),backgroundColor:'#0000001a',yAxisID:'y2'}]},
    options:{...base,scales:{y:{min:0,max:5},y1:{position:'right',grid:{display:false}},y2:{display:false}}}}));
  // 10 gaps
  $('#gaps').innerHTML = loggingGaps().map(g=>`<li>⚠️ ${esc(g.text)}</li>`).join('') + S.sessions.filter(s=>s.loggedLate).map(s=>`<li class="muted">↩︎ ${fmtD(s.date)} ${DAY_LABEL[s.dayId]} logged late</li>`).join('') || '<li class="muted">No gaps 🎉</li>';
}
function prFeed(){
  const best={}, out=[];
  S.baselineBests.forEach(b=>{ best[norm(b.exercise)]={load:Array.isArray(b.loadKg)?Math.max(...b.loadKg):b.loadKg,e1:0,repsAt:{}}; });
  [...S.sessions].sort(cmpSes).forEach(s=>{ if(s.status==='skipped') return; s.entries.forEach(e=>{
    const k=norm(e.performedExercise); const b=best[k]||(best[k]={load:0,e1:0,repsAt:{},fresh:true});
    workSets(e).forEach(x=>{ const w=+x.weightKg, r=num(x.reps);
      if (w>b.load){ out.push(`🏆 <b>${esc(e.performedExercise)}</b> load PR ${fmt(w)} kg${x.perSide?' /side':''} <span class="muted">${fmtD(s.date)}</span>`); b.load=w; }
      if (r!=null){ if (b.repsAt[w]!=null && r>b.repsAt[w]) out.push(`💪 <b>${esc(e.performedExercise)}</b> rep PR ${r} @ ${fmt(w)} kg <span class="muted">${fmtD(s.date)}</span>`); b.repsAt[w]=Math.max(b.repsAt[w]||0,r);
        const e1=e1rm(w,r,num(x.rir)||0); if (b.e1 && e1>b.e1) out.push(`📈 <b>${esc(e.performedExercise)}</b> e1RM PR ${e1.toFixed(1)} kg <span class="muted">${fmtD(s.date)}</span>`); b.e1=Math.max(b.e1,e1); }
    }); }); });
  const baseline = S.baselineBests.map(b=>`📌 <b>${esc(b.exercise)}</b> recent best ${fmtLoad(b)}${b.status==='stalled'?' <span class="badge b-stall">stalled</span>':''}${b.mapsTo?` <span class="muted small">→ ${esc(b.mapsTo)}</span>`:''}`);
  return out.reverse().concat(baseline);
}
function calendar(){
  const end = mondayOf(todayISO()); let html='<div class="cal"><span></span>'+['M','T','W','T','F','S','S'].map(d=>`<span style="text-align:center">${d}</span>`).join('');
  const byDate={}; S.sessions.forEach(s=>{ const cur=byDate[s.date]; const rank={completed:3,partial:2,skipped:1}; if(!cur||rank[s.status]>rank[cur.status]) byDate[s.date]=s; });
  for (let i=11;i>=0;i--){ const wk=addDays(end,-7*i); const w=weekFor(wk); html+=`<span style="padding-right:4px">${w?'W'+w:fmtD(wk).split(' ').slice(1).join(' ')}</span>`;
    for (let d=0;d<7;d++){ const ds=addDays(wk,d); const s=byDate[ds]; html+=`<div class="d ${s?s.status:''} ${ds===todayISO()?'today':''}" title="${ds}${s?' '+DAY_LABEL[s.dayId]+' '+s.status:''}">${s?DAY_LABEL[s.dayId].replace(/[^A-Z0-9]/g,''):''}</div>`; } }
  const done=S.sessions.filter(s=>s.status!=='skipped').length, sk=S.sessions.filter(s=>s.status==='skipped').length;
  return html+`</div><div class="legend"><span><i style="background:var(--acc)"></i>done</span><span><i style="background:var(--warn)"></i>partial</span><span><i style="background:var(--bad)"></i>skipped</span><span>${done} trained · ${sk} skipped · plan 5/wk</span></div>`;
}

/* ---------- SETTINGS ---------- */
function renderSettings(){
  const v=$('#view'); const st=S.settings; const cw=weekFor(todayISO());
  v.innerHTML = `
  <div class="card"><h2>Program position</h2>
    <label>Current program week</label>
    <div class="chips" style="flex-wrap:wrap">${P.weeks.map(w=>`<button class="chip ${cw===w.week?'on':''}" data-w="${w.week}">${w.week}${w.deload?' D':w.intro?' i':''}</button>`).join('')}</div>
    <div class="small muted" style="margin-top:6px">Set or change this whenever you want. It auto-advances each Monday from the week you pick. 1 = intro, 7 = deload, techniques from 8. ${st.currentWeek?'':'Not set yet — suggestions use standard targets until you pick one.'}</div>
    <div class="row" style="margin-top:12px"><button type="button" class="btn sm" id="bfSet">Back-fill a past workout</button></div>
    <label style="margin-top:12px">Next session</label>
    <div class="chips">${SEQ.map(d=>`<button class="chip ${nextDay()===d?'on':''}" data-nd="${d}">${DAY_LABEL[d]}</button>`).join('')}</div>
    <div class="grid2" style="margin-top:12px"><div><label>Default start time</label><input type="time" id="defT" value="${st.defaultTime||'12:00'}"></div>
    <div><label>Remember last substitution</label><select id="sticky"><option value="">No</option><option value="1" ${st.stickySubs?'selected':''}>Yes</option></select></div></div>
  </div>
  <div class="card"><h2>Weekly measurements <span class="muted small">(optional)</span></h2>
    <div class="grid3">${['bodyweightAvgKg','waistCm','chestCm','armCm','thighCm','sleepAvgH'].map(f=>`<div><label>${f.replace(/([A-Z])/g,' $1').replace('Avg','avg').replace('Kg',' (kg)').replace('Cm',' (cm)').replace(' H',' (h)')}</label><input inputmode="decimal" data-m="${f}" value="${(S.measurements.find(m=>m.weekStart===mondayOf(todayISO()))||{})[f]??''}"></div>`).join('')}</div>
    <div class="small muted" style="margin-top:6px">Saved for week of ${fmtD(mondayOf(todayISO()))}. ${S.measurements.length} week(s) recorded.</div>
  </div>
  <div class="card"><h2>Backup</h2>
    <div class="row"><button class="btn pri" id="exp">Export JSON</button><label class="btn" style="display:inline-flex;align-items:center;color:var(--txt);font-size:15px;font-weight:600;border:1px solid var(--line);border-radius:12px;padding:10px 16px;background:var(--card2)">Import JSON<input type="file" id="imp" accept="application/json,.json" hidden></label></div>
    <div class="small muted" style="margin-top:8px">Synced to your account (${esc(USER?USER.email:'')}); this browser keeps an offline copy. ${esc(syncState)}</div>
    <div class="row" style="margin-top:12px"><button class="btn sm" id="signout">Sign out</button><button class="btn danger sm" id="reset">Erase my data</button></div>
  </div>
  <div class="card small muted">Program structure and numbers from the coach-bot tracking spec (${esc(SPEC.meta.program)}, generated ${esc(SPEC.meta.generated)}). Units: kg. This app logs training; it doesn't give medical advice — if something hurts, use the discomfort flag and a substitution, and check with a professional.</div>`;
  v.querySelectorAll('[data-w]').forEach(b=>b.onclick=()=>{ st.currentWeek=+b.dataset.w; st.anchorDate=todayISO(); save(); renderSettings(); toast('Week set to '+b.dataset.w); });
  $('#bfSet').onclick=()=>{ ui.date=addDays(todayISO(),-1); ui.dayId=null; ui.homeDay=null; ui.focusId=null; ui.edit=null; ui.logging=true; tab='log'; document.querySelector('[data-tab=log]').click(); };
  v.querySelectorAll('[data-nd]').forEach(b=>b.onclick=()=>{ st.nextDayOverride=b.dataset.nd; st.nextDayPinned=true; ui.homeDay=null; ui.dayId=null; save(); renderSettings(); });
  $('#defT').onchange=ev=>{st.defaultTime=ev.target.value; save();};
  $('#sticky').onchange=ev=>{st.stickySubs=!!ev.target.value; save();};
  v.querySelectorAll('[data-m]').forEach(i=>i.onchange=()=>{ const ws=mondayOf(todayISO()); let m=S.measurements.find(x=>x.weekStart===ws); if(!m){m={weekStart:ws};S.measurements.push(m);} m[i.dataset.m]=num(i.value); save(); toast('Saved'); });
  $('#exp').onclick=()=>{ const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),app:'minmax-tracker',data:S},null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`minmax-backup-${todayISO()}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); };
  $('#imp').onchange=async ev=>{ const f=ev.target.files[0]; if(!f) return; try{ const j=JSON.parse(await f.text()); const d=j.data||j; if(!d.sessions||!d.settings) throw new Error('not a Min-Max backup'); if(!confirm(`Replace current data with ${d.sessions.length} sessions from backup?`)) return; S=d; save(); render(); toast('Imported ✓'); }catch(e){ alert('Import failed: '+e.message); } };
  $('#signout').onclick=async()=>{
    clearTimeout(syncT);
    if(USER && S && allowSync) await pushFor(USER.id, S);
    clearTimeout(syncT);
    await sb.auth.signOut();
    toast('Signed out');
  };
  $('#reset').onclick=()=>{ if(!confirm('Erase all of your training data on this account?')) return; S=blank(); save(); ui.dayId=null; ui.logging=false; ui.homeDay=null; ui.focusId=null; renderSettings(); toast('Cleared'); };
}

function resetUi(){
  ui.date=todayISO();
  ui.dayId=null;
  ui.progEx=null;
  ui.focusId=null;
  ui.pad={};
  ui.edit=null;
  ui.restUntil=0;
  ui.restTotal=0;
  ui.restLabel='';
  ui.undo=null;
  ui.logging=false;
  ui.homeDay=null;
  if(restTick){ clearInterval(restTick); restTick=null; }
  tab='log';
  document.querySelectorAll('.tabs button').forEach(x=>x.classList.toggle('active', x.dataset.tab==='log'));
  document.body.classList.remove('tab-log','resting');
  document.body.style.paddingBottom='';
}
function showLogin(msg){
  document.body.classList.add('auth');
  document.body.classList.remove('tab-log','resting');
  document.body.style.paddingBottom='';
  ui.logging=false;
  $('#view').innerHTML = `<div class="card login"><h2>Sign in</h2>
    <p class="small muted">Enter your email and we'll send you a magic sign-in link.</p>
    <label>Email</label><input type="email" id="lgEmail" autocomplete="email" placeholder="you@example.com">
    <div class="row" style="margin-top:14px"><button class="btn pri" id="lgGo">Send magic link</button></div>
    <div id="lgMsg" class="small" style="margin-top:10px">${esc(msg||'')}</div></div>`;
  const m=t=>$('#lgMsg').textContent=t;
  $('#lgGo').onclick=async()=>{ const em=$('#lgEmail').value.trim().toLowerCase(); if(!em) return m('Enter your email.');
    m('Sending…'); const {error}=await sb.auth.signInWithOtp({email:em,options:{shouldCreateUser:true,emailRedirectTo:location.origin+location.pathname}});
    m(error?error.message:'Check your inbox for the sign-in link.'); };
  $('#lgEmail').onkeydown=e=>{ if(e.key==='Enter') $('#lgGo').click(); };
}
async function onSession(session){
  const u = session && session.user;
  if(!u){
    clearTimeout(syncT);
    if(USER && S && allowSync) await pushFor(USER.id, S);
    clearTimeout(syncT);
    USER=null; S=null; allowSync=false;
    resetUi();
    showLogin();
    return;
  }
  if(USER && USER.id===u.id) return;
  clearTimeout(syncT);
  if(USER && S && allowSync) await pushFor(USER.id, S);
  clearTimeout(syncT);
  USER=u; S=null; allowSync=false;
  resetUi();
  document.body.classList.remove('auth');
  $('#view').innerHTML='<div class="card muted">Loading your data…</div>';
  await loadRemote();
  if(!USER || USER.id!==u.id) return;
  render();
  if(location.hash.includes('access_token')) history.replaceState(null,'',location.pathname);
}
sb.auth.onAuthStateChange((ev,session)=>{ setTimeout(()=>onSession(session),0); });
if ('serviceWorker' in navigator && !/[?&]nosw=1/.test(location.search)) {
  navigator.serviceWorker.register('./sw.js').catch(function(){});
}

})();
