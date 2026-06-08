const $ = id => document.getElementById(id);
const storeKey = 'tri_tracker_workouts_v1';
const settingsKey = 'tri_tracker_settings_v1';
let workouts = JSON.parse(localStorage.getItem(storeKey) || '[]');
let settings = JSON.parse(localStorage.getItem(settingsKey) || '{}');
$('date').valueAsDate = new Date();
$('athleteId').value = settings.athleteId || '';
$('apiKey').value = settings.apiKey || '';

function save(){ localStorage.setItem(storeKey, JSON.stringify(workouts)); }
function saveSettings(){ settings={athleteId:$('athleteId').value.trim(),apiKey:$('apiKey').value.trim()}; localStorage.setItem(settingsKey,JSON.stringify(settings)); alert('Saved on this device.'); }
$('saveSettings').onclick=saveSettings;

function normalizeSport(s){s=(s||'').toLowerCase(); if(s.includes('swim'))return 'Swim'; if(s.includes('run'))return 'Run'; if(s.includes('ride')||s.includes('bike')||s.includes('cycle'))return 'Ride'; if(s.includes('strength'))return 'Strength'; if(s.includes('bjj')||s.includes('jiu'))return 'BJJ'; return s? s[0].toUpperCase()+s.slice(1):'Other'}
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
$('addWorkout').onclick=()=>{ const w={id:crypto.randomUUID(),source:'manual',sport:$('sport').value,date:$('date').value,minutes:+$('minutes').value||0,distance:+$('distance').value||0,hr:+$('hr').value||0,power:+$('power').value||0,rpe:+$('rpe').value||5,notes:$('notes').value}; workouts.unshift(w); save(); render(); };

async function syncIntervals(){
  saveSettings(); const id=settings.athleteId || '0', key=settings.apiKey; if(!key) return alert('Add your Intervals.icu API key first.');
  const url=`https://intervals.icu/api/v1/athlete/${encodeURIComponent(id)}/activities.csv?oldest=${new Date(Date.now()-1000*60*60*24*90).toISOString().slice(0,10)}`;
  try{
    const res=await fetch(url,{headers:{Authorization:'Basic '+btoa('API_KEY:'+key)}});
    if(!res.ok) throw new Error(res.status+' '+res.statusText);
    const csv=await res.text(); const rows=parseCSV(csv); const imported=[];
    rows.forEach(r=>{ const sport=normalizeSport(r.type||r.sport||r.name); const date=(r.start_date_local||r.start_date||r.date||'').slice(0,10); if(!date) return; const idd='intervals-'+(r.id||date+'-'+r.name); if(workouts.some(w=>w.id===idd))return; imported.push({id:idd,source:'intervals',sport,date,minutes:Math.round((+r.moving_time||+r.elapsed_time||0)/60)||(+r.duration||0),distance:Math.round(((+r.distance||0)/1609.34)*100)/100,hr:+(r.average_heartrate||r.avg_hr||0),power:+(r.average_watts||r.avg_watts||0),rpe:5,notes:r.name||''}); });
    workouts=[...imported,...workouts].sort((a,b)=>b.date.localeCompare(a.date)); save(); render(); alert(`Imported ${imported.length} workouts.`);
  }catch(e){ alert('Sync failed. Intervals.icu may block browser sync by CORS. If so, this app needs a tiny hosted backend/proxy. Error: '+e.message); }
}
$('syncBtn').onclick=syncIntervals;
function parseCSV(text){ const lines=text.trim().split(/\r?\n/); if(lines.length<2)return []; const headers=lines[0].split(',').map(h=>h.replaceAll('"','').trim()); return lines.slice(1).map(line=>{ const vals=line.match(/("[^"]*"|[^,])+/g)||[]; let o={}; headers.forEach((h,i)=>o[h]=String(vals[i]||'').replace(/^"|"$/g,'')); return o; }); }

function stats(days){ const cutoff=new Date(); cutoff.setDate(cutoff.getDate()-days); const ws=workouts.filter(w=>new Date(w.date)>=cutoff); const sports=['Swim','Ride','Run','Strength','BJJ']; return sports.map(s=>{ const arr=ws.filter(w=>w.sport===s); return `<div class="stat"><span>${s}</span><b>${arr.reduce((a,w)=>a+w.minutes,0)} min</b></div>` }).join('')+`<div class="stat"><span>Load</span><b>${ws.reduce((a,w)=>a+loadScore(w),0)}</b></div>`; }
function readiness(){ const last28=workouts.filter(w=>new Date(w.date)>=new Date(Date.now()-28*864e5)); const mins=s=>last28.filter(w=>w.sport===s).reduce((a,w)=>a+w.minutes,0); const swim=Math.min(100,mins('Swim')/360*100), bike=Math.min(100,mins('Ride')/720*100), run=Math.min(100,mins('Run')/420*100); const score=Math.round(swim*.3+bike*.35+run*.35); $('readiness').textContent=score+'%'; $('readinessText').textContent=score<50?'Base-building mode. Swim/run consistency are the main levers.':score<75?'Solid trend. Keep stacking weeks without cooking yourself.':'You are trending race-ready. Protect recovery.'; }
function coachNotes(){ const last7=workouts.filter(w=>new Date(w.date)>=new Date(Date.now()-7*864e5)); const load=last7.reduce((a,w)=>a+loadScore(w),0); let note=load>2500?'This week is spicy. Easy day or true Z2 next.':load<900?'Low-load week so far. Good chance to add aerobic volume.':'Balanced week. Keep the hard day hard and easy days boring.'; const bjj=last7.filter(w=>w.sport==='BJJ').length; if(bjj>=2) note+=' BJJ is already adding intensity, so do not sneak in extra hero workouts.'; $('coachNotes').textContent=note; }
function renderList(){ $('workouts').innerHTML=workouts.slice(0,50).map(w=>`<div class="workout"><span class="pill">${w.sport}</span><span class="pill ${loadScore(w)>600?'danger':loadScore(w)>350?'warn':'ok'}">Load ${loadScore(w)}</span><b>${w.date}</b><p>${w.minutes} min ${w.distance?`• ${w.distance} mi`:''} ${w.hr?`• HR ${w.hr}`:''} ${w.power?`• ${w.power}W`:''}</p><p>${analysis(w)}</p><small>${w.notes||''}</small></div>`).join('') || '<p>No workouts yet.</p>'; }
function drawChart(){ const c=$('chart'), ctx=c.getContext('2d'), dpr=devicePixelRatio||1; const width=c.clientWidth*dpr, height=180*dpr; c.width=width;c.height=height; ctx.clearRect(0,0,width,height); const days=[...Array(28)].map((_,i)=>{const d=new Date();d.setDate(d.getDate()-27+i); return d.toISOString().slice(0,10)}); const vals=days.map(day=>workouts.filter(w=>w.date===day).reduce((a,w)=>a+loadScore(w),0)); const max=Math.max(100,...vals); ctx.beginPath(); vals.forEach((v,i)=>{const x=i/(vals.length-1)*width,y=height-(v/max*height*.82)-15*dpr; i?ctx.lineTo(x,y):ctx.moveTo(x,y)}); ctx.lineWidth=3*dpr; ctx.stroke(); }
function render(){ $('weekStats').innerHTML=stats(7); $('monthStats').innerHTML=stats(28); readiness(); coachNotes(); renderList(); drawChart(); }
$('exportCsv').onclick=()=>{ const header='date,sport,minutes,distance,hr,power,rpe,notes\n'; const csv=header+workouts.map(w=>[w.date,w.sport,w.minutes,w.distance,w.hr,w.power,w.rpe,`"${(w.notes||'').replaceAll('"','""')}"`].join(',')).join('\n'); const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download='tri-tracker-workouts.csv'; a.click(); };
let deferredPrompt; window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('installBtn').hidden=false}); $('installBtn').onclick=()=>deferredPrompt?.prompt();
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
render();
