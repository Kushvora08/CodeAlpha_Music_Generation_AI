/* ═══════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════ */
const NOTES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const SCALES = {
  major:[0,2,4,5,7,9,11], minor:[0,2,3,5,7,8,10],
  pentatonic:[0,2,4,7,9], blues:[0,3,5,6,7,10],
  dorian:[0,2,3,5,7,9,10], mixolydian:[0,2,4,5,7,9,10]
};
const GENRE_CFG = {
  Classical:{ tempo:88,  oct:[4,5], durations:[0.5,0.5,1,1,1,2],     dynamics:0.68, preferredScale:"major",      complexity:0.6, color:"#6C63FF" },
  Jazz:     { tempo:120, oct:[3,5], durations:[0.25,0.5,0.5,0.75,1], dynamics:0.78, preferredScale:"dorian",     complexity:0.9, color:"#F97316" },
  Ambient:  { tempo:60,  oct:[4,6], durations:[1,1.5,2,2,3],         dynamics:0.42, preferredScale:"pentatonic", complexity:0.3, color:"#10B981" },
  Blues:    { tempo:96,  oct:[3,5], durations:[0.25,0.5,0.5,1,1],    dynamics:0.82, preferredScale:"blues",      complexity:0.7, color:"#8B5CF6" },
  Celtic:   { tempo:140, oct:[4,5], durations:[0.25,0.5,0.5,1],      dynamics:0.73, preferredScale:"major",      complexity:0.4, color:"#0EA5E9" },
};

/* ═══════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════ */
let melody = [], activeIdx = -1, isPlaying = false, stopFlag = false;
let seedCount = 1, currentGenre = "Classical";
let audioCtx = null;
let trainTimer = null, isTraining = false;
let lossHist = [], accHist = [];
let wavePhase = 0, waveAmp = 0, waveRAF = null;
let exploreScale = "major";

/* ═══════════════════════════════════════════════════════
   SEEDED RNG
═══════════════════════════════════════════════════════ */
function rng(s){ s=(s*1664525+1013904223)&0xffffffff; return [(s>>>0)/4294967296, s]; }

/* ═══════════════════════════════════════════════════════
   GENERATE MELODY
═══════════════════════════════════════════════════════ */
function generateSequence(genre,key,scale,n,seed,temp){
  const cfg = GENRE_CFG[genre];
  const intervals = SCALES[scale]||SCALES[cfg.preferredScale];
  const keyIdx = NOTES.indexOf(key);
  const [minO,maxO] = cfg.oct;
  const steps=[0,1,2,-1,-2,3,-3];
  const wts  =[0.30,0.22,0.16,0.14,0.10,0.05,0.03];
  let s = seed*999983+7, prevI=0, notes=[];
  for(let i=0;i<n;i++){
    let r,v; [r,s]=rng(s);
    let ni;
    if(i===0||r<temp){ [v,s]=rng(s); ni=Math.floor(v*intervals.length); }
    else{
      [v,s]=rng(s); let cum=0; ni=prevI;
      for(let j=0;j<steps.length;j++){
        cum+=wts[j];
        if(v<cum){ ni=(prevI+steps[j]+intervals.length*8)%intervals.length; break; }
      }
    }
    prevI=ni;
    const semi=(keyIdx+intervals[ni])%12;
    let ov; [ov,s]=rng(s); const oct=minO+Math.floor(ov*(maxO-minO+1));
    let dv; [dv,s]=rng(s); const dur=cfg.durations[Math.floor(dv*cfg.durations.length)];
    let vv; [vv,s]=rng(s); const vel=Math.max(0.4,Math.min(1,cfg.dynamics+(vv-0.5)*0.35));
    notes.push({note:NOTES[semi],oct,semi,dur,vel,ni});
  }
  return notes;
}

/* ═══════════════════════════════════════════════════════
   FREQUENCY SPEC
═══════════════════════════════════════════════════════ */
function noteFreq(note,oct){ return 440*Math.pow(2,(NOTES.indexOf(note)-9+(oct-4)*12)/12); }

/* ═══════════════════════════════════════════════════════
   AUDIO CONTEXT
═══════════════════════════════════════════════════════ */
function getCtx(){
  if(!audioCtx||audioCtx.state==='closed') audioCtx=new(window.AudioContext||window.webkitAudioContext)();
  if(audioCtx.state==='suspended') audioCtx.resume();
  return audioCtx;
}

/* ═══════════════════════════════════════════════════════
   WAVEFORM CANVAS
═══════════════════════════════════════════════════════ */
function startWave(color){
  cancelAnimationFrame(waveRAF);
  const cv=document.getElementById('waveCanvas');
  const cx=cv.getContext('2d');
  const W=cv.width, H=cv.height;
  function draw(){
    cx.clearRect(0,0,W,H);
    wavePhase+=0.055;
    const amp=(H/2-6)*waveAmp*0.88;
    /* glow */
    cx.shadowColor=color||'#6C63FF'; cx.shadowBlur=isPlaying?12:0;
    cx.strokeStyle=color||'#6C63FF'; cx.lineWidth=2.2;
    cx.beginPath();
    for(let x=0;x<W;x++){
      const t=x/W;
      const y=H/2+amp*(0.55*Math.sin(2*Math.PI*t*4+wavePhase)+0.28*Math.sin(2*Math.PI*t*9+wavePhase*1.4)+0.17*Math.sin(2*Math.PI*t*16+wavePhase*0.6));
      x===0?cx.moveTo(x,y):cx.lineTo(x,y);
    }
    cx.stroke();
    /* ghost */
    cx.shadowBlur=0; cx.strokeStyle=(color||'#6C63FF')+'30'; cx.lineWidth=1;
    cx.beginPath();
    for(let x=0;x<W;x++){
      const t=x/W;
      const y=H/2-amp*0.38*(0.6*Math.sin(2*Math.PI*t*3+wavePhase*0.8)+0.4*Math.sin(2*Math.PI*t*7+wavePhase*1.1));
      x===0?cx.moveTo(x,y):cx.lineTo(x,y);
    }
    cx.stroke();
    if(isPlaying) waveRAF=requestAnimationFrame(draw);
  }
  waveRAF=requestAnimationFrame(draw);
}

function stopWave(){
  cancelAnimationFrame(waveRAF); waveAmp=0;
  const cv=document.getElementById('waveCanvas');
  const cx=cv.getContext('2d');
  if(!cv) return;
  cx.clearRect(0,0,cv.width,cv.height);
  cx.shadowBlur=0; cx.strokeStyle='rgba(108,99,255,0.15)'; cx.lineWidth=0.8;
  cx.setLineDash([6,6]);
  cx.beginPath(); cx.moveTo(0,cv.height/2); cx.lineTo(cv.width,cv.height/2); cx.stroke();
  cx.setLineDash([]);
}

/* ═══════════════════════════════════════════════════════
   PIANO ROLL
═══════════════════════════════════════════════════════ */
function drawRoll(active){
  const cv=document.getElementById('rollCanvas');
  const cx=cv.getContext('2d');
  const W=cv.width, H=cv.height;
  cx.clearRect(0,0,W,H);
  if(!melody.length) return;
  const vis=melody.slice(0,40);
  const semis=vis.map(n=>n.semi+n.oct*12);
  const minS=Math.min(...semis)-1, maxS=Math.max(...semis)+1;
  const range=Math.max(maxS-minS,12);
  const cellH=Math.min(13,Math.floor(H/range));
  const cellW=Math.max(18,Math.floor(W/vis.length));
  /* grid */
  for(let i=0;i<range;i++){
    const s=maxS-i;
    if(NOTES[s%12]?.includes('#')){ cx.fillStyle='rgba(108,99,255,0.04)'; cx.fillRect(0,i*cellH,W,cellH); }
    cx.strokeStyle='rgba(200,195,255,0.3)'; cx.lineWidth=0.4;
    cx.beginPath(); cx.moveTo(0,i*cellH); cx.lineTo(W,i*cellH); cx.stroke();
  }
  /* notes */
  vis.forEach((n,i)=>{
    const s=n.semi+n.oct*12;
    const top=(maxS-s)*cellH, left=i*cellW+1;
    const w=Math.max(14,n.dur*cellW)-2;
    const isAct=i===active;
    const alpha=0.2+n.vel*0.6;
    cx.shadowBlur=isAct?10:0; cx.shadowColor='rgba(108,99,255,0.5)';
    cx.fillStyle=isAct?'#6C63FF':`rgba(108,99,255,${alpha})`;
    cx.beginPath();
    cx.roundRect?cx.roundRect(left,top+1,w,cellH-2,3):cx.rect(left,top+1,w,cellH-2);
    cx.fill(); cx.shadowBlur=0;
  });
  cv.width=Math.max(760,vis.length*cellW+10);
}

/* ═══════════════════════════════════════════════════════
   NOTE GRID
═══════════════════════════════════════════════════════ */
function renderNoteGrid(active){
  const el=document.getElementById('noteGrid');
  if(!melody.length){ el.innerHTML='<span style="font-size:12px;color:#C0C0DC;align-self:center">Generate a melody to see notes here</span>'; return; }
  el.innerHTML=melody.map((n,i)=>`
    <div class="note-chip ${i===active?'active':''}" id="nc${i}">
      <span class="pitch">${n.note}${n.oct}</span>
      <span class="dur">${n.dur}b</span>
    </div>`).join('');
}

/* ═══════════════════════════════════════════════════════
   CORE ACTIONS
═══════════════════════════════════════════════════════ */
async function handleGenerate(){
  const btn=document.getElementById('btnGenerate');
  btn.disabled=true; btn.innerHTML='<span class="btn-icon spin">⟳</span> Generating…';
  setStatus('Generating…','orange');
  addLog('Generating melody…','info');
  await delay(400);
  const key=document.getElementById('selKey').value;
  const scale=document.getElementById('selScale').value;
  const n=parseInt(document.getElementById('rNotes').value);
  const temp=parseFloat(document.getElementById('rTemp').value);
  melody=generateSequence(currentGenre,key,scale,n,seedCount++,temp);
  activeIdx=-1;
  renderNoteGrid(-1);
  drawRoll(-1);
  document.getElementById('s-notes').textContent=melody.length;
  document.getElementById('s-key').textContent=key+' '+scale;
  document.getElementById('seqStats').textContent=melody.length+' notes';
  document.getElementById('infoBar').style.display='flex';
  document.getElementById('infoBar').innerHTML=`
    <span><b>${melody.length}</b> notes</span>
    <span>Key: <b>${key} ${scale}</b></span>
    <span>Genre: <b>${currentGenre}</b></span>
    <span>Tempo: <b>${document.getElementById('rTempo').value} BPM</b></span>
    <span>Creativity: <b>${temp.toFixed(2)}</b></span>`;
  document.getElementById('btnPlay').disabled=false;
  document.getElementById('btnExport').disabled=false;
  btn.disabled=false; btn.innerHTML='<span class="btn-icon">✨</span> Generate melody';
  setStatus('Ready','green');
  addLog(`Generated ${melody.length} notes — ${currentGenre}, ${key} ${scale}, temp=${temp.toFixed(2)}`,'ok');
}

async function handlePlay(){
  if(isPlaying){ stopFlag=true; return; }
  if(!melody.length){ addLog('Generate a melody first','warn'); return; }
  stopFlag=false; isPlaying=true;
  document.getElementById('btnPlay').innerHTML='<span class="btn-icon">⏹</span> Stop';
  document.getElementById('btnPlay').className='btn btn-danger';
  document.getElementById('btnGenerate').disabled=true;
  document.getElementById('statusDot').style.visibility='visible';
  setStatus('Playing…','accent');
  const ctx=getCtx();
  const tempo=parseInt(document.getElementById('rTempo').value);
  const vol=parseInt(document.getElementById('rVol').value)/100;
  const beatSec=60/tempo;
  const color=GENRE_CFG[currentGenre].color;
  waveAmp=0.5; startWave(color);
  addLog(`Playing ${melody.length} notes at ${tempo} BPM`,'ok');

  for(let i=0;i<melody.length;i++){
    if(stopFlag) break;
    const n=melody[i];
    activeIdx=i;
    waveAmp=n.vel;
    renderNoteGrid(i); drawRoll(i);
    document.getElementById('noteCounter').textContent=`Note ${i+1} / ${melody.length}`;
    const chip=document.getElementById('nc'+i);
    if(chip) chip.scrollIntoView({block:'nearest',inline:'center',behavior:'smooth'});
    const dur=n.dur*beatSec;
    const freq=noteFreq(n.note,n.oct);
    const osc=ctx.createOscillator();
    const gain=ctx.createGain();
    const filt=ctx.createBiquadFilter();
    filt.type='lowpass'; filt.frequency.value=Math.min(4000,800+freq*3); filt.Q.value=0.5;
    osc.connect(filt); filt.connect(gain); gain.connect(ctx.destination);
    osc.type='triangle'; osc.frequency.value=freq;
    const now=ctx.currentTime;
    gain.gain.setValueAtTime(0,now);
    gain.gain.linearRampToValueAtTime(n.vel*vol*0.6,now+0.015);
    gain.gain.setValueAtTime(n.vel*vol*0.4,now+dur*0.65);
    gain.gain.linearRampToValueAtTime(0.0001,now+dur*0.92);
    osc.start(now); osc.stop(now+dur);
    await delay(dur*1000);
  }
  isPlaying=false; stopFlag=false; activeIdx=-1;
  renderNoteGrid(-1); drawRoll(-1); stopWave();
  document.getElementById('btnPlay').innerHTML='<span class="btn-icon">▶</span> Play';
  document.getElementById('btnPlay').className='btn btn-ghost';
  document.getElementById('btnGenerate').disabled=false;
  document.getElementById('statusDot').style.visibility='hidden';
  document.getElementById('noteCounter').textContent='';
  setStatus('Ready','green');
  addLog('playback complete','ok');
}

function handleExport(){
  if(!melody.length){ addLog('Nothing to export','warn'); return; }
  const tempo=parseInt(document.getElementById('rTempo').value);
  const uspb=Math.round(60000000/tempo);
  const hdr=[0x4D,0x54,0x68,0x64,0,0,0,6,0,0,0,1,0,96];
  const ev=[0x00,0xFF,0x51,0x03,(uspb>>16)&0xFF,(uspb>>8)&0xFF,uspb&0xFF];
  melody.forEach(n=>{
    const midi=NOTES.indexOf(n.note)+(n.oct+1)*12;
    const ticks=Math.round(n.dur*96);
    const vel=Math.round(n.vel*100);
    ev.push(0x00,0x90,midi,vel);
    const dt=ticks<128?[ticks]:[(ticks>>7)|0x80,ticks&0x7F];
    ev.push(...dt,0x80,midi,0x00);
  });
  ev.push(0x00,0xFF,0x2F,0x00);
  const trk=[0x4D,0x54,0x72,0x6B,(ev.length>>24)&0xFF,(ev.length>>16)&0xFF,(ev.length>>8)&0xFF,ev.length&0xFF,...ev];
  const bytes=new Uint8Array([...hdr,...trk]);
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([bytes],{type:'audio/midi'}));
  a.download=`cadenza_${currentGenre.toLowerCase()}_${Date.now()}.mid`;
  a.click();
  addLog(`MIDI exported — ${melody.length} notes, ${tempo} BPM`,'ok');
}

/* ═══════════════════════════════════════════════════════
   TRAINING PIPELINE
═══════════════════════════════════════════════════════ */
function handleTrain(){
  if(isTraining) return;
  isTraining=true; lossHist=[]; accHist=[];
  document.getElementById('btnTrain').disabled=true;
  document.getElementById('btnTrain').innerHTML='<span class="btn-icon spin">⟳</span> <span id="trainLabel">Training…</span>';
  document.getElementById('btnPause').disabled=false;
  document.getElementById('trainSuccess').style.display='none';
  const ds=document.querySelector('#datasetList .active')?.dataset.val||'Classical MIDI';
  const md=document.querySelector('#modelList .active')?.dataset.val||'LSTM';
  addLog(`Training ${md} on "${ds}"`,'info');
  let e=0;
  trainTimer=setInterval(()=>{
    e++;
    const p=e/50;
    const loss=Math.max(0.04,1.9*Math.exp(-p*2.6)+(Math.random()-0.5)*0.07);
    const acc=Math.min(0.99,0.08+0.91*(1-Math.exp(-p*3))+(Math.random()-0.5)*0.03);
    lossHist.push(loss); accHist.push(acc);
    document.getElementById('tEpoch').textContent=e+' / 50';
    document.getElementById('tLoss').textContent=loss.toFixed(4);
    document.getElementById('tAcc').textContent=(acc*100).toFixed(1)+'%';
    document.getElementById('tBar').style.width=(p*100)+'%';
    document.getElementById('tPct').textContent=Math.round(p*100)+'%';
    document.getElementById('tStatus').textContent='Training…';
    drawTrainChart();
    if(e%10===0) addLog(`Epoch ${e}/50 — loss ${loss.toFixed(4)}, acc ${(acc*100).toFixed(1)}%`,'ok');
    if(e>=50){
      clearInterval(trainTimer); isTraining=false;
      document.getElementById('btnTrain').disabled=false;
      document.getElementById('btnTrain').innerHTML='<span class="btn-icon">🧠</span> Retrain';
      document.getElementById('btnPause').disabled=true;
      document.getElementById('tStatus').textContent='Ready ✓';
      document.getElementById('trainSuccess').style.display='flex';
      addLog('Training complete — model ready','ok');
    }
  },110);
}

function handlePauseTrain(){
  clearInterval(trainTimer); isTraining=false;
  document.getElementById('btnTrain').disabled=false;
  document.getElementById('btnTrain').innerHTML='<span class="btn-icon">🧠</span> Resume training';
  document.getElementById('btnPause').disabled=true;
  document.getElementById('tStatus').textContent='Paused';
  addLog('Training paused','warn');
}

function drawTrainChart(){
  const cv=document.getElementById('trainCanvas');
  if(!cv) return;
  const cx=cv.getContext('2d');
  const W=cv.width, H=cv.height;
  cx.clearRect(0,0,W,H);
  cx.fillStyle='rgba(248,246,255,0.6)'; cx.fillRect(0,0,W,H);
  for(let i=0;i<=4;i++){
    const y=8+(i/4)*(H-16);
    cx.strokeStyle='rgba(200,195,255,0.35)'; cx.lineWidth=0.5;
    cx.beginPath(); cx.moveTo(0,y); cx.lineTo(W,y); cx.stroke();
    cx.fillStyle='rgba(160,160,192,0.6)'; cx.font='10px Inter,sans-serif'; cx.textAlign='left';
    cx.fillText((1-i/4).toFixed(1),2,y+3);
  }
  function drawLine(data,color){
    if(data.length<2) return;
    cx.strokeStyle=color; cx.lineWidth=2;
    cx.beginPath();
    data.forEach((v,i)=>{
      const x=(i/(data.length-1))*W;
      const y=8+(1-Math.min(1,v))*(H-16);
      i===0?cx.moveTo(x,y):cx.lineTo(x,y);
    });
    cx.stroke();
  }
  drawLine(lossHist,'#6C63FF');
  drawLine(accHist,'#10B981');
  if(!lossHist.length){
    cx.fillStyle='rgba(160,160,192,0.5)'; cx.font='12px Inter,sans-serif'; cx.textAlign='center';
    cx.fillText('Training metrics appear here',W/2,H/2);
  }
}

/* ═══════════════════════════════════════════════════════
   TABS AND GENRES CONTROLLERS
═══════════════════════════════════════════════════════ */
function setGenreByName(genreName) {
  currentGenre = genreName;
  const cfg = GENRE_CFG[currentGenre];
  document.getElementById('rTempo').value = cfg.tempo;
  document.getElementById('lTempo').textContent = cfg.tempo + ' BPM';
  document.getElementById('s-tempo').textContent = cfg.tempo + ' BPM';
  document.getElementById('s-genre').textContent = currentGenre;
  document.getElementById('selScale').value = cfg.preferredScale;
  document.getElementById('s-key').textContent = document.getElementById('selKey').value + ' ' + cfg.preferredScale;
  addLog(`Switched to ${currentGenre} — tempo ${cfg.tempo} BPM, scale: ${cfg.preferredScale}`, 'info');
  buildGenreChart();
}

function switchTab(id) {
  ['generate', 'train', 'explore'].forEach(t => {
    document.getElementById('tab-' + t).style.display = t === id ? 'block' : 'none';
  });
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.remove('active');
    if(b.dataset.tab === id) b.classList.add('active');
  });
  if (id === 'explore') { buildScaleNotes(exploreScale); buildGenreChart(); }
  if (id === 'train') { drawTrainChart(); }
}

function buildScaleNotes(scale){
  const key=document.getElementById('selKey').value;
  document.getElementById('scaleTitle').textContent=key+' '+scale;
  const intervals=SCALES[scale]||SCALES.major;
  const keyIdx=NOTES.indexOf(key);
  const degrees=['R','2','3','4','5','6','7','8','9'];
  const el=document.getElementById('scaleNotes');
  el.innerHTML=intervals.map((intv,i)=>{
    const semi=(keyIdx+intv)%12;
    const name=NOTES[semi];
    const isBlack=name.includes('#');
    const isRoot=i===0;
    return `<div class="scale-note ${isRoot?'root':isBlack?'black-key':''}">
      ${name}<span class="degree">${degrees[i]||''}</span>
    </div>`;
  }).join('');
}

function buildGenreChart(){
  const el=document.getElementById('genreChart');
  const genres=Object.keys(GENRE_CFG);
  el.innerHTML=genres.map(g=>{
    const c=GENRE_CFG[g];
    const active=g===currentGenre;
    return `<div class="genre-bar-row">
      <div style="width:8px;height:8px;border-radius:50%;background:${c.color};flex-shrink:0"></div>
      <span style="width:76px;font-size:12px;font-weight:${active?'600':'400'};color:${active?'#1C1C2E':'#7B7B9D'}">${g}</span>
      <span style="width:56px;font-size:11px;color:#9090B0">${c.tempo} BPM</span>
      <div class="genre-bar-track">
        <div class="genre-bar-fill" style="width:${c.complexity*100}%;background:${c.color}"></div>
      </div>
      <span style="width:76px;font-size:11px;color:#9090B0;text-align:right">${c.preferredScale}</span>
      <button class="btn-use-genre" data-genre="${g}"
        style="font-size:10px;padding:3px 8px;border-radius:6px;background:rgba(108,99,255,0.06);border:1px solid rgba(108,99,255,0.18);color:#6C63FF;cursor:pointer;font-family:inherit">Use</button>
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════
   UI LOGGER UTILS
═══════════════════════════════════════════════════════ */
function addLog(msg,type='info'){
  const el=document.getElementById('console');
  const t=new Date().toLocaleTimeString();
  const d=document.createElement('div');
  d.className='log-line';
  d.innerHTML=`<span class="log-t">${t}</span><span class="log-${type}">${msg}</span>`;
  el.appendChild(d); el.scrollTop=el.scrollHeight;
  if(el.children.length>30) el.removeChild(el.firstChild);
}
function clearLog(){ document.getElementById('console').innerHTML=''; }
function setStatus(text,type){
  const el=document.getElementById('s-status');
  el.textContent=text;
  el.className='stat-val'+(type?(' '+type):'');
}
function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }

/* ═══════════════════════════════════════════════════════
   DOM LISTENERS SETUP
═══════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Action handles
  document.getElementById('btnGenerate').addEventListener('click', handleGenerate);
  document.getElementById('btnPlay').addEventListener('click', handlePlay);
  document.getElementById('btnExport').addEventListener('click', handleExport);
  document.getElementById('btnTrain').addEventListener('click', handleTrain);
  document.getElementById('btnPause').addEventListener('click', handlePauseTrain);
  document.getElementById('btnClearLog').addEventListener('click', clearLog);
  document.getElementById('btnSuccessGo').addEventListener('click', () => switchTab('generate'));

  // Sync Slider values text
  document.getElementById('rNotes').addEventListener('input', (e) => {
    document.getElementById('lNotes').textContent = e.target.value;
  });
  document.getElementById('rTempo').addEventListener('input', (e) => {
    document.getElementById('lTempo').textContent = e.target.value + ' BPM';
    document.getElementById('s-tempo').textContent = e.target.value + ' BPM';
  });
  document.getElementById('rTemp').addEventListener('input', (e) => {
    document.getElementById('lTemp').textContent = parseFloat(e.target.value).toFixed(2);
  });
  document.getElementById('rVol').addEventListener('input', (e) => {
    document.getElementById('lVol').textContent = e.target.value + '%';
  });

  // Top Genre Switcher
  document.querySelector('.genre-rail').addEventListener('click', (e) => {
    const pill = e.target.closest('.genre-pill');
    if (!pill) return;
    document.querySelectorAll('.genre-pill').forEach(b => b.classList.remove('active'));
    pill.classList.add('active');
    setGenreByName(pill.dataset.genre);
  });

  // Main Nav Switching
  document.querySelector('.nav').addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-btn');
    if (btn) switchTab(btn.dataset.tab);
  });

  // Explore: scale pills switcher
  document.getElementById('scalePills').addEventListener('click', (e) => {
    const pill = e.target.closest('.genre-pill');
    if (!pill) return;
    exploreScale = pill.dataset.scale;
    document.querySelectorAll('#scalePills .genre-pill').forEach(b => b.classList.remove('active'));
    pill.classList.add('active');
    buildScaleNotes(exploreScale);
  });

  // Explore: dynamic 'Use' buttons hooks inside generated markup
  document.getElementById('genreChart').addEventListener('click', (e) => {
    const targetBtn = e.target.closest('.btn-use-genre');
    if (!targetBtn) return;
    const targetGenre = targetBtn.dataset.genre;
    const syncPill = document.querySelector(`.genre-pill[data-genre="${targetGenre}"]`);
    if(syncPill) {
      document.querySelectorAll('.genre-pill').forEach(b => b.classList.remove('active'));
      syncPill.classList.add('active');
    }
    setGenreByName(targetGenre);
  });

  // Training options grouping selects
  const setupOptionGroup = (containerId) => {
    document.getElementById(containerId).addEventListener('click', (e) => {
      const targetBtn = e.target.closest('.option-btn');
      if (!targetBtn) return;
      document.querySelectorAll(`#${containerId} .option-btn`).forEach(b => b.classList.remove('active'));
      targetBtn.classList.add('active');
    });
  };
  setupOptionGroup('datasetList');
  setupOptionGroup('modelList');

  // Initialize Canvas layouts
  stopWave();
  drawTrainChart();
  buildScaleNotes('major');
  buildGenreChart();
});
