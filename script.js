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
const GENRE_RHYTHMS = {
  Classical:[[1,1,0.5,0.5],[0.5,0.5,1,1],[1,0.5,0.5,2],[0.5,1,0.5,1]],
  Jazz:[[0.5,0.5,0.75,0.25],[0.25,0.5,0.25,1],[0.75,0.25,0.5,0.5],[0.5,1,0.25,0.25]],
  Ambient:[[2,1,1.5,2],[1.5,2,1,3],[2,2,1,1.5],[1,3,2,2]],
  Blues:[[0.5,0.5,1,0.5],[0.25,0.5,0.25,1],[1,0.5,0.5,1],[0.5,1,0.5,0.5]],
  Celtic:[[0.5,0.5,0.25,0.25],[0.25,0.25,0.5,0.5],[0.5,0.25,0.25,1],[0.25,0.5,0.25,0.5]],
};
const GENRE_PROFILES = {
  Classical:{home:0.72, repeat:0.10, leap:0.10, turn:0.55, octaveRestless:0.12},
  Jazz:{home:0.55, repeat:0.14, leap:0.22, turn:0.40, octaveRestless:0.20},
  Ambient:{home:0.82, repeat:0.28, leap:0.05, turn:0.78, octaveRestless:0.08},
  Blues:{home:0.64, repeat:0.18, leap:0.16, turn:0.52, octaveRestless:0.16},
  Celtic:{home:0.70, repeat:0.08, leap:0.12, turn:0.62, octaveRestless:0.10},
};
const SAMPLE_ARPEGGIO = [
  {step:0, hold:2},
  {step:2, hold:1.75},
  {step:4, hold:0.25},
  {step:7, hold:0.25},
  {step:9, hold:0.25},
  {step:4, hold:0.25},
  {step:7, hold:0.25},
  {step:9, hold:0.25},
];

/* ═══════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════ */
let melody = [], activeIdx = -1, isPlaying = false, stopFlag = false;
let seedCount = 1, currentGenre = "Classical";
let audioCtx = null;
let trainTimer = null, isTraining = false;
let lossHist = [], accHist = [];
let wavePhase = 0, waveAmp = 0, waveRAF = null;
let bgPhase = 0, bgRAF = null;
let exploreScale = "major";

/* ═══════════════════════════════════════════════════════
   SEEDED RNG
═══════════════════════════════════════════════════════ */
function rng(s){ s=(s*1664525+1013904223)&0xffffffff; return [(s>>>0)/4294967296, s]; }
function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }
function nextRand(state){ let r; [r,state.seed]=rng(state.seed); return r; }
function weightedChoice(items,weights,state){
  const total=weights.reduce((sum,w)=>sum+w,0);
  let r=nextRand(state)*total;
  for(let i=0;i<items.length;i++){
    r-=weights[i];
    if(r<=0) return items[i];
  }
  return items[items.length-1];
}

/* ═══════════════════════════════════════════════════════
   GENERATE MELODY
═══════════════════════════════════════════════════════ */
function generatePhraseSequence(genre,key,scale,n,seed,temp){
  const cfg = GENRE_CFG[genre]||GENRE_CFG.Classical;
  const profile = GENRE_PROFILES[genre]||GENRE_PROFILES.Classical;
  const intervals = SCALES[scale]||SCALES[cfg.preferredScale];
  const keyIdx = NOTES.indexOf(key);
  const [minO,maxO] = cfg.oct;
  const scaleLen = intervals.length;
  const octaveCount = maxO-minO+1;
  const maxAbs = scaleLen*octaveCount-1;
  const state = {seed: seed*999983+7};
  const stableDegrees = [0,Math.min(2,scaleLen-1),Math.min(4,scaleLen-1)].filter((v,i,a)=>a.indexOf(v)===i);
  const rhythmBank = GENRE_RHYTHMS[genre]||[cfg.durations];
  const phraseLen = n<=8 ? Math.max(2,n) : 4;
  const rhythmOffset = Math.floor(nextRand(state)*rhythmBank.length);
  let direction = nextRand(state)<0.5 ? 1 : -1;
  let prevMove = 0;
  let repeated = 0;
  let notes=[];

  function nearestAbs(degree,targetAbs){
    let best=degree, bestDist=Infinity;
    for(let o=0;o<octaveCount;o++){
      const candidate=o*scaleLen+degree;
      const dist=Math.abs(candidate-targetAbs);
      if(dist<bestDist){ best=candidate; bestDist=dist; }
    }
    return clamp(best,0,maxAbs);
  }
  function chooseCadenceDegree(isFinal,phraseIndex){
    if(isFinal) return 0;
    const weights=genre==='Jazz'?[0.30,0.42,0.28]:genre==='Blues'?[0.42,0.20,0.38]:[0.45,0.25,0.30];
    if(phraseIndex%2===1 && stableDegrees.includes(Math.min(4,scaleLen-1))) return Math.min(4,scaleLen-1);
    return weightedChoice(stableDegrees,weights.slice(0,stableDegrees.length),state);
  }
  function chooseMove(posInPhrase){
    const restless=clamp(temp,0.05,0.95);
    if(Math.abs(prevMove)>=3){
      direction = prevMove>0 ? -1 : 1;
      return direction;
    }
    if(posInPhrase===2 && nextRand(state)<profile.turn) direction*=-1;
    const moves=[0,direction,-direction,2*direction,-2*direction,3*direction,-3*direction];
    const weights=[
      profile.repeat+(1-restless)*0.12,
      0.34+(1-restless)*0.24,
      0.20+(1-restless)*0.10,
      0.12+restless*0.10,
      0.08+restless*0.08,
      profile.leap*restless,
      profile.leap*restless*0.65
    ];
    if(repeated>=1) weights[0]=0.01;
    return weightedChoice(moves,weights,state);
  }

  let prevAbs = nearestAbs(weightedChoice(stableDegrees,[0.58,0.26,0.16].slice(0,stableDegrees.length),state),Math.floor(maxAbs/2));
  for(let i=0;i<n;i++){
    const pos=i%phraseLen;
    const phraseIndex=Math.floor(i/phraseLen);
    const phraseStart=pos===0;
    const phraseEnd=pos===phraseLen-1||i===n-1;
    const finalNote=i===n-1;
    let abs;

    if(i===0){
      abs=prevAbs;
    }else if(phraseEnd){
      const cadenceDegree=chooseCadenceDegree(finalNote,phraseIndex);
      abs=nearestAbs(cadenceDegree,prevAbs+(finalNote?0:direction));
    }else{
      if(phraseStart && nextRand(state)<profile.home){
        const anchor=weightedChoice(stableDegrees,[0.50,0.25,0.25].slice(0,stableDegrees.length),state);
        abs=nearestAbs(anchor,prevAbs);
      }else{
        abs=prevAbs+chooseMove(pos);
      }
      if(abs<=1){ direction=1; abs=Math.max(abs,0); }
      if(abs>=maxAbs-1){ direction=-1; abs=Math.min(abs,maxAbs); }
      abs=clamp(abs,0,maxAbs);
    }

    const ni=abs%scaleLen;
    const oct=minO+Math.floor(abs/scaleLen);
    const semi=(keyIdx+intervals[ni])%12;
    const pattern=rhythmBank[(rhythmOffset+phraseIndex)%rhythmBank.length];
    let dur=pattern[pos%pattern.length];
    if(temp>0.68 && !phraseEnd && nextRand(state)<0.18) dur=cfg.durations[Math.floor(nextRand(state)*cfg.durations.length)];
    if(phraseEnd) dur=Math.max(dur,genre==='Ambient'?2:1);
    const accent=phraseStart?0.08:phraseEnd?-0.04:0;
    const vel=clamp(cfg.dynamics+accent+(nextRand(state)-0.5)*(0.16+temp*0.16),0.35,1);
    notes.push({note:NOTES[semi],oct,semi,dur,vel,ni,phrase:phraseIndex,cadence:phraseEnd});
    repeated=abs===prevAbs ? repeated+1 : 0;
    prevMove=abs-prevAbs;
    prevAbs=abs;
  }
  return notes;
}

/* ═══════════════════════════════════════════════════════
   FREQUENCY SPEC
═══════════════════════════════════════════════════════ */
function sampleProgression(scaleLen,scale){
  if(scaleLen>=7){
    if(scale==='minor') return [0,0,3,3,4,4,5,2,0,4,0];
    if(scale==='dorian') return [0,0,1,1,4,4,5,3,0,4,0];
    if(scale==='mixolydian') return [0,0,1,1,4,4,5,3,0,4,0];
    return [0,0,1,1,4,4,5,3,0,4,0];
  }
  return [0,0,1,1,Math.min(3,scaleLen-1),Math.min(3,scaleLen-1),Math.min(4,scaleLen-1),2%scaleLen,0];
}

function generateSequence(genre,key,scale,n,seed,temp){
  const cfg = GENRE_CFG[genre]||GENRE_CFG.Classical;
  const intervals = SCALES[scale]||SCALES[cfg.preferredScale];
  const keyIdx = NOTES.indexOf(key);
  const [minO,maxO] = cfg.oct;
  const scaleLen = intervals.length;
  const state = {seed: seed*999983+7};
  const progression = sampleProgression(scaleLen,scale);
  const stepDur = genre==='Ambient' ? 0.5 : 0.25;
  let notes=[];

  for(let i=0;i<n;i++){
    const cellIdx=Math.floor(i/SAMPLE_ARPEGGIO.length);
    const pos=i%SAMPLE_ARPEGGIO.length;
    const cell=SAMPLE_ARPEGGIO[pos];
    let root=progression[cellIdx%progression.length]%scaleLen;
    if(temp>0.72 && pos>1 && nextRand(state)<0.12){
      root=(root+(nextRand(state)<0.5?-1:1)+scaleLen)%scaleLen;
    }
    let abs=root+cell.step;
    if(i===n-1) abs=0;
    const ni=((abs%scaleLen)+scaleLen)%scaleLen;
    const octaveLift=Math.floor(abs/scaleLen);
    const oct=clamp(minO+octaveLift,minO,maxO);
    const semi=(keyIdx+intervals[ni])%12;
    const finalNote=i===n-1;
    const hold=finalNote ? Math.max(1,cell.hold||stepDur) : cell.hold||stepDur;
    const phrase=cellIdx;
    const cadence=pos===SAMPLE_ARPEGGIO.length-1||finalNote;
    const bassAccent=pos<2?0.08:0;
    const vel=clamp(cfg.dynamics+bassAccent+(nextRand(state)-0.5)*(0.10+temp*0.10),0.35,1);
    notes.push({note:NOTES[semi],oct,semi,dur:stepDur,hold,vel,ni,phrase,cadence});
  }
  return notes;
}

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
function startBackground(){
  cancelAnimationFrame(bgRAF);
  const cv=document.getElementById('bgCanvas');
  if(!cv) return;
  const cx=cv.getContext('2d');
  function size(){
    const dpr=window.devicePixelRatio||1;
    cv.width=Math.floor(innerWidth*dpr);
    cv.height=Math.floor(innerHeight*dpr);
    cv.style.width=innerWidth+'px';
    cv.style.height=innerHeight+'px';
    cx.setTransform(dpr,0,0,dpr,0,0);
  }
  size();
  window.addEventListener('resize',size);
  function draw(){
    const W=innerWidth, H=innerHeight;
    bgPhase+=0.004;
    cx.clearRect(0,0,W,H);
    const sky=cx.createLinearGradient(0,0,W,H);
    sky.addColorStop(0,'rgba(4,8,12,0.96)');
    sky.addColorStop(0.5,'rgba(6,21,24,0.88)');
    sky.addColorStop(1,'rgba(14,10,7,0.95)');
    cx.fillStyle=sky; cx.fillRect(0,0,W,H);

    for(let r=0;r<4;r++){
      cx.save();
      cx.translate(W*0.66,H*0.33);
      cx.rotate(bgPhase*(r%2?-1:1)+r*0.35);
      cx.strokeStyle=r%2?'rgba(246,216,155,0.11)':'rgba(98,244,230,0.12)';
      cx.lineWidth=1.1+r*0.35;
      cx.beginPath();
      cx.ellipse(0,0,W*(0.20+r*0.08),H*(0.14+r*0.05),0,0,Math.PI*2);
      cx.stroke();
      cx.restore();
    }

    for(let layer=0;layer<3;layer++){
      const yBase=H*(0.28+layer*0.16);
      const amp=26+layer*18;
      cx.strokeStyle=layer===1?'rgba(246,216,155,0.14)':'rgba(98,244,230,0.13)';
      cx.lineWidth=1.1;
      cx.beginPath();
      for(let x=0;x<=W;x+=8){
        const t=x/W;
        const y=yBase+Math.sin(t*Math.PI*4+bgPhase*70+layer)*amp+Math.sin(t*Math.PI*13-bgPhase*40)*amp*0.18;
        x===0?cx.moveTo(x,y):cx.lineTo(x,y);
      }
      cx.stroke();
    }

    cx.fillStyle='rgba(246,216,155,0.16)';
    for(let i=0;i<70;i++){
      const x=((i*97+bgPhase*9000)%W);
      const h=8+((i*37)%72);
      const y=H*0.58-h/2+Math.sin(i+bgPhase*18)*24;
      cx.fillRect(x,y,1,h);
    }
    cx.fillStyle='rgba(98,244,230,0.16)';
    for(let i=0;i<60;i++){
      const x=((i*71-bgPhase*7600)%W+W)%W;
      const h=6+((i*43)%62);
      const y=H*0.48-h/2+Math.cos(i+bgPhase*14)*22;
      cx.fillRect(x,y,1,h);
    }
    bgRAF=requestAnimationFrame(draw);
  }
  draw();
}

function startWave(color){
  cancelAnimationFrame(waveRAF);
  const cv=document.getElementById('waveCanvas');
  const cx=cv.getContext('2d');
  const W=cv.width, H=cv.height;
  function draw(){
    cx.clearRect(0,0,W,H);
    wavePhase+=0.045;
    drawOpalWave(cx,W,H,Math.max(waveAmp,0.28),wavePhase,isPlaying);
    if(isPlaying) waveRAF=requestAnimationFrame(draw);
  }
  waveRAF=requestAnimationFrame(draw);
}

function drawOpalWave(cx,W,H,ampMul,phase,glow){
  const mid=H*0.5;
  const amp=(H*0.34)*ampMul;
  const palette=['rgba(98,244,230,0.88)','rgba(246,216,155,0.82)','rgba(106,183,255,0.62)'];
  cx.save();
  cx.globalCompositeOperation='lighter';
  for(let layer=0;layer<9;layer++){
    const p=phase+layer*0.18;
    cx.beginPath();
    for(let x=0;x<=W;x+=4){
      const t=x/W;
      const envelope=Math.sin(Math.PI*t);
      const y=mid+
        envelope*amp*(0.58*Math.sin(Math.PI*2*(t*(2.7+layer*0.14))+p)+
        0.28*Math.sin(Math.PI*2*(t*(6.5+layer*0.08))-p*1.25)+
        0.14*Math.sin(Math.PI*2*(t*13)+p*0.7));
      x===0?cx.moveTo(x,y):cx.lineTo(x,y);
    }
    cx.shadowColor=layer%2?'rgba(246,216,155,0.5)':'rgba(98,244,230,0.5)';
    cx.shadowBlur=glow?18:8;
    cx.strokeStyle=palette[layer%palette.length];
    cx.globalAlpha=0.23+layer*0.045;
    cx.lineWidth=1+layer*0.18;
    cx.stroke();
  }
  cx.globalAlpha=0.8;
  cx.shadowBlur=16;
  cx.strokeStyle='rgba(250,246,226,0.76)';
  cx.lineWidth=1.1;
  cx.beginPath();
  cx.moveTo(0,mid);
  cx.lineTo(W,mid);
  cx.stroke();
  cx.restore();
}

function stopWave(){
  cancelAnimationFrame(waveRAF); waveAmp=0;
  const cv=document.getElementById('waveCanvas');
  if(!cv) return;
  const cx=cv.getContext('2d');
  cx.clearRect(0,0,cv.width,cv.height);
  drawOpalWave(cx,cv.width,cv.height,0.28,wavePhase,false);
}

/* ═══════════════════════════════════════════════════════
   PIANO ROLL
═══════════════════════════════════════════════════════ */
function drawRoll(active){
  const cv=document.getElementById('rollCanvas');
  const cx=cv.getContext('2d');
  const W=cv.width, H=cv.height;
  cx.clearRect(0,0,W,H);
  cx.fillStyle='rgba(4,10,14,0.86)';
  cx.fillRect(0,0,W,H);
  for(let x=0;x<W;x+=48){
    cx.strokeStyle=x%192===0?'rgba(246,216,155,0.15)':'rgba(197,229,232,0.08)';
    cx.lineWidth=1;
    cx.beginPath(); cx.moveTo(x,0); cx.lineTo(x,H); cx.stroke();
  }
  for(let y=0;y<H;y+=13){
    cx.strokeStyle='rgba(197,229,232,0.075)';
    cx.lineWidth=0.6;
    cx.beginPath(); cx.moveTo(0,y); cx.lineTo(W,y); cx.stroke();
  }
  if(!melody.length){
    cx.fillStyle='rgba(200,213,216,0.55)';
    cx.font='13px Inter, sans-serif';
    cx.textAlign='center';
    cx.fillText('Generate a melody to reveal the opal piano roll',W/2,H/2+4);
    return;
  }
  const vis=melody.slice(0,40);
  const semis=vis.map(n=>n.semi+n.oct*12);
  const minS=Math.min(...semis)-1, maxS=Math.max(...semis)+1;
  const range=Math.max(maxS-minS,12);
  const cellH=Math.min(13,Math.floor(H/range));
  const cellW=Math.max(18,Math.floor(W/vis.length));
  /* grid */
  for(let i=0;i<range;i++){
    const s=maxS-i;
    if(NOTES[s%12]?.includes('#')){ cx.fillStyle='rgba(98,244,230,0.035)'; cx.fillRect(0,i*cellH,W,cellH); }
    cx.strokeStyle='rgba(197,229,232,0.1)'; cx.lineWidth=0.4;
    cx.beginPath(); cx.moveTo(0,i*cellH); cx.lineTo(W,i*cellH); cx.stroke();
  }
  /* notes */
  vis.forEach((n,i)=>{
    const s=n.semi+n.oct*12;
    const top=(maxS-s)*cellH, left=i*cellW+1;
    const w=Math.max(14,(n.hold||n.dur)*cellW)-2;
    const isAct=i===active;
    const alpha=0.2+n.vel*0.6;
    cx.shadowBlur=isAct?16:4; cx.shadowColor=isAct?'rgba(246,216,155,0.7)':'rgba(98,244,230,0.28)';
    const grad=cx.createLinearGradient(left,top,left+w,top+cellH);
    grad.addColorStop(0,isAct?'rgba(246,216,155,0.98)':`rgba(98,244,230,${alpha})`);
    grad.addColorStop(1,isAct?'rgba(98,244,230,0.98)':`rgba(106,183,255,${alpha*0.8})`);
    cx.fillStyle=grad;
    cx.beginPath();
    cx.roundRect?cx.roundRect(left,top+1,w,cellH-2,3):cx.rect(left,top+1,w,cellH-2);
    cx.fill(); cx.shadowBlur=0;
  });
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
  btn.disabled=true; btn.innerHTML='<span class="btn-icon spin">⟳</span> Generating';
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
  btn.disabled=false; btn.innerHTML='Generate';
  setStatus('Ready','green');
  addLog(`Generated ${melody.length} notes — ${currentGenre}, ${key} ${scale}, temp=${temp.toFixed(2)}`,'ok');
}

async function handlePlay(){
  if(isPlaying){ stopFlag=true; return; }
  if(!melody.length){ addLog('Generate a melody first','warn'); return; }
  stopFlag=false; isPlaying=true;
  document.getElementById('btnPlay').innerHTML='<span class="btn-icon" id="playIcon">⏹</span><span id="playLabel">Stop</span>';
  document.getElementById('btnPlay').className='btn btn-danger';
  document.getElementById('btnGenerate').disabled=true;
  document.getElementById('statusDot').style.visibility='visible';
  setStatus('Looping...','accent');
  const ctx=getCtx();
  const tempo=parseInt(document.getElementById('rTempo').value);
  const vol=parseInt(document.getElementById('rVol').value)/100;
  const beatSec=60/tempo;
  const color=GENRE_CFG[currentGenre].color;
  const activeOscs=new Set();
  waveAmp=0.5; startWave(color);
  addLog(`Looping ${melody.length} notes at ${tempo} BPM. Press Stop to end.`,'ok');

  let loopCount=1;
  while(!stopFlag){
    for(let i=0;i<melody.length;i++){
      if(stopFlag) break;
      const n=melody[i];
      activeIdx=i;
      waveAmp=n.vel;
      renderNoteGrid(i); drawRoll(i);
      document.getElementById('noteCounter').textContent=`Loop ${loopCount} - Note ${i+1} / ${melody.length}`;
      const stepDur=n.dur*beatSec;
      const holdDur=(n.hold||n.dur)*beatSec;
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
      gain.gain.setValueAtTime(n.vel*vol*0.4,now+holdDur*0.65);
      gain.gain.linearRampToValueAtTime(0.0001,now+holdDur*0.92);
      activeOscs.add(osc);
      osc.onended=()=>activeOscs.delete(osc);
      osc.start(now); osc.stop(now+holdDur);
      await delay(stepDur*1000);
    }
    loopCount++;
  }
  isPlaying=false; stopFlag=false; activeIdx=-1;
  activeOscs.forEach(osc=>{ try{ osc.stop(); }catch(e){} });
  activeOscs.clear();
  renderNoteGrid(-1); drawRoll(-1); stopWave();
  document.getElementById('btnPlay').innerHTML='<span class="btn-icon" id="playIcon">▶</span><span id="playLabel">Play</span>';
  document.getElementById('btnPlay').className='btn btn-ghost';
  document.getElementById('btnGenerate').disabled=false;
  document.getElementById('statusDot').style.visibility='hidden';
  document.getElementById('noteCounter').textContent='';
  setStatus('Ready','green');
  addLog('Loop stopped','ok');
}

function handleExport(){
  if(!melody.length){ addLog('Nothing to export','warn'); return; }
  const tempo=parseInt(document.getElementById('rTempo').value);
  const uspb=Math.round(60000000/tempo);
  const hdr=[0x4D,0x54,0x68,0x64,0,0,0,6,0,0,0,1,0,96];
  const ev=[0x00,0xFF,0x51,0x03,(uspb>>16)&0xFF,(uspb>>8)&0xFF,uspb&0xFF];
  const writeVar=(value)=>{
    let bytes=[value&0x7F];
    value>>=7;
    while(value>0){ bytes.unshift((value&0x7F)|0x80); value>>=7; }
    return bytes;
  };
  const events=[];
  let cursor=0;
  melody.forEach(n=>{
    const midi=NOTES.indexOf(n.note)+(n.oct+1)*12;
    const stepTicks=Math.round(n.dur*96);
    const holdTicks=Math.max(1,Math.round((n.hold||n.dur)*96));
    const vel=Math.round(n.vel*100);
    events.push({tick:cursor,type:'on',midi,vel});
    events.push({tick:cursor+holdTicks,type:'off',midi,vel:0});
    cursor+=stepTicks;
  });
  events.sort((a,b)=>a.tick-b.tick||(a.type==='off'?-1:1));
  let lastTick=0;
  events.forEach(e=>{
    ev.push(...writeVar(e.tick-lastTick));
    ev.push(e.type==='on'?0x90:0x80,e.midi,e.vel);
    lastTick=e.tick;
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
      <span style="font-weight:${active?'700':'500'};color:${active?'var(--teal)':'var(--soft)'}">${g}</span>
      <span>${c.tempo} BPM</span>
      <div class="genre-bar-track">
        <div class="genre-bar-fill" style="width:${c.complexity*100}%;background:${c.color}"></div>
      </div>
      <span style="text-align:right">${c.preferredScale}</span>
      <button class="btn-use-genre" data-genre="${g}">Use</button>
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
    document.querySelectorAll('.genre-rail .genre-pill').forEach(b => b.classList.remove('active'));
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
      document.querySelectorAll('.genre-rail .genre-pill').forEach(b => b.classList.remove('active'));
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
  startBackground();
  stopWave();
  drawRoll(-1);
  drawTrainChart();
  buildScaleNotes('major');
  buildGenreChart();
});
