const $ = id => document.getElementById(id);
const storeKey = 'tri_tracker_workouts_v3';
const priorStoreKeys = ['tri_tracker_workouts_v2','tri_tracker_workouts_v1'];
const settingsKey = 'tri_tracker_settings_v1';

let workouts = JSON.parse(localStorage.getItem(storeKey) || priorStoreKeys.map(k=>localStorage.getItem(k)).find(Boolean) || '[]');
let settings = JSON.parse(localStorage.getItem(settingsKey) || '{}');

$('date').valueAsDate = new Date();
$('athleteId').value = settings.athleteId || '';
$('apiKey').value = settings.apiKey || '';

function save(){ localStorage.setItem(storeKey, JSON.stringify(workouts)); }
function saveSettings(showAlert=true){
  settings={athleteId:$('athleteId').value.trim(),apiKey:$('apiKey').value.trim()};
  localStorage.setItem(settingsKey,JSON.stringify(settings));
  if(showAlert) alert('Saved on this device.');
}
$('saveSettings').onclick=()=>saveSettings(true);

function keyLookup(row, names){
  const normalized = {};
  Object.keys(row).forEach(k => normalized[k.toLowerCase().replace(/[^a-z0-9]/g,'')] = row[k]);
  for (const name of names) {
    const key = name.toLowerCase().replace(/[^a-z0-9]/g,'');
    if (normalized[key] !== undefined && normalized[key] !== '') return normalized[key];
  }
  return '';
}
function asNumber(v){
  if (v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/[^0-9.\-]/g,''));
  return Number.isFinite(n) ? n : 0;
}
function parseDurationToMinutes(v){
  if (!v) return 0;
  const s = String(v).trim();
  if (s.includes(':')) {
    const parts = s.split(':').map(Number);
    if (parts.length === 3) return Math.round(parts[0]*60 + parts[1] + parts[2]/60);
    if (parts.length === 2) return Math.round(parts[0] + parts[1]/60);
  }
  const n = asNumber(s);
  if (n > 500) return Math.round(n/60);
  return Math.round(n);
}
function normalizeDate(v){
  if(!v) return '';
  const s=String(v).trim().replace(/^"|"$/g,'');
  const iso=s.match(/\d{4}-\d{2}-\d{2}/);
  if(iso) return iso[0];
  const m=s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if(m){ const y=m[3].length===2 ? '20'+m[3] : m[3]; return `${y}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`; }
  const d=new Date(s); return isNaN(d) ? '' : d.toISOString().slice(0,10);
}
function normalizeSport(s){
  s=(s||'').toLowerCase();
  if(s.includes('swim'))return 'Swim';
  if(s.includes('run'))return 'Run';
  if(s.includes('ride')||s.includes('bike')||s.includes('cycle')||s.includes('virtualride'))return 'Ride';
  if(s.includes('strength')||s.includes('weight'))return 'Strength';
  if(s.includes('bjj')||s.includes('jiu'))return 'BJJ';
  return s? s[0].toUpperCase()+s.slice(1):'Other';
}
function workoutKey(w){ return `${w.source || 'manual'}|${w.externalId || ''}|${w.date}|${w.sport}|${Math.round(w.minutes||0)}|${w.notes||''}`; }
function dedupeAndSort(){
  const seen=new Set();
  workouts=workouts.filter(w=>{
    w.date=normalizeDate(w.date); w.sport=normalizeSport(w.sport); w.minutes=Math.round(Number(w.minutes||0));
    const k=workoutKey(w);
    if(!w.date || seen.has(k)) return false;
    seen.add(k); return true;
  }).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
}
function loadScore(w){ const mins=Number(w.minutes||0), rpe=Number(w.rpe||0), hr=Number(w.hr||0); let score=mins*(rpe||5); if(hr>165)score*=1.15; if(w.sport==='BJJ')score*=1.25; return Math.round(score); }
function analysis(w){
  const score=loadScore(w); const bits=[];
  if(w.sport==='Ride' && w.power && w.hr){ bits.push(Number(w.hr)<145?'Aerobic ride. Good Z2/base signal.':'Higher cardiac cost; treat as moderate/hard.'); if(w.power<140) bits.push('Bike load looks controlled. Nice for building volume.'); }
  if(w.sport==='Run' && w.hr){ bits.push(w.hr>175?'Hard run. Keep tomorrow easy.':w.hr<155?'Likely aerobic/base run.':'Moderate run. Watch recovery.'); }
  if(w.sport==='Swim') bits.push('Swim logged. Consistency matters more than crushing these early.');
  if(w.sport==='BJJ') bits.push('BJJ counted as recovery stress. Hard rounds can hit like intervals.');
  if(score>600) bits.push('Big session. Fuel and sleep matter tonight.');
  return bits.join(' ');
}
$('addWorkout').onclick=()=>{
  const w={id:crypto.randomUUID(),externalId:'',source:'manual',sport:$('sport').value,date:$('date').value,minutes:+$('minutes').value||0,distance:+$('distance').value||0,hr:+$('hr').value||0,power:+$('power').value||0,rpe:+$('rpe').value||5,notes:$('notes').value};
  workouts.unshift(w); dedupeAndSort(); save(); render();
};

function status(msg){ const el=$('syncStatus'); if(el) el.textContent=msg; }
function pickDate(r){
  const val=keyLookup(r,['Start Date','Start Date Local','Start Time','Start Time Local','start_date_local','start_date','date','Date','Workout Day','Calendar Date','Day']);
  return normalizeDate(val);
}
function pickMinutes(r){
  const seconds=asNumber(keyLookup(r,['Moving Time','Elapsed Time','Total Timer Time','Duration Seconds','moving_time','elapsed_time','duration_seconds','time_sec','time']));
  if(seconds>500) return Math.round(seconds/60);
  const raw=keyLookup(r,['Duration','Moving Time','Elapsed Time','Time','total_timer_time','duration','moving time','elapsed time']);
  const parsed=parseDurationToMinutes(raw);
  return parsed || Math.round(seconds || 0);
}
function pickDistanceMiles(r, sport){
  const meters=asNumber(keyLookup(r,['Distance','distance','distance_m','Distance Meters','Total Distance','total_distance']));
  if(!meters) return 0;
  // Intervals CSV normally returns meters. If it already looks like miles/yards, leave small values alone.
  if(sport==='Swim') return meters > 500 ? Math.round(meters) : Math.round(meters*100)/100;
  return meters > 1000 ? Math.round((meters/1609.34)*100)/100 : Math.round(meters*100)/100;
}
async function syncIntervals(){
  saveSettings(false);
  const id=(settings.athleteId || '0').trim(), key=settings.apiKey;
  if(!key) return alert('Add your Intervals.icu API key first.');
  status('Syncing Intervals.icu…');
  const oldest=new Date(Date.now()-1000*60*60*24*365*2).toISOString().slice(0,10);
  const newest=new Date(Date.now()+1000*60*60*24).toISOString().slice(0,10);
  const url=`https://intervals.icu/api/v1/athlete/${encodeURIComponent(id)}/activities.csv?oldest=${oldest}&newest=${newest}`;
  try{
    const res=await fetch(url,{headers:{Authorization:'Basic '+btoa('API_KEY:'+key), Accept:'text/csv'}});
    if(!res.ok) throw new Error(res.status+' '+res.statusText);
    const csv=await res.text();
    const rows=parseCSV(csv);
    const beforeKeys=new Set(workouts.map(workoutKey));
    let importedCount=0, skippedNoDate=0, skippedNoMinutes=0;
    const headers = rows[0] ? Object.keys(rows[0]).join(', ') : 'No headers found';
    rows.forEach((r, idx)=>{
      const externalId=String(keyLookup(r,['Id','ID','id','Activity Id','Activity ID','activity_id','icu_id','File Id','File ID']) || '').trim();
      const name=keyLookup(r,['Name','name','Workout Name','Activity Name','Description','Title','description','title']);
      const rawType=keyLookup(r,['Type','type','Sport','sport','Activity Type','Workout Type','category']) || name;
      const sport=normalizeSport(rawType);
      const date=pickDate(r);
      if(!date){ skippedNoDate++; return; }
      const minutes=pickMinutes(r);
      if(!minutes){ skippedNoMinutes++; return; }
      const imported={
        id:'intervals-'+(externalId || `${date}-${sport}-${minutes}-${idx}`),
        externalId: externalId || `${date}-${sport}-${minutes}-${idx}`,
        source:'intervals',
        sport,
        date,
        minutes,
        distance:pickDistanceMiles(r, sport),
        hr:Math.round(asNumber(keyLookup(r,['Average HR','Avg HR','Average Heartrate','average_heartrate','avg_hr','average_hr','Heart Rate']))),
        power:Math.round(asNumber(keyLookup(r,['Average Watts','Avg Watts','Average Power','average_watts','avg_watts','Power']))),
        rpe:5,
        notes:name || 'Intervals.icu import'
      };
      const k=workoutKey(imported);
      if(!beforeKeys.has(k)) { workouts.unshift(imported); beforeKeys.add(k); importedCount++; }
    });
    dedupeAndSort(); save(); render();
    const msg=`Sync complete: ${importedCount} new imported. Total saved: ${workouts.length}. Skipped: ${skippedNoDate} no date, ${skippedNoMinutes} no duration.`;
    status(msg);
    alert(msg + (importedCount===0 ? '\n\nIf your workouts still do not show, send me the CSV headers shown under Sync status: '+headers : ''));
  }catch(e){
    status('Sync failed: '+e.message);
    alert('Sync failed. Error: '+e.message);
  }
}
$('syncBtn').onclick=syncIntervals;

function parseCSV(text){
  const rows=[]; let row=[], cell='', inQuotes=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i], next=text[i+1];
    if(ch==='"' && inQuotes && next==='"'){ cell+='"'; i++; continue; }
    if(ch==='"'){ inQuotes=!inQuotes; continue; }
    if(ch===',' && !inQuotes){ row.push(cell); cell=''; continue; }
    if((ch==='\n' || ch==='\r') && !inQuotes){
      if(ch==='\r' && next==='\n') i++;
      row.push(cell); cell='';
      if(row.some(v=>String(v).trim()!=='')) rows.push(row);
      row=[]; continue;
    }
    cell+=ch;
  }
  if(cell || row.length){ row.push(cell); rows.push(row); }
  if(rows.length<2) return [];
  const headers=rows[0].map(h=>String(h).trim());
  return rows.slice(1).map(vals=>{ let o={}; headers.forEach((h,i)=>o[h]=String(vals[i]||'').trim()); return o; });
}

function stats(days){ const cutoff=new Date(); cutoff.setDate(cutoff.getDate()-days); const ws=workouts.filter(w=>new Date(w.date+'T00:00:00')>=cutoff); const sports=['Swim','Ride','Run','Strength','BJJ']; return sports.map(s=>{ const arr=ws.filter(w=>w.sport===s); return `<div class="stat"><span>${s}</span><b>${arr.reduce((a,w)=>a+w.minutes,0)} min</b></div>` }).join('')+`<div class="stat"><span>Load</span><b>${ws.reduce((a,w)=>a+loadScore(w),0)}</b></div>`; }
function readiness(){ const last28=workouts.filter(w=>new Date(w.date+'T00:00:00')>=new Date(Date.now()-28*864e5)); const mins=s=>last28.filter(w=>w.sport===s).reduce((a,w)=>a+w.minutes,0); const swim=Math.min(100,mins('Swim')/360*100), bike=Math.min(100,mins('Ride')/720*100), run=Math.min(100,mins('Run')/420*100); const score=Math.round(swim*.3+bike*.35+run*.35); $('readiness').textContent=score+'%'; $('readinessText').textContent=score<50?'Base-building mode. Swim/run consistency are the main levers.':score<75?'Solid trend. Keep stacking weeks without cooking yourself.':'You are trending race-ready. Protect recovery.'; }
function coachNotes(){ const last7=workouts.filter(w=>new Date(w.date+'T00:00:00')>=new Date(Date.now()-7*864e5)); const load=last7.reduce((a,w)=>a+loadScore(w),0); let note=load>2500?'This week is spicy. Easy day or true Z2 next.':load<900?'Low-load week so far. Good chance to add aerobic volume.':'Balanced week. Keep the hard day hard and easy days boring.'; const bjj=last7.filter(w=>w.sport==='BJJ').length; if(bjj>=2) note+=' BJJ is already adding intensity, so do not sneak in extra hero workouts.'; $('coachNotes').textContent=note; }
function renderList(){ $('workouts').innerHTML=workouts.slice(0,100).map(w=>`<div class="workout"><span class="pill">${w.sport}</span><span class="pill ${loadScore(w)>600?'danger':loadScore(w)>350?'warn':'ok'}">Load ${loadScore(w)}</span><b>${w.date}</b><p>${w.minutes} min ${w.distance?`• ${w.distance} mi`:''} ${w.hr?`• HR ${w.hr}`:''} ${w.power?`• ${w.power}W`:''}</p><p>${analysis(w)}</p><small>${w.source==='intervals'?'Intervals.icu • ':''}${w.notes||''}</small></div>`).join('') || '<p>No workouts yet.</p>'; }
function drawChart(){ const c=$('chart'), ctx=c.getContext('2d'), dpr=devicePixelRatio||1; const width=c.clientWidth*dpr, height=180*dpr; c.width=width;c.height=height; ctx.clearRect(0,0,width,height); const days=[...Array(28)].map((_,i)=>{const d=new Date();d.setDate(d.getDate()-27+i); return d.toISOString().slice(0,10)}); const vals=days.map(day=>workouts.filter(w=>w.date===day).reduce((a,w)=>a+loadScore(w),0)); const max=Math.max(100,...vals); ctx.beginPath(); vals.forEach((v,i)=>{const x=i/(vals.length-1)*width,y=height-(v/max*height*.82)-15*dpr; i?ctx.lineTo(x,y):ctx.moveTo(x,y)}); ctx.lineWidth=3*dpr; ctx.stroke(); }
function render(){ dedupeAndSort(); $('weekStats').innerHTML=stats(7); $('monthStats').innerHTML=stats(28); readiness(); coachNotes(); renderList(); drawChart(); }
$('exportCsv').onclick=()=>{ const header='date,sport,minutes,distance,hr,power,rpe,source,notes\n'; const csv=header+workouts.map(w=>[w.date,w.sport,w.minutes,w.distance,w.hr,w.power,w.rpe,w.source,`"${(w.notes||'').replaceAll('"','""')}"`].join(',')).join('\n'); const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download='tri-tracker-workouts.csv'; a.click(); };
let deferredPrompt; window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('installBtn').hidden=false}); $('installBtn').onclick=()=>deferredPrompt?.prompt();
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
render();
