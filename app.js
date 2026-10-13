/* Min-Max Tracker — static SPA, localStorage only. */
(function(){
'use strict';
const SPEC = window.MINMAX_SPEC;
const P = SPEC.program;
const KEY = 'minmax-tracker-v1';
const SEQ = ['upper1','lower1','upper2','lower2','armsDelts'];
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
let S = load();
function blank(){ return {version:1, settings:{currentWeek:null, anchorDate:null, nextDayOverride:'armsDelts', defaultTime:'12:00'}, sessions:[], measurements:[], baselineBests:[], seeded:false}; }
function load(){
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.version) return s; } catch(e){}
  const s = blank(); seed(s); localStorage.setItem(KEY, JSON.stringify(s)); return s;
}
function save(){ localStorage.setItem(KEY, JSON.stringify(S)); renderHeader(); }

function seed(s){
  const A = SPEC.athleteState;
  const mkSets = (loads, reps) => loads.map((w,i)=>({setType:'working', techniqueCode:null, weightKg:w, perSide:false, reps: reps==null?null:reps, rir:null, durationSec:null, notes:null}));
  A.sessions.forEach(src => {
    const ses = {id:uid(), date:src.date, startTime:'12:00', weekOverride:null, dayId:src.dayId, durationMin:null, soreness:null, energy:null, bodyweightKg:null, status:'completed', skipReason:null, loggedLate:true, notes:'Seeded from coach-bot (Jeff) summary; reps/RIR not recorded.', entries:[]};
    src.entries.forEach(e => {
      const pid = e.planned ? findExIdByName(e.planned) : null;
      const loads = e.loadsKg || (e.loadKg!=null ? Array(e.workingSets||1).fill(e.loadKg) : []);
      let subUsed = 'none';
      if (e.performed && e.planned && norm(e.performed)!==norm(e.planned)) {
        const b = pid && exById[pid];
        subUsed = b && norm(b.substitution1)===norm(e.performed) ? 'sub1' : b && norm(b.substitution2)===norm(e.performed) ? 'sub2' : 'custom';
      }
      if (!e.planned) subUsed = 'custom';
      const sets = mkSets(loads, e.reps);
      sets.forEach(x=>x.perSide=!!e.perSide);
      const notes = [e.note, e.reason, e.approx?'load approximate':null].filter(Boolean).join('; ')||null;
      ses.entries.push({id:uid(), plannedExerciseId:pid, plannedName:e.planned||null, performedExercise:e.performed, substitutionUsed:subUsed, substitutionReason:e.substitutionReason||null, cutShort:!!e.cutShort, discomfort: /back/i.test(e.reason||'') ? 'low back' : null, notes, sets});
    });
    if (ses.entries.some(e=>e.cutShort)) ses.status='partial';
    s.sessions.push(ses);
  });
  ['2026-10-09','2026-10-10'].forEach(d => s.sessions.push({id:uid(), date:d, startTime:'12:00', weekOverride:null, dayId:'armsDelts', durationMin:null, soreness:null, energy:null, bodyweightKg:null, status:'skipped', skipReason:'soreness', loggedLate:true, notes:'Skipped for soreness (seeded).', entries:[]}));
  s.baselineBests = A.recentBestsKg.map(b => ({...b, exerciseId: findExIdByName(b.exercise) || findExIdByName((b.mapsTo||'').split(/[(/]/)[0])}));
  s.seeded = true;
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
  if (S.settings.nextDayOverride) return S.settings.nextDayOverride;
  const done = S.sessions.filter(s=>s.status!=='skipped').sort(cmpSes);
  if (!done.length) return 'upper1';
  const last = done[done.length-1].dayId;
  return SEQ[(SEQ.indexOf(last)+1)%SEQ.length];
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
function increment(name){
  if (/barbell|smith|squat|bar /i.test(name)) return 2.5;
  if (/\bdb\b|dumbbell/i.test(name)) return 2;
  if (/machine|cable|pulldown|press|curl|extension|raise|row|deck|fly/i.test(name)) return null;
  return 2.5;
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
  const inc = increment(performedName);
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
const ui = { date: todayISO(), dayId: null, progEx: null };
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{ tab=b.dataset.tab; document.querySelectorAll('.tabs button').forEach(x=>x.classList.toggle('active',x===b)); render(); scrollTo(0,0); });
function toast(m){ const t=$('#toast'); t.textContent=m; t.classList.add('show'); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('show'),1800); }
function renderHeader(){
  const w = weekFor(todayISO()); const wi = w&&weekInfo(w);
  const h=$('#hdrWeek'); h.textContent = w ? `Wk ${w}${wi.deload?' · deload':wi.intro?' · intro':''}` : 'Week ?'; h.className='pill'+(w?'':' warn');
  $('#hdrNext').textContent = 'Next: '+DAY_LABEL[nextDay()];
}
function render(){ renderHeader(); charts.forEach(c=>c.destroy()); charts=[]; ({log:renderLog,history:renderHistory,progress:renderProgress,settings:renderSettings})[tab](); }
let charts=[];

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

function renderLog(){
  const v=$('#view');
  if (!ui.dayId) ui.dayId = nextDay();
  const s = getSession(ui.date, ui.dayId, true);
  ensureEntries(s);
  const w = sesWeek(s), wi = w && weekInfo(w);
  const late = ui.date < todayISO();
  v.innerHTML = `
  ${!S.settings.currentWeek?`<div class="banner">Program week not set. Suggestions use standard (week 2–6) targets until you <a href="#" id="goSet" style="color:inherit">set your current week</a>.</div>`:''}
  <div class="card">
    <div class="row between"><h2 style="margin:0">${late?'Back-fill':'Today'} · ${fmtD(ui.date)}</h2>
      <span class="pill ${wi&&wi.deload?'warn':'blue'}">${w?`Week ${w} · Block ${wi.block}${wi.deload?' · Deload':''}${wi.intro?' · Intro':''}`:'Week ?'}</span></div>
    <div class="chips" style="margin-top:10px">
      ${[0,-1,-2,-3].map(o=>{const d=addDays(todayISO(),o);return `<button class="chip ${d===ui.date?'on':''}" data-date="${d}">${o===0?'Today':o===-1?'Yesterday':fmtD(d)}</button>`}).join('')}
      <input type="date" id="pickDate" value="${ui.date}" max="${todayISO()}" style="width:150px;min-height:40px;padding:6px">
    </div>
    <div class="chips wrap" style="margin-top:8px">
      ${SEQ.map(d=>`<button class="chip ${d===ui.dayId?'on':''}" data-day="${d}">${DAY_LABEL[d]}${d===nextDay()?' •':''}</button>`).join('')}
    </div>
    ${late?`<div class="small muted" style="margin-top:8px">Past date → session is flagged <b>logged late</b>.</div>`:''}
    ${wi && w>=8?`<div class="small" style="margin-top:8px;color:#a21caf">Block 2: last-set intensity techniques active.</div>`:''}
  </div>
  <div id="exList">${s.entries.map((e,i)=>exCard(s,e,i,w)).join('')}</div>
  <div class="card">
    <button class="btn sm" id="addCustom">+ Add extra exercise</button>
    <h3 style="margin-top:14px">Session details <span class="muted small">(optional)</span></h3>
    <div class="grid3" style="margin-top:8px">
      <div><label>Start</label><input type="time" data-sf="startTime" value="${esc(s.startTime)}"></div>
      <div><label>Duration (min)</label><input inputmode="numeric" data-sf="durationMin" value="${s.durationMin??''}"></div>
      <div><label>Bodyweight kg</label><input inputmode="decimal" data-sf="bodyweightKg" value="${s.bodyweightKg??''}"></div>
    </div>
    <div class="grid2" style="margin-top:8px">
      <div><label>Soreness (1–5)</label><div class="chips" data-scale="soreness">${[1,2,3,4,5].map(n=>`<button class="chip ${s.soreness===n?'on':''}" data-n="${n}">${n}</button>`).join('')}</div></div>
      <div><label>Energy (1–5)</label><div class="chips" data-scale="energy">${[1,2,3,4,5].map(n=>`<button class="chip ${s.energy===n?'on':''}" data-n="${n}">${n}</button>`).join('')}</div></div>
    </div>
    <div class="grid2" style="margin-top:8px">
      <div><label>Week override</label><select data-sf="weekOverride"><option value="">Auto (${weekFor(s.date)||'?'})</option>${P.weeks.map(x=>`<option ${s.weekOverride===x.week?'selected':''}>${x.week}</option>`).join('')}</select></div>
      <div><label>Status</label><select data-sf="status">${['completed','partial'].map(x=>`<option ${s.status===x?'selected':''}>${x}</option>`).join('')}</select></div>
    </div>
    <div style="margin-top:8px"><label>Notes</label><textarea data-sf="notes">${esc(s.notes||'')}</textarea></div>
    <label class="row" style="margin-top:8px;color:var(--txt)"><input type="checkbox" data-sf="loggedLate" ${s.loggedLate?'checked':''} style="width:22px;min-height:22px"> Logged late (back-filled from memory)</label>
  </div>
  <div class="sticky-actions">
    <button class="btn" id="skipBtn">Mark skipped</button>
    <button class="btn pri" id="saveBtn">Save session</button>
  </div>`;
  bindLog(s);
}
function exCard(s,e,i,w){
  const r = e.plannedExerciseId ? prescription(w, s.dayId).find(x=>x.exerciseId===e.plannedExerciseId) : null;
  const pg = progression(e.performedExercise, e.plannedExerciseId, s.date);
  const prev = exposures(e.performedExercise, s.date).pop();
  const isRDL = /rdl|romanian|deadlift/i.test((e.plannedName||'')+' '+e.performedExercise);
  const prevFlag = isRDL && S.sessions.some(x=>x.date<s.date && x.entries.some(y=>/rdl/i.test(y.performedExercise+(y.plannedName||'')) && y.discomfort));
  const tech = r && r.intensityTechnique && w>=8;
  const wu = r ? r.warmupSets : null;
  const pctTxt = (wu && pg.load) ? (SPEC.warmupProtocol.specificSetsPercentOfWorkingWeight[String(wu[1])]||[]).map(p=>fmt(Math.round(pg.load*p/100*2)/2)).join(' / ')+' kg' : '';
  const sugW = pg.status==='add' ? (increment(e.performedExercise)? pg.load+increment(e.performedExercise) : pg.load) : pg.load;
  return `<div class="card" data-ei="${i}">
    <div class="ex-head"><div>
      <div class="ex-name">${esc(e.performedExercise)}</div>
      ${e.substitutionUsed!=='none'&&e.plannedName?`<div class="ex-planned">swap for ${esc(e.plannedName)}</div>`:''}
      ${!e.plannedName?`<div class="ex-planned">extra / custom</div>`:''}
    </div><span class="muted small">#${i+1}</span></div>
    ${r?`<div class="targets">
      <span>${r.workingSets}× ${r.repRange?r.repRange[0]+'–'+r.repRange[1]+' reps':'max hold'}</span>
      <span>RIR ${r.rirSet1}${r.rirSet2!=null?' / '+r.rirSet2:''}</span>
      <span>Rest ${r.rest.minMinutes}–${r.rest.maxMinutes} min</span>
      <span>Warm-up ${r.warmupSets[0]}–${r.warmupSets[1]}</span>
      ${r.failureMode==='noAttemptedFailedRep'?'<span>RIR 0 = no failed-rep attempt</span>':''}
      ${tech?`<span class="tech">Last set: ${esc(r.intensityTechnique)}</span>`:''}
    </div>
    <div class="chips wrap" data-subs>
      <button class="chip sub ${e.substitutionUsed==='none'?'on':''}" data-sub="none">${esc(r.name)}</button>
      <button class="chip sub ${e.substitutionUsed==='sub1'?'on':''}" data-sub="sub1">${esc(r.substitution1)}</button>
      <button class="chip sub ${e.substitutionUsed==='sub2'?'on':''}" data-sub="sub2">${esc(r.substitution2)}</button>
      <button class="chip sub ${e.substitutionUsed==='custom'?'on':''}" data-sub="custom">${e.substitutionUsed==='custom'?'✎ '+esc(e.performedExercise):'Other…'}</button>
    </div>`:''}
    ${prevFlag?`<div class="sugg hold">You flagged low-back discomfort on this lift before. One-tap swap above if you'd rather use a substitute today.</div>`:''}
    ${prev?`<div class="small muted" style="margin-top:6px">Last (${fmtD(prev.ses.date)}): ${prev.ws.map(x=>fmt(+x.weightKg)+(x.reps!=null?'×'+x.reps:'')+(x.rir!=null?' @'+x.rir:'')).join(', ')}</div>`:''}
    <div class="sugg ${pg.status==='hold'?'hold':pg.status==='stall'?'stall':pg.status==='add'?'':'info'}">${esc(pg.text)}</div>
    ${pctTxt?`<div class="small muted">Warm-up ladder: ${pctTxt}</div>`:''}
    <div class="sethdr" style="margin-top:8px"><span>type</span><span>kg${e.sets.some(x=>x.perSide)?' /side':''}</span><span>reps</span><span>RIR</span><span></span></div>
    <div class="sets">${e.sets.map((x,j)=>{
      const t = x.setType==='working' ? (j - e.sets.filter((y,k)=>k<j&&y.setType!=='working').length) : -1;
      const rirPh = r && t>=0 ? (t===0?r.rirSet1:(r.rirSet2??r.rirSet1)) : '';
      return `<div class="set" data-si="${j}">
      <button class="tag ${x.setType}" data-toggletype>${x.setType==='warmup'?'W-up':x.setType==='technique'?'Tech':'Set '+(t+1)}</button>
      <input inputmode="decimal" data-f="weightKg" value="${x.weightKg??''}" placeholder="${x.setType==='working'&&sugW?fmt(sugW):''}">
      <input inputmode="numeric" data-f="reps" value="${x.reps??''}" placeholder="${r&&r.repRange&&x.setType==='working'?r.repRange[0]+'-'+r.repRange[1]:''}">
      <input inputmode="decimal" data-f="rir" value="${x.rir??''}" placeholder="${rirPh??''}">
      <button class="x" data-delset aria-label="remove set">×</button></div>`}).join('')}</div>
    <div class="row" style="margin-top:8px">
      <button class="btn sm" data-addset="working">+ Set</button>
      <button class="btn sm" data-addset="warmup">+ Warm-up</button>
      ${tech?`<button class="btn sm" data-addset="technique">+ ${esc(r.intensityTechnique.split(' (')[0])}</button>`:''}
      ${sugW?`<button class="btn sm ghost" data-fill>Fill ${fmt(sugW)} kg</button>`:''}
    </div>
    <div class="chips wrap" style="margin-top:8px">
      <button class="chip flag ${e.sets.some(x=>x.perSide)?'on':''}" data-perside>Per side</button>
      <button class="chip flag ${e.cutShort?'on':''}" data-cut>Cut short</button>
      <button class="chip flag ${e.discomfort?'on':''}" data-disc>${isRDL?'Low-back flag':'Discomfort'}</button>
      <button class="chip ${e.notes?'on':''}" data-note>Note</button>
    </div>
    ${e.notes?`<div class="small muted" style="margin-top:6px">📝 ${esc(e.notes)}</div>`:''}
  </div>`;
}
function bindLog(s){
  const v=$('#view');
  const touch = () => { commit(s); };
  const g=$('#goSet'); if (g) g.onclick=ev=>{ev.preventDefault(); document.querySelector('[data-tab=settings]').click();};
  v.querySelectorAll('[data-date]').forEach(b=>b.onclick=()=>{ui.date=b.dataset.date; renderLog();});
  $('#pickDate').onchange=ev=>{ if(ev.target.value){ ui.date=ev.target.value; renderLog(); } };
  v.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>{ui.dayId=b.dataset.day; renderLog();});
  v.querySelectorAll('[data-sf]').forEach(inp=>inp.onchange=()=>{
    const f=inp.dataset.sf; let val = inp.type==='checkbox'?inp.checked:inp.value;
    if (['durationMin','bodyweightKg','weekOverride'].includes(f)) val=num(val);
    s[f]=val; touch(); if (f==='weekOverride') renderLog();
  });
  v.querySelectorAll('[data-scale]').forEach(c=>c.querySelectorAll('[data-n]').forEach(b=>b.onclick=()=>{ const f=c.dataset.scale, n=+b.dataset.n; s[f]= s[f]===n?null:n; touch(); renderLog(); }));
  v.querySelectorAll('[data-ei]').forEach(card=>{
    const e = s.entries[+card.dataset.ei];
    const r = e.plannedExerciseId ? exById[e.plannedExerciseId] : null;
    card.querySelectorAll('.set').forEach(row=>{
      const x = e.sets[+row.dataset.si];
      row.querySelectorAll('input').forEach(inp=>inp.onchange=()=>{ x[inp.dataset.f]=num(inp.value); touch(); });
      row.querySelector('[data-delset]').onclick=()=>{ e.sets.splice(+row.dataset.si,1); touch(); renderLog(); };
      row.querySelector('[data-toggletype]').onclick=()=>{ const order=['working','warmup','technique']; x.setType=order[(order.indexOf(x.setType)+1)%3]; const rr=targetFor(e.plannedExerciseId,sesWeek(s)); x.techniqueCode = x.setType==='technique' ? (rr&&rr.intensityTechniqueCode)||null : null; touch(); renderLog(); };
    });
    card.querySelectorAll('[data-addset]').forEach(b=>b.onclick=()=>{
      const t=b.dataset.addset; const rr=targetFor(e.plannedExerciseId,sesWeek(s));
      const ns={setType:t,techniqueCode:t==='technique'?(rr&&rr.intensityTechniqueCode)||null:null,weightKg:null,perSide:e.sets.some(y=>y.perSide),reps:null,rir:null,durationSec:null,notes:null};
      if (t==='warmup'){ const k=e.sets.findIndex(y=>y.setType!=='warmup'); e.sets.splice(k<0?e.sets.length:k,0,ns);} else e.sets.push(ns);
      touch(); renderLog();
    });
    const fill=card.querySelector('[data-fill]'); if (fill) fill.onclick=()=>{ const w=+fill.textContent.match(/[\d.]+/)[0]; e.sets.forEach(x=>{ if(x.setType==='working'&&x.weightKg==null) x.weightKg=w; }); touch(); renderLog(); };
    card.querySelectorAll('[data-sub]').forEach(b=>b.onclick=async()=>{
      const k=b.dataset.sub;
      if (k==='custom'){ const name = prompt('Exercise performed instead:', e.substitutionUsed==='custom'?e.performedExercise:''); if (!name) return; e.performedExercise=name.trim(); }
      else e.performedExercise = k==='none'?r.name:k==='sub1'?r.substitution1:r.substitution2;
      e.substitutionUsed=k;
      if (k!=='none' && !e.substitutionReason){ e.substitutionReason = await pickReason(); }
      if (k==='none') e.substitutionReason=null;
      touch(); renderLog(); toast(k==='none'?'Back to planned exercise':'Swapped → '+e.performedExercise);
    });
    card.querySelector('[data-perside]').onclick=()=>{ const on=!e.sets.some(x=>x.perSide); e.sets.forEach(x=>x.perSide=on); touch(); renderLog(); };
    card.querySelector('[data-cut]').onclick=()=>{ e.cutShort=!e.cutShort; if(e.cutShort && s.status==='completed') s.status='partial'; touch(); renderLog(); };
    card.querySelector('[data-disc]').onclick=()=>{ if (e.discomfort) e.discomfort=null; else { const where = prompt('Where / what? (saved as a note, e.g. "low back")', /rdl/i.test(e.performedExercise+(e.plannedName||''))?'low back':''); if (where===null) return; e.discomfort=where||'yes'; } touch(); renderLog(); };
    card.querySelector('[data-note]').onclick=()=>{ const n=prompt('Note for '+e.performedExercise, e.notes||''); if (n===null) return; e.notes=n.trim()||null; touch(); renderLog(); };
  });
  $('#addCustom').onclick=()=>{ const name=prompt('Extra exercise name:'); if(!name) return; s.entries.push(newEntry(null,name.trim(),s)); touch(); renderLog(); };
  $('#saveBtn').onclick=()=>{ commit(s); if (S.settings.nextDayOverride===s.dayId || !S.settings.nextDayOverride) S.settings.nextDayOverride = SEQ[(SEQ.indexOf(s.dayId)+1)%SEQ.length]; save(); toast('Session saved ✓'); ui.dayId=null; renderLog(); };
  $('#skipBtn').onclick=async()=>{
    const reason = await pickReason(['soreness','illness','schedule','other'],'Skip reason');
    if (!reason) return;
    const idx=S.sessions.indexOf(s); if (idx>=0 && !s.entries.some(e=>e.sets.some(x=>x.weightKg!=null))) S.sessions.splice(idx,1);
    S.sessions.push({id:uid(), date:ui.date, startTime:S.settings.defaultTime, weekOverride:null, dayId:ui.dayId, durationMin:null, soreness:null, energy:null, bodyweightKg:null, status:'skipped', skipReason:reason, loggedLate:ui.date<todayISO(), notes:null, entries:[]});
    save(); toast('Marked skipped ('+reason+')'); renderLog();
  };
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
  const gaps = loggingGaps();
  v.innerHTML = `<div class="card"><div class="row between"><h2 style="margin:0">History</h2><button class="btn sm pri" id="bf">+ Back-fill a past day</button></div>
   ${gaps.length?`<div class="banner" style="margin-top:10px">${gaps.length} possible logging gap(s): ${gaps.slice(0,3).map(g=>esc(g)).join('; ')}</div>`:''}</div>
   ${ss.map(s=>{ const w=sesWeek(s); const sets=s.entries.reduce((a,e)=>a+workSets(e).length,0);
     return `<div class="card"><div class="hist-item"><div><b>${DAY_LABEL[s.dayId]}</b> <span class="muted small">${fmtD(s.date)} · wk ${w||'?'}</span><br>
     <span class="badge ${s.status==='completed'?'b-add':s.status==='partial'?'b-hold':'b-stall'}">${s.status}${s.skipReason?' · '+s.skipReason:''}</span>
     ${s.loggedLate?'<span class="badge b-na">logged late</span>':''} ${s.entries.some(e=>e.discomfort)?'<span class="badge b-hold">discomfort</span>':''}
     <div class="small muted" style="margin-top:4px">${sets} working sets · ${s.entries.filter(e=>e.substitutionUsed!=='none').length} subs</div></div>
     <div class="row">${s.status!=='skipped'?`<button class="btn sm" data-open="${s.id}">Open</button>`:''}<button class="btn sm danger" data-del="${s.id}">Delete</button></div></div>
     ${s.entries.length?`<div class="small" style="margin-top:8px">${s.entries.map(e=>`${esc(e.performedExercise)}${e.cutShort?' ✂':''}: ${workSets(e).map(x=>fmt(+x.weightKg)+(x.reps!=null?'×'+x.reps:'')).join(', ')||'—'}`).join('<br>')}</div>`:''}
     </div>`}).join('')}`;
  $('#bf').onclick=()=>{ ui.date=addDays(todayISO(),-1); ui.dayId=null; tab='log'; document.querySelector('[data-tab=log]').click(); };
  v.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{ const s=S.sessions.find(x=>x.id===b.dataset.open); ui.date=s.date; ui.dayId=s.dayId; document.querySelector('[data-tab=log]').click(); });
  v.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{ if(!confirm('Delete this session?')) return; S.sessions=S.sessions.filter(x=>x.id!==b.dataset.del); save(); renderHistory(); });
}
function loggingGaps(){
  const out=[];
  S.sessions.forEach(s=>{ if(s.status==='skipped') return;
    const missing=s.entries.filter(e=>!e.cutShort && e.plannedExerciseId && !workSets(e).length).length;
    const noReps=s.entries.some(e=>workSets(e).some(x=>x.reps==null));
    if (missing) out.push(`${fmtD(s.date)} ${DAY_LABEL[s.dayId]}: ${missing} exercise(s) without sets`);
    else if (noReps) out.push(`${fmtD(s.date)} ${DAY_LABEL[s.dayId]}: reps/RIR missing`);
  });
  const dates = S.sessions.map(s=>s.date).sort(); const last=dates[dates.length-1];
  if (last && daysBetween(last, todayISO())>=3) out.unshift(`nothing logged since ${fmtD(last)} — back-fill?`);
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
      <div class="row small muted">Week of <select id="volW" style="width:auto;min-height:36px;padding:4px">${weeks.map(w=>`<option value="${w}" ${w===ui.volWeek?'selected':''}>${fmtD(w)}</option>`).join('')}</select></div>
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
  $('#gaps').innerHTML = loggingGaps().map(g=>`<li>⚠️ ${esc(g)}</li>`).join('') + S.sessions.filter(s=>s.loggedLate).map(s=>`<li class="muted">↩︎ ${fmtD(s.date)} ${DAY_LABEL[s.dayId]} logged late</li>`).join('') || '<li class="muted">No gaps 🎉</li>';
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
    <label>Current program week (this calendar week)</label>
    <div class="chips" style="flex-wrap:wrap">${P.weeks.map(w=>`<button class="chip ${cw===w.week?'on':''}" data-w="${w.week}">${w.week}${w.deload?' D':w.intro?' i':''}</button>`).join('')}</div>
    <div class="small muted" style="margin-top:6px">Week auto-advances each Monday from here. 1 = intro, 7 = deload, techniques from 8. ${st.currentWeek?'':'<b style="color:var(--warn)">Not set yet.</b>'}</div>
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
    <div class="small muted" style="margin-top:8px">Data lives only in this browser (localStorage). Export regularly.</div>
    <div class="row" style="margin-top:12px"><button class="btn danger sm" id="reset">Reset to seeded data</button></div>
  </div>
  <div class="card small muted">Program structure and numbers from the coach-bot tracking spec (${esc(SPEC.meta.program)}, generated ${esc(SPEC.meta.generated)}). Units: kg. This app logs training; it doesn't give medical advice — if something hurts, use the discomfort flag and a substitution, and check with a professional.</div>`;
  v.querySelectorAll('[data-w]').forEach(b=>b.onclick=()=>{ st.currentWeek=+b.dataset.w; st.anchorDate=todayISO(); save(); renderSettings(); toast('Week set to '+b.dataset.w); });
  v.querySelectorAll('[data-nd]').forEach(b=>b.onclick=()=>{ st.nextDayOverride=b.dataset.nd; ui.dayId=null; save(); renderSettings(); });
  $('#defT').onchange=ev=>{st.defaultTime=ev.target.value; save();};
  $('#sticky').onchange=ev=>{st.stickySubs=!!ev.target.value; save();};
  v.querySelectorAll('[data-m]').forEach(i=>i.onchange=()=>{ const ws=mondayOf(todayISO()); let m=S.measurements.find(x=>x.weekStart===ws); if(!m){m={weekStart:ws};S.measurements.push(m);} m[i.dataset.m]=num(i.value); save(); toast('Saved'); });
  $('#exp').onclick=()=>{ const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),app:'minmax-tracker',data:S},null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`minmax-backup-${todayISO()}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); };
  $('#imp').onchange=async ev=>{ const f=ev.target.files[0]; if(!f) return; try{ const j=JSON.parse(await f.text()); const d=j.data||j; if(!d.sessions||!d.settings) throw new Error('not a Min-Max backup'); if(!confirm(`Replace current data with ${d.sessions.length} sessions from backup?`)) return; S=d; save(); render(); toast('Imported ✓'); }catch(e){ alert('Import failed: '+e.message); } };
  $('#reset').onclick=()=>{ if(!confirm('Erase all data and restore seeded sessions?')) return; S=blank(); seed(S); save(); ui.dayId=null; renderSettings(); toast('Reset'); };
}

render();
})();
