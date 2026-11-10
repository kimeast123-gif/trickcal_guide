'use strict';
const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d'),$=s=>document.getElementById(s);const W=1280,H=720,STEP=1/120;let END=7400,gameMode='story';
let state='loading',time=0,cam=0,look=.42,acc=0,last=0,animTime=0,spin=0,land=0,toastTime=0,muted=false,audio,checkpoint=0,deaths=0,camY=0;
let prevCam=0,prevCamY=0,camZoom=1,prevCamZoom=1,renderAlpha=1,rCam=0,rCamY=0,rCamZoom=1,rPx=150,rPy=580;
let lookDownHold=0,lookDownOffset=0,monatiumBTower3ExitAuthorized=false,monatiumBTower3Cleared=false,monatiumBTower3LastResetWallId=null;
const MB_T3_DANGER_WALLS=new Set(['MB-T3-WALL-L-TOP','MB-T3-WALL-L-BOT','MB-T3-WALL-R-TOP']);
const tower3WallResetLog=[];
window.__tower3WallResetLog=tower3WallResetLog;
window.__getTower3WallState=()=>({exitAuth:monatiumBTower3ExitAuthorized,cleared:monatiumBTower3Cleared,lastWallId:monatiumBTower3LastResetWallId,log:tower3WallResetLog});
const keys=new Set(),images={},meta={};let particles=[],coins=[],saved=new Set();
const rest={clip:null,elapsed:0,wait:3.5,bag:[],previous:null};
const shadow={y:583,alpha:.13,width:25};

const SPRITE_ANCHORS={
 idle:76,win:76,run:79,jump:95,spin:95,
 rest_angry_3:79,rest_blank_3:76,rest_close_1:79,rest_cute_3:77,
 rest_eat_2:79,rest_happy_1:79,rest_happy_2:79,rest_happy_8:82
};

const debugMetrics={
 enabled:new URLSearchParams(location.search).get('debug')==='1',
 physicsUpdates:0,renderFrames:0,fps:60,fpsAccum:0,fpsCount:0,
 camDelta:0,maxCamDelta:0,playerDrawDelta:0,maxPlayerDrawDelta:0,
 lastDrawPx:150,lastDrawCam:0,cameraProfile:'general'
};
window.__debugMetrics=debugMetrics;

// Gate G6-1: Dudu Playable Voice Pack System (Balanced Volume 0.52, Priority & Cooldowns)
const DUDU_VOICE_MASTER_VOLUME=0.52;
const DUDU_VOICE_POOLS={
 depart:['Joy1'],
 idle_call:['CallPlayer1','CallPlayer2','CallPlayer3','CallPlayer4'],
 double_jump:['Gacha1','Gacha3'],
 special_coin:['Yes1','Hmm2'],
 hit_stun:['Hit1','Hit2','Hit3','Hit5']
};
const DUDU_VOICE_COOLDOWNS={
 depart:20.0,
 idle_call:18.0,
 double_jump:9.0,
 special_coin:0.25,
 hit_stun:3.5
};
const DUDU_VOICE_PRIORITY={
 hit_stun:5,
 special_coin:4,
 double_jump:3,
 depart:2,
 idle_call:1
};
const voiceClips={};
const duduVoiceState={
 masterVolume:DUDU_VOICE_MASTER_VOLUME,
 lastPlayTime:{depart:-999,idle_call:-999,double_jump:-999,special_coin:-999,hit_stun:-999},
 lastPick:{},
 activeAudio:null,
 activeCategory:null,
 wasStationaryIdle:true,
 departedInRun:false,
 history:[]
};
window.__duduVoiceState=duduVoiceState;

function getVoiceClock(){
 return typeof time==='number'?time:0;
}

function resetDuduVoiceCooldowns(){
 duduVoiceState.lastPlayTime={depart:-999,idle_call:-999,double_jump:-999,special_coin:-999,hit_stun:-999};
 duduVoiceState.wasStationaryIdle=true;
 duduVoiceState.departedInRun=false;
}

function playDuduVoice(category,opts={}){
 const pool=DUDU_VOICE_POOLS[category];
 if(!pool||!pool.length)return null;
 const nowSec=getVoiceClock();
 const minCd=opts.bypassCooldown?0.8:(DUDU_VOICE_COOLDOWNS[category]||0);
 const prevT=duduVoiceState.lastPlayTime[category]??-999;
 if(minCd>0&&(nowSec-prevT)<minCd){
  return null;
 }
 // Priority check: do not interrupt a higher-priority voice that is actively playing
 if(duduVoiceState.activeAudio&&!duduVoiceState.activeAudio.paused&&!duduVoiceState.activeAudio.ended){
  const curPrio=DUDU_VOICE_PRIORITY[duduVoiceState.activeCategory]||0;
  const newPrio=DUDU_VOICE_PRIORITY[category]||0;
  if(newPrio<curPrio)return null;
 }
 let candidates=pool;
 if(pool.length>=3&&duduVoiceState.lastPick[category]){
  const filtered=pool.filter(c=>c!==duduVoiceState.lastPick[category]);
  if(filtered.length)candidates=filtered;
 }
 const pick=candidates[Math.floor(Math.random()*candidates.length)];
 duduVoiceState.lastPick[category]=pick;
 duduVoiceState.lastPlayTime[category]=nowSec;
 const ev={category,clip:pick,t:Number(nowSec.toFixed(3)),volume:duduVoiceState.masterVolume,muted:Boolean(muted)};
 duduVoiceState.history.push(ev);
 if(duduVoiceState.history.length>120)duduVoiceState.history.shift();

 if(!muted){
  try{
   if(duduVoiceState.activeAudio){
    duduVoiceState.activeAudio.pause();
    duduVoiceState.activeAudio.currentTime=0;
   }
   let clipAudio=voiceClips[pick];
   if(!clipAudio){
    clipAudio=new Audio('assets/voice/'+pick+'.ogg?v=12');
    clipAudio.preload='none';
    voiceClips[pick]=clipAudio;
   }
   clipAudio.volume=duduVoiceState.masterVolume;
   clipAudio.currentTime=0;
   duduVoiceState.activeAudio=clipAudio;
   duduVoiceState.activeCategory=category;
   clipAudio.play().catch(()=>{});
  }catch{}
 }
 if(category==='idle_call'&&pick&&pick.startsWith('CallPlayer')&&typeof onDuduCallPlayerVoice==='function'){
  onDuduCallPlayerVoice(pick);
 }
 return pick;
}

function initVoiceClips(){
 const allNames=Array.from(new Set(Object.values(DUDU_VOICE_POOLS).flat()));
 for(const name of allNames){
  if(!voiceClips[name]){
   const a=new Audio('assets/voice/'+name+'.ogg?v=12');
   a.preload='none';
   voiceClips[name]=a;
  }
 }
}

function cancelRest(){rest.clip=null;rest.elapsed=0;rest.wait=3.5;}
function nextRest(){
 if(!rest.bag.length){rest.bag=Object.keys(meta).filter(n=>n.startsWith('rest_'));
  for(let i=rest.bag.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[rest.bag[i],rest.bag[j]]=[rest.bag[j],rest.bag[i]];}
  if(rest.bag.length>1&&rest.bag.at(-1)===rest.previous)[rest.bag[0],rest.bag[rest.bag.length-1]]=[rest.bag.at(-1),rest.bag[0]];
 }
 const next=rest.bag.pop();if(next)rest.previous=next;return next;
}
function updateRest(dt,dir){
 if(state!=='playing'||dir||!p.ground||Math.abs(p.vx)>8||p.guardStun>0){cancelRest();return;}
 if(rest.clip){rest.elapsed+=dt;const duration=meta[rest.clip].frames/meta[rest.clip].fps*2;
  if(rest.elapsed>=duration){rest.clip=null;rest.elapsed=0;rest.wait=2.5+Math.random()*2;}
 }else{
  const nearUnplayedFriend=(typeof isNearUnplayedVillageFriend==='function')&&isNearUnplayedVillageFriend();
  if(nearUnplayedFriend&&rest.wait>1.15)rest.wait=1.15;
  rest.wait-=dt;
  if(rest.wait<=0){
   rest.clip=nextRest()||null;
   rest.elapsed=0;
   rest.wait=3.5;
   if(rest.clip&&typeof playDuduVoice==='function')playDuduVoice('idle_call',{bypassCooldown:nearUnplayedFriend});
  }
 }
}
function updateShadow(dt){
 const support=p.ground&&p.on&&p.on.collidable!==false?p.on:platforms.filter(a=>a!==p.drop&&a.collidable!==false&&!a.wall&&!a.ceiling&&p.x>=a.x&&p.x<=a.x+a.w&&a.y>=p.y-1).sort((a,b)=>a.y-b.y)[0];
 const height=support?Math.max(0,support.y-p.y):400;
 const opacity=support ? 0.13*Math.max(.15,1-height/420) : 0;
 if(support)shadow.y=support.y+3;
 shadow.alpha+=(opacity-shadow.alpha)*(1-Math.exp(-dt*18));
 shadow.width+=((25-Math.min(11,height*.04))-shadow.width)*(1-Math.exp(-dt*14));
}
function spriteFacing(name){return (meta[name]?.facing??1)*p.face;}
const visual={name:'idle',phase:0,frame:0,blend:1,reset:true};
const spriteLayer=document.createElement('canvas'),oldLayer=document.createElement('canvas');spriteLayer.width=oldLayer.width=256;spriteLayer.height=oldLayer.height=224;const sc=spriteLayer.getContext('2d'),oc=oldLayer.getContext('2d');
function updateAnimation(dt){
 const name=state==='won'?'win':p.guardStun>0?'jump':p.dash>0?'run':!p.ground?(spin>0?'spin':'jump'):Math.abs(p.vx)>12?'run':'idle';
 if(name!==visual.name){oc.clearRect(0,0,256,224);oc.drawImage(spriteLayer,0,0);visual.name=name;visual.phase=0;visual.blend=0;if(name==='jump')visual.frame=Math.max(4,Math.min(11,7.5+p.vy/180));}
 visual.blend=Math.min(1,visual.blend+dt/.07);
 const runSpeedRatio=Math.min(1.22,Math.max(.42,Math.abs(p.vx)/320));
 visual.phase+=dt*(name==='run'?22*runSpeedRatio:18);
 if(p.guardStun>0){
  visual.frame=10;
 }else if(p.dash>0&&name==='run'){
  visual.frame=2;
 }else if(name==='jump'){
  const target=Math.max(4,Math.min(11,7.5+p.vy/180));visual.frame+=(target-visual.frame)*(1-Math.exp(-dt*15));
 }else if(name==='spin'){
  visual.frame=Math.min(10,(.36-spin)*26);
 }else{
  visual.frame=visual.phase;
 }
}
function drawSample(name,frame,alpha=1){
 if(!images[name]||alpha<=0)return;
 const m=meta[name],cols=m.cols||m.frames,anchor=SPRITE_ANCHORS[name]??76;
 const f=((Math.floor(frame)%m.frames)+m.frames)%m.frames;
 sc.save();
 sc.translate(128,204);
 sc.scale(spriteFacing(name),1);
 sc.globalCompositeOperation='source-over';
 sc.globalAlpha=alpha;
 sc.drawImage(images[name],f%cols*192,Math.floor(f/cols)*192,192,192,-anchor,-180,192,192);
 sc.restore();
}
function renderCharacter(){
 if(visual.reset){visual.blend=1;visual.reset=false;}
 sc.clearRect(0,0,256,224);
 const name=visual.name;
 if(name==='idle'&&rest.clip){
  const blend=restBlend();
  if(blend<.5)drawSample('idle',visual.frame,visual.blend);
  else drawSample(rest.clip,rest.elapsed*meta[rest.clip].fps,visual.blend);
 }else{
  drawSample(name,visual.frame,visual.blend);
 }
 if(visual.blend<1){
  sc.save();
  sc.globalCompositeOperation='source-over';
  sc.globalAlpha=1-visual.blend;
  sc.drawImage(oldLayer,0,0);
  sc.restore();
 }
 if(p.dash>0){
  ctx.save();
  ctx.globalAlpha=0.28;
  ctx.drawImage(spriteLayer,Math.round(rPx-p.dashDir*22)-128,Math.round(rPy)-204);
  ctx.restore();
 }
 ctx.drawImage(spriteLayer,Math.round(rPx)-128,Math.round(rPy)-204);
}
function restBlend(){if(!rest.clip)return 0;const duration=meta[rest.clip].frames/meta[rest.clip].fps*2;
 const t=Math.max(0,Math.min(1,rest.elapsed/.22,(duration-rest.elapsed)/.22));return t*t*(3-2*t);}

const platforms=[];
function add(x,y,w,h=20,thin=true,extra={}){
 const a={x,y,w,h,thin,baseX:x,baseY:y,prevX:x,prevY:y,dx:0,dy:0,collidable:true,blinkState:'on',blinkAlpha:1,...extra};
 platforms.push(a);return a;
}
const flags=[],sections=[];const completed=[false,false,false,false];let dashRequest=false,trail=[];
const p={
 x:150,y:580,prevX:150,prevY:580,vx:0,vy:0,ground:true,on:platforms[0],
 jumps:0,coyote:.1,buffer:0,drop:null,face:1,hold:0,jumpHeld:false,jumpCut:false,
 jumpOrigin:580,jumpHeight:0,dash:0,dashCooldown:0,airDashUsed:false,dashDir:1,
 knock:0,knockVX:0,guardStun:0,guardKnock:0,invulnerable:0
};

function getCameraProfile(px=p.x,py=p.y){
 if(typeof gameMode!=='undefined'&&gameMode==='challenge'&&typeof challengeLevels!=='undefined'){
  const clv=challengeLevels[challengeStageIndex];
  return (clv&&clv.cameraProfile)||'challenge_vertical';
 }
 const curLevelId = levels[levelIndex]?.id;
 if(curLevelId==='monatium_a'&&typeof STAGE_ANCHORS!=='undefined'){
  const m=STAGE_ANCHORS.monatium_a;
  if(px>=m.ascentStart-20&&px<=m.ascentEnd+10&&(py<576||(px>=m.ascentStart+40&&px<=m.ascentEnd-40)))return 'ascent_shaft';
  if(px>=m.descentStart-40&&px<=m.descentEnd+20&&(py<576||px<=m.descentEnd-60))return 'descent_shaft';
  if(px>m.ascentEnd&&px<m.descentStart&&py<=-1100)return 'rooftop';
 }
 if(curLevelId==='monatium_b'){
  return 'monatium_b_tall';
 }
 if(curLevelId==='erpien_a'&&px>=6600){
  return 'erpien_a_vertical';
 }
 if(curLevelId==='erpien_b'&&typeof STAGE_ANCHORS!=='undefined'){
  const e=STAGE_ANCHORS.erpien_b;
  if(px>=e.marieStart-120&&px<e.templeStart)return 'erpien_boss_zoom';
 }
 return 'general';
}

function computeInitialCameraForPoint(px,py){
 const prof=getCameraProfile(px,py);
 const m=(typeof STAGE_ANCHORS!=='undefined')?STAGE_ANCHORS.monatium:{ascentCenterX:5142,descentCenterX:11920};
 let targetX=Math.max(0,Math.min(END-W,px-W*.42));
 let targetY=0;
 if(prof==='ascent_shaft'){
  const baseCamX=m.ascentCenterX-640;
  const rawX=Math.round(baseCamX+(px-m.ascentCenterX)*0.55);
  targetX=Math.max(m.ascentStart-30,Math.min(m.ascentEnd-W+30,rawX));
  targetY=Math.min(0,Math.max(-2180,py-470));
 }else if(prof==='descent_shaft'){
  const baseCamX=m.descentCenterX-640;
  const rawX=Math.round(baseCamX+(px-m.descentCenterX)*0.35);
  targetX=Math.max(m.descentStart-30,Math.min(m.descentEnd-W+30,rawX));
  targetY=Math.min(80,Math.max(-2180,py-265));
 }else if(prof==='rooftop'){
  targetY=Math.min(0,Math.max(-2180,py-430));
 }else if(prof==='challenge_vertical'){
  const actLv=(typeof getActiveLevel==='function')?getActiveLevel():null;
  const minCY=(actLv&&typeof actLv.minCamY==='number')?actLv.minCamY:-3860;
  const maxCY=(actLv&&typeof actLv.maxCamY==='number')?actLv.maxCamY:120;
  targetX=Math.max(0,Math.min(END-W,px-W*0.45));
  targetY=Math.min(maxCY,Math.max(minCY,py-430));
 }else if(prof==='challenge_horizontal'){
  targetX=Math.max(0,Math.min(END-W,px-W*0.36));
  targetY=Math.min(100,Math.max(-450,py-440));
 }else if(prof==='monatium_b_tall'){
  targetX=Math.max(0,Math.min(END-W,px-W*0.42));
  targetY=Math.min(140,Math.max(-2950,py-430));
  return {cam:targetX,camY:targetY,zoom:1.0,profile:prof};
 }else if(prof==='erpien_a_vertical'){
  targetX=Math.max(0,Math.min(END-W,px-W*0.42));
  targetY=Math.min(140,Math.max(-1250,py-380));
  return {cam:targetX,camY:targetY,zoom:1.0,profile:prof};
 }else if(prof==='erpien_boss_zoom'){
  const z=0.88;
  targetX=STAGE_ANCHORS.erpien_b.arenaOrigin||10500;
  targetY=-98;
  return {cam:targetX,camY:targetY,zoom:z,profile:prof};
 }else{
  targetY=Math.min(140,Math.max(-650,py<360?py-360:0));
 }
 return {cam:Math.max(0,Math.min(END-W,targetX)),camY:targetY,zoom:1.0,profile:prof};
}

function platformStep(){
 for(const a of platforms){
  a.prevX=a.x;
  a.prevY=a.y;
  if(a.motion){
   const m=a.motion;
   const wave=Math.sin(levelClock*2*Math.PI/m.period+(m.phase||0))*m.range;
   if(m.axis==='x'){
    a.x=a.baseX+wave;
   }else{
    a.y=a.baseY+wave;
   }
  }
  if(a.blink){
   const b=a.blink;
   const onDur=b.on??2.0,warnDur=b.warning??0.55,offDur=b.off??0.95;
   const cycle=onDur+warnDur+offDur;
   const t=((levelClock+(b.phase||0))%cycle+cycle)%cycle;
   if(t<onDur){
    a.collidable=true;
    a.blinkState='on';
    a.blinkAlpha=1.0;
   }else if(t<onDur+warnDur){
    a.collidable=true;
    a.blinkState='warning';
    if(a.silentBlink){
     const u=(t-onDur)/Math.max(0.01,warnDur);
     a.blinkAlpha=0.22+0.64*(1-u*0.65)*(0.55+0.45*Math.cos(u*Math.PI*3));
    }else{
     const pulseHz=a.ultraFastBlink?16:(a.fastBlink?11:8);
     a.blinkAlpha=0.42+0.48*Math.abs(Math.sin((t-onDur)*Math.PI*pulseHz));
    }
   }else{
    a.collidable=false;
    a.blinkState='off';
    a.blinkAlpha=a.silentBlink?0.0:0.12;
   }
  }else{
   a.collidable=!(a.nonCollidable||a.hidden);
   a.blinkState='on';
   a.blinkAlpha=1.0;
  }
  a.dx=a.x-a.prevX;
  a.dy=a.y-a.prevY;
 }
 if(typeof syncSpecialCoinPositions==='function')syncSpecialCoinPositions();
}

function chooseSection(n){
 checkpoint=n;
 coins.forEach(c=>{if(c.got)saved.add(c.id);});
 reset();
 if(state!=='loading'){state='playing';$('overlay').hidden=true;canvas.focus();}
 if(sections[n]&&sections[n].hint)notify(sections[n].hint);
}
function tone(freq,dur=.1,type='sine',gain=.04){if(muted)return;try{audio??=new(window.AudioContext||window.webkitAudioContext)();audio.resume();let o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.setValueAtTime(freq,audio.currentTime);o.frequency.exponentialRampToValueAtTime(freq*.7,audio.currentTime+dur);g.gain.setValueAtTime(gain,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+dur);o.connect(g);g.connect(audio.destination);o.start();o.stop(audio.currentTime+dur);}catch{}}
function notify(s){if(!s)return;$('toast').textContent=s;toastTime=2.2;}
function burst(x,y,color,n=10){for(let i=0;i<n;i++)particles.push({x,y,vx:(Math.random()-.5)*160,vy:-Math.random()*130,life:.5+Math.random()*.3,color,r:2+Math.random()*4});}
function syncRenderCoords(){
 const prof=getCameraProfile(p.x,p.y);
 camZoom=prof==='erpien_boss_zoom'?0.88:1.0;
 prevCamZoom=camZoom;rCamZoom=camZoom;
 p.prevX=p.x;p.prevY=p.y;prevCam=cam;prevCamY=camY;prevCamZoom=camZoom;prevCamZoom=camZoom;
 rPx=p.x;rPy=p.y;rCam=cam;rCamY=camY;
 debugMetrics.lastDrawPx=p.x;debugMetrics.lastDrawCam=cam;
 debugMetrics.maxCamDelta=0;debugMetrics.maxPlayerDrawDelta=0;
 debugMetrics.cameraProfile=getCameraProfile(p.x,p.y);
}
function reset(full=false){
 if(typeof gameMode!=='undefined'&&gameMode==='challenge'){
  if(typeof resetChallengePlayer==='function')resetChallengePlayer(full);
  return;
 }
 if(full){resetJourney();checkpoint=0;saved.clear();deaths=0;completed.fill(false);}
 resetPlatforms();
 if(typeof resetPendingSpecialCoins==='function')resetPendingSpecialCoins();
 const isPlazaSpawn = !!(levels[levelIndex]?.id==='monatium_b' && sections[checkpoint] && sections[checkpoint].x >= STAGE_ANCHORS.monatium_b.plazaStart);
 monatiumBTower3ExitAuthorized = isPlazaSpawn;
 monatiumBTower3Cleared = isPlazaSpawn;
 const dest=sections[checkpoint]||sections[0]||{x:150,y:580};
 Object.assign(p,{
  x:dest.x,y:dest.y,prevX:dest.x,prevY:dest.y,vx:0,vy:0,ground:true,
  jumps:0,coyote:.1,buffer:0,drop:null,hold:0,jumpHeld:false,jumpCut:false,
  dash:0,dashCooldown:0,airDashUsed:false,jumpHeight:0,jumpOrigin:dest.y,
  knock:0,knockVX:0,guardStun:0,guardKnock:0,invulnerable:0
 });
 p.on=platforms.find(a=>a.collidable!==false&&!a.ceiling&&!a.wall&&dest.x>=a.x&&dest.x<=a.x+a.w&&Math.abs(a.y-dest.y)<6);
 lookDownHold=0;lookDownOffset=0;
 duduVoiceState.wasStationaryIdle=true;
 duduVoiceState.departedInRun=false;
 const initCam=computeInitialCameraForPoint(dest.x,dest.y);
 cam=initCam.cam;
 camY=initCam.camY;
 syncRenderCoords();
 coins.forEach(c=>{c.got=saved.has(c.id);});
 spin=0;particles=[];trail=[];if(typeof releaseAllInputs==='function')releaseAllInputs();else keys.clear();dashRequest=false;cancelRest();shadow.y=p.y+3;shadow.alpha=.13;shadow.width=25;visual.reset=true;resetHazards();updateHud();
}
function updateHud(){
 const totalC=typeof totalRegularCandyCount==='function'?totalRegularCandyCount():coins.length;
 const gotC=typeof collectedRegularCandyCount==='function'?collectedRegularCandyCount():coins.filter(c=>c.got).length;
 $('score').textContent=gotC;
 $('total').textContent='/ '+totalC;
 if($('specialScore')&&typeof activeSpecialSet==='function'){
  const secCount=activeSpecialSet().size;
  const pendCount=(typeof specialCoins!=='undefined'?specialCoins.filter(s=>s.state==='pending').length:0);
  $('specialScore').textContent=secCount;
  $('specialTotal').textContent='/ '+TOTAL_SPECIAL_COINS;
  $('specialPending').textContent=pendCount>0?` (+${pendCount} 임시)`:'';
  $('specialPill')?.classList.toggle('pending',pendCount>0);
 }
}
function modal(tag,title,text,button){$('modalTag').textContent=tag;$('modalTitle').textContent=title;$('modalText').innerHTML=text;$('start').textContent=button;$('overlay').hidden=false;$('restart').hidden=state==='ready';}
function pause(){if(state==='playing'){if(typeof ensurePaused==='function')ensurePaused('manual');else{state='paused';if(typeof releaseAllInputs==='function')releaseAllInputs();else keys.clear();modal('잠깐 쉬어가요','두두도 숨 고르는 중','아직 못 가본 발판이 있나요?<br>뒤로 돌아가도 괜찮아요.','계속 모험하기');}}else if(state==='paused'){if(window.__mobileUIState&&window.__mobileUIState.viewMode==='WEB_PORTRAIT')return;start();}}
function start(){if(state==='loading')return;if(window.__mobileUIState&&window.__mobileUIState.viewMode==='WEB_PORTRAIT')return;if(state==='won')reset(true);state='playing';if(window.__mobileUIState){window.__mobileUIState.pausedByPortrait=false;window.__mobileUIState.lastPauseReason=null;}$('overlay').hidden=true;canvas.focus();if(typeof releaseAllInputs==='function')releaseAllInputs();else keys.clear();if(typeof syncMobileViewMode==='function')syncMobileViewMode();last=performance.now();acc=0;}
$('start').onclick=start;$('pause').onclick=pause;$('restart').onclick=()=>{reset(true);start();};$('retry').onclick=()=>chooseSection(checkpoint);for(let n=0;n<5;n++){if($('section'+n))$('section'+n).onclick=()=>chooseSection(n);}$('sound').onclick=()=>{muted=!muted;$('sound').textContent=muted?'♪ OFF':'♪ ON';$('sound').setAttribute('aria-label',muted?'효과음 켜기':'효과음 끄기');if(!muted)tone(660);};$('full').onclick=()=>{if(typeof requestGameFullscreenOrFocus==='function')requestGameFullscreenOrFocus('hud_btn');else if(document.fullscreenElement)document.exitFullscreen();else $('game').requestFullscreen().catch(()=>notify('브라우저에서 전체화면을 허용해 주세요.'));};
window.addEventListener('keydown',e=>{
 if(['ArrowLeft','ArrowRight','ArrowDown','ArrowUp','Space','Escape','ShiftLeft'].includes(e.code))e.preventDefault();
 if(e.code==='F3'&&!e.repeat){debugMetrics.enabled=!debugMetrics.enabled;$('debugHud').hidden=!debugMetrics.enabled;return;}
 if(typeof pressInput==='function'){
  // Map WASD to Arrow keys as alternative controls
  let logicalCode=e.code;
  if(logicalCode==='KeyA')logicalCode='ArrowLeft';
  else if(logicalCode==='KeyD')logicalCode='ArrowRight';
  else if(logicalCode==='KeyS')logicalCode='ArrowDown';
  else if(logicalCode==='KeyW')logicalCode='Space';
  pressInput(logicalCode,'keyboard');
  return;
 }
 if(e.code==='Escape'&&!e.repeat){pause();return;}if(state!=='playing')return;
 if(e.code==='KeyR'&&!e.repeat){chooseSection(checkpoint);return;}
 keys.add(e.code);
 if(p.guardStun>0)return;
 if(e.code==='Space'&&!e.repeat){
  if(keys.has('ArrowDown')&&p.ground&&p.on?.thin&&!p.on?.dropThroughDisabled){
   p.drop=p.on;p.y+=3;p.ground=false;p.on=null;p.coyote=0;p.jumps=1;p.vy=70;p.buffer=0;p.jumpHeld=false;
   lookDownHold=0;
  }else p.buffer=.12;
 }
 if(e.code==='ShiftLeft'&&!e.repeat)dashRequest=true;
});
window.addEventListener('keyup',e=>{
 if(typeof releaseInput==='function'){
  let logicalCode=e.code;
  if(logicalCode==='KeyA')logicalCode='ArrowLeft';
  else if(logicalCode==='KeyD')logicalCode='ArrowRight';
  else if(logicalCode==='KeyS')logicalCode='ArrowDown';
  else if(logicalCode==='KeyW')logicalCode='Space';
  releaseInput(logicalCode,'keyboard');
  return;
 }
 keys.delete(e.code);
 if(e.code==='Space'){if(p.hold<(p.jumps===2?.22:.24))p.jumpCut=true;p.jumpHeld=false;}
});
window.addEventListener('blur',()=>{if(typeof ensurePaused==='function')ensurePaused('blur');else if(state==='playing')pause();});document.addEventListener('visibilitychange',()=>{if(document.hidden){if(typeof ensurePaused==='function')ensurePaused('visibility');else if(state==='playing')pause();}});canvas.addEventListener('pointerdown',()=>canvas.focus());
function beginJump(second){
 if(p.guardStun>0)return;
 p.vy=second?-510:-540;p.jumps=second?2:1;p.ground=false;p.on=null;p.coyote=0;p.buffer=0;p.hold=0;p.jumpHeld=keys.has('Space');p.jumpCut=!p.jumpHeld;p.jumpOrigin=p.y;p.jumpHeight=0;
 if(second){
  spin=.36;burst(p.x,p.y-35,'#edc76f',10);
  if(typeof playDuduVoice==='function')playDuduVoice('double_jump');
 }else burst(p.x,p.y,'#e8d8b5',5);
 cancelRest();tone(second?660:440,.1);
}
function beginDash(){
 if(p.guardStun>0||p.dash>0||p.dashCooldown>0||(!p.ground&&p.airDashUsed))return false;
 const dir=(keys.has('ArrowRight')?1:0)-(keys.has('ArrowLeft')?1:0);if(dir)p.face=dir;
 p.dashDir=p.face;p.dash=.16;p.dashCooldown=.55;if(!p.ground)p.airDashUsed=true;
 p.vx=p.face*760;p.vy=0;p.jumpHeld=false;cancelRest();burst(p.x,p.y-35,'#c4dec6',8);tone(260,.12,'triangle');return true;
}
function update(dt){
 debugMetrics.physicsUpdates++;
 p.prevX=p.x;p.prevY=p.y;prevCam=cam;prevCamY=camY;
 time+=dt;levelClock+=dt;animTime+=dt;spin=Math.max(0,spin-dt);land=Math.max(0,land-dt);toastTime=Math.max(0,toastTime-dt);$('toast').style.opacity=toastTime>0?1:0;
 const wasGround=p.ground;
 platformStep();

 if(p.ground&&p.on){
  if(p.on.collidable===false){
   p.ground=false;p.on=null;p.coyote=0.08;
  }else{
   p.x+=p.on.dx;p.y+=p.on.dy;
  }
 }

 p.buffer=Math.max(0,p.buffer-dt);p.coyote=p.ground?.10:Math.max(0,p.coyote-dt);p.dashCooldown=Math.max(0,p.dashCooldown-dt);

 const stunned=p.guardStun>0;
 if(stunned){
  p.guardStun=Math.max(0,p.guardStun-dt);
  p.guardKnock=Math.max(0,p.guardKnock-dt);
  p.buffer=0;dashRequest=false;p.jumpHeld=false;p.dash=0;
 }

 let dir=stunned?0:((keys.has('ArrowRight')?1:0)-(keys.has('ArrowLeft')?1:0));
 if(dir&&p.dash<=0){
  p.face=dir;
  if(duduVoiceState.wasStationaryIdle&&!duduVoiceState.departedInRun&&p.ground&&typeof playDuduVoice==='function'){
   if(playDuduVoice('depart'))duduVoiceState.departedInRun=true;
  }
  duduVoiceState.wasStationaryIdle=false;
 }else if(!dir&&p.ground&&Math.abs(p.vx)<15&&!stunned){
  duduVoiceState.wasStationaryIdle=true;
 }
 if(!stunned&&dashRequest){beginDash();dashRequest=false;}
 if(!stunned&&p.buffer>0&&p.dash<=0){if(p.ground||p.coyote>0)beginJump(false);else if(p.jumps<2)beginJump(true);}
 const dashing=!stunned&&p.dash>0;
 if(dashing){
  p.vx=p.dashDir*760;p.vy=0;p.dash=Math.max(0,p.dash-dt);if(!p.ground)p.airDashUsed=true;
 }else if(stunned){
  if(p.guardKnock>0){
   p.vx=p.knockVX;
  }else{
   const decel=p.ground?2800:1100;
   p.vx+=Math.sign(0-p.vx)*Math.min(Math.abs(p.vx),decel*dt);
  }
  p.vy=Math.min(900,p.vy+2400*dt);
 }else{
  const target=dir*320,a=dir?(p.ground?(Math.sign(p.vx)!==dir?4000:2200):1700):(p.ground?3200:1700);
  if(p.knock>0){p.knock=Math.max(0,p.knock-dt);p.vx=p.knockVX;}else p.vx+=Math.sign(target-p.vx)*Math.min(Math.abs(target-p.vx),a*dt);
  const holding=p.jumpHeld&&keys.has('Space')&&p.hold<(p.jumps===2?.22:.24)&&p.vy<0;
  p.hold+=dt;const gravity=p.vy<0?(holding?600:(p.jumpCut?3200:2100)):2500;p.vy=Math.min(900,p.vy+gravity*dt);
 }

 const attachedPlatform=(p.ground&&p.on&&p.on.collidable!==false)?p.on:null,oldX=p.x,oldY=p.y;
 p.x=Math.max(20,Math.min(END-20,p.x+p.vx*dt));

 let wallHazardReset = false;
 let hitDangerWallId = null;
 const isMonatiumB = (typeof levels!=='undefined' && levels[levelIndex]?.id==='monatium_b' && typeof STAGE_ANCHORS!=='undefined');
 if(isMonatiumB){
  const mb = STAGE_ANCHORS.monatium_b;
  const wallX = mb.tower3End - 64; // 6486
  if(p.x >= mb.tower3Start + 64 && p.x <= wallX){
   if(p.y >= 150 && p.y <= 585){
    monatiumBTower3ExitAuthorized = true;
   }else if(p.y < 0){
    monatiumBTower3ExitAuthorized = false;
    monatiumBTower3Cleared = false;
   }
  }
  if(monatiumBTower3ExitAuthorized && p.x >= mb.plazaStart && p.y >= 340){
   monatiumBTower3Cleared = true;
  }
 }
 for(const a of platforms){
  if(a.collidable===false||a.thin)continue;
  // [FIX8 Gate 2]: Swept + AABB immediate 1-frame contact detection on MB_T3_DANGER_WALLS (before and during horizontal resolution)
  if(isMonatiumB && !monatiumBTower3Cleared && MB_T3_DANGER_WALLS.has(a.id)){
   const pMinX = Math.min(oldX, p.x) - 19.5;
   const pMaxX = Math.max(oldX, p.x) + 19.5;
   const pMinY = Math.min(oldY, p.y + p.vy * dt) - 60;
   const pMaxY = Math.max(oldY, p.y + p.vy * dt) - 2;
   // Exclude the upper-left entry portal landing on MB-T3-ENTRY (x <= 5575, y in [-1935, -1705])
   const inLeftEntryPortal = (a.id !== 'MB-T3-WALL-R-TOP') && (p.y <= -1705 && p.y >= -1935 && p.x <= 5575);
   if(!inLeftEntryPortal && pMaxX >= a.x && pMinX <= a.x + a.w && pMaxY > a.y + 2 && pMinY < a.y + a.h - 2){
    wallHazardReset = true;
    hitDangerWallId = a.id;
   }
  }
  if(oldY<=a.y+2||oldY-60>=a.y+a.h)continue;
  if(oldX+19<=a.x&&p.x+19>a.x){
   p.x=a.x-19;p.vx=0;p.dash=0;p.knockVX=0;
   if(isMonatiumB && !monatiumBTower3Cleared && MB_T3_DANGER_WALLS.has(a.id)){
    wallHazardReset = true;
    hitDangerWallId = a.id;
   }
  }else if(oldX-19>=a.x+a.w&&p.x-19<a.x+a.w){
   p.x=a.x+a.w+19;p.vx=0;p.dash=0;p.knockVX=0;
   if(a.hazardExteriorRight || (isMonatiumB && !monatiumBTower3Cleared && MB_T3_DANGER_WALLS.has(a.id))){
    wallHazardReset = true;
    hitDangerWallId = a.id;
   }
  }
 }
 if(isMonatiumB && !monatiumBTower3Cleared){
  const mb = STAGE_ANCHORS.monatium_b;
  const wallX = mb.tower3End - 64; // 6486
  // Any exterior bypass beyond the right wall line without bottom-gate authorization resets immediately!
  if(p.x >= wallX + 20 && (p.y < 220 || !monatiumBTower3ExitAuthorized)){
   wallHazardReset = true;
   hitDangerWallId = hitDangerWallId || 'MB-T3-EXTERIOR-BYPASS';
  }
 }
 if(wallHazardReset){
  deaths++;
  monatiumBTower3LastResetWallId = hitDangerWallId;
  tower3WallResetLog.push({wallId: hitDangerWallId, px: Math.round(p.x), py: Math.round(p.y), deaths, t: Number(time.toFixed(3))});
  monatiumBTower3ExitAuthorized = false;
  monatiumBTower3Cleared = false;
  notify('제3타워 벽면에 접촉하여 체크포인트로 즉시 돌아갑니다!');
  reset(false);
  return;
 }

 p.y+=p.vy*dt;p.ground=false;p.on=null;let landing=null;
 for(const a of platforms){
  if(a.collidable===false)continue;
  if(p.x+18<=a.x||p.x-18>=a.x+a.w||p.drop===a)continue;
  if(!a.noTopLand&&oldY<=Math.max(a.prevY,a.y)+1&&p.y>=a.y&&(a===attachedPlatform||p.vy-a.dy/dt>=-1)){
   if(!landing||a.y<landing.y)landing=a;
  }
  if(!a.thin&&p.vy<0&&oldY-62>=a.prevY+a.h&&p.y-62<=a.y+a.h){
   p.y=a.y+a.h+62;p.vy=0;p.jumpHeld=false;
  }
 }
 if(landing){
  p.y=landing.y;p.vy=0;p.ground=true;p.on=landing;p.jumps=0;p.airDashUsed=false;p.jumpHeld=false;
  if(!wasGround){land=.10;burst(p.x,p.y,'#e4d5b7',5);}
 }
 if(p.drop&&(p.y>p.drop.y+65||p.x+18<p.drop.x||p.x-18>p.drop.x+p.drop.w))p.drop=null;
 if(!p.ground&&p.coyote<=0&&p.jumps===0)p.jumps=1;
 if(!p.ground)p.jumpHeight=Math.max(p.jumpHeight,p.jumpOrigin-p.y);

 const killY=typeof getKillY==='function'?getKillY(p.x):850;
 if(p.y>killY){
  if(typeof gameMode!=='undefined'&&gameMode==='challenge'&&typeof challengeState!=='undefined'){
   challengeState.deaths++;
   challengeState.stageDeaths[challengeStageIndex]=(challengeState.stageDeaths[challengeStageIndex]||0)+1;
   reset(false);
  }else{
   deaths++;reset();
  }
  tone(180,.13);return;
 }

 // Gate G1-1 & G1-2: Tight King Candy hitbox + string-ID persistence
 coins.forEach(c=>{
  if(!c.got&&Math.abs(c.x-p.x)<26&&Math.abs(c.y-(p.y-32))<34){
   c.got=true;
   saved.add(c.id);
   collectedByLevel[levelIndex].add(c.id);
   burst(c.x,c.y,'#ff8a7a',6);
   tone(820,.06);
   updateHud();
  }
 });
 if(typeof updateSpecialCoins==='function')updateSpecialCoins(dt);
 flags.forEach((f,i)=>{
  if(i+1>checkpoint&&Math.abs(p.x-f.x)<45&&p.ground&&Math.abs(p.y-f.y)<4){
   checkpoint=i+1;
   coins.forEach(c=>{if(c.got){saved.add(c.id);collectedByLevel[levelIndex].add(c.id);}});
   if(sections[checkpoint]&&sections[checkpoint].hint)notify(sections[checkpoint].hint);
   tone(900,.15);
  }
 });
 checkJourney();if(state!=='playing')return;updateHazards(dt);

 const camProfile=getCameraProfile(p.x,p.y);
 debugMetrics.cameraProfile=camProfile;

 if(camProfile==='ascent_shaft'){
  lookDownHold=0;
  lookDownOffset+=(0-lookDownOffset)*(1-Math.exp(-dt*8));
  const m=STAGE_ANCHORS.monatium;
  const rawX=(m.ascentCenterX-640)+(p.x-m.ascentCenterX)*0.55;
  const shaftTargetX=Math.max(m.ascentStart-30,Math.min(m.ascentEnd-W+30,rawX));
  cam+=(shaftTargetX-cam)*(1-Math.exp(-dt*7.5));
  const shaftTargetY=Math.min(0,Math.max(-2180,p.y-470));
  camY+=(shaftTargetY-camY)*(1-Math.exp(-dt*6.5));
 }else if(camProfile==='descent_shaft'){
  if(keys.has('ArrowDown')&&!stunned&&p.dash<=0&&Math.abs(p.vx)<200){
   lookDownHold=Math.min(0.6,lookDownHold+dt);
  }else{
   lookDownHold=Math.max(0,lookDownHold-dt*3.2);
  }
  const lookDownTarget=lookDownHold>0.10?235:0;
  lookDownOffset+=(lookDownTarget-lookDownOffset)*(1-Math.exp(-dt*7.0));
  const m=STAGE_ANCHORS.monatium;
  const rawX=(m.descentCenterX-640)+(p.x-m.descentCenterX)*0.35;
  const descTargetX=Math.max(m.descentStart-30,Math.min(m.descentEnd-W+30,rawX));
  cam+=(descTargetX-cam)*(1-Math.exp(-dt*7.5));
  const descTargetY=Math.min(140+lookDownOffset,Math.max(-2180,p.y-265+lookDownOffset));
  camY+=(descTargetY-camY)*(1-Math.exp(-dt*6.5));
 }else if(camProfile==='rooftop'){
  if(keys.has('ArrowDown')&&!stunned&&p.dash<=0&&Math.abs(p.vx)<200&&p.x>(STAGE_ANCHORS.monatium.skywalkEnd-820)){
   lookDownHold=Math.min(0.6,lookDownHold+dt);
  }else{
   lookDownHold=Math.max(0,lookDownHold-dt*3.2);
  }
  const lookDownTarget=lookDownHold>0.10?190:0;
  lookDownOffset+=(lookDownTarget-lookDownOffset)*(1-Math.exp(-dt*6.5));
  const desiredLook=dir<0?.56:dir>0?.42:look;
  look+=(desiredLook-look)*(1-Math.exp(-dt*3.8));
  const desired=Math.max(0,Math.min(END-W,p.x-W*look));
  const diffX=desired-cam;
  const dzX=Math.abs(diffX)<=3?0:diffX-Math.sign(diffX)*3;
  cam+=dzX*(1-Math.exp(-dt*7.2));
  const roofTargetY=Math.min(0,Math.max(-2180,p.y-430+lookDownOffset));
  camY+=(roofTargetY-camY)*(1-Math.exp(-dt*6.0));
 }else if(camProfile==='erpien_a_vertical'){
  // [P0-E 해결]: 수직 데드존(화면 중앙 210~510px 구간 = 300px 폭) 기반 카메라!
  // 점프/낙하 속도(p.vy)에 따라 목표가 105px씩 급변하던 로직을 전면 제거하고,
  // 플레이어가 화면 중앙 데드존 안에 있을 때는 카메라 Y를 고정하여 상하 흔들림(멀미)을 원천 차단!
  if(keys.has('ArrowDown')&&!stunned&&p.dash<=0&&Math.abs(p.vx)<200){
   lookDownHold=Math.min(0.6,lookDownHold+dt);
  }else{
   lookDownHold=Math.max(0,lookDownHold-dt*3.2);
  }
  const lookDownTarget=lookDownHold>0.10?185:0;
  lookDownOffset+=(lookDownTarget-lookDownOffset)*(1-Math.exp(-dt*6.0));
  camZoom+=(1.0-camZoom)*(1-Math.exp(-dt*4.5));
  const viewW=W/camZoom;
  const desiredLook=dir<0?.54:dir>0?.40:look;
  look+=(desiredLook-look)*(1-Math.exp(-dt*4.0));
  const desired=Math.max(0,Math.min(END-viewW,p.x-viewW*look));
  const diffX=desired-cam;
  const dzX=Math.abs(diffX)<=3?0:diffX-Math.sign(diffX)*3;
  cam+=dzX*(1-Math.exp(-dt*7.2));
  const actLv=(typeof getActiveLevel==='function')?getActiveLevel():levels[levelIndex];
  const minCY=(actLv&&typeof actLv.minCamY==='number')?actLv.minCamY:-1250;
  const maxCY=(actLv&&typeof actLv.maxCamY==='number')?actLv.maxCamY:140;
  // Vertical Deadzone: keep camBaseY still while player screen Y is within [210, 510] (42% central window of 720px height)
  const baseCamY = camY - lookDownOffset;
  const screenY = p.y - baseCamY;
  let desiredBaseY = baseCamY;
  if(screenY < 210){
   desiredBaseY = p.y - 210;
  }else if(screenY > 510){
   desiredBaseY = p.y - 510;
  }
  const targetCamY = Math.min(maxCY, Math.max(minCY, desiredBaseY + lookDownOffset));
  camY += (targetCamY - camY) * (1 - Math.exp(-dt * 5.8));
 }else if(camProfile==='monatium_b_tall'){
  // [P0-C.1 해결]: 중복된 3개 분기를 1개로 통합하고, 제3타워 하강 구간 및 상층에서 ↓(ArrowDown) 아래보기 완벽 작동!
  const mb = STAGE_ANCHORS.monatium_b;
  const inTower3Descent = (p.x >= mb.tower3Start - 120 && p.x <= mb.tower3End + 80);
  if(keys.has('ArrowDown')&&!stunned&&p.dash<=0&&Math.abs(p.vx)<200&&(inTower3Descent||p.y<-300)){
   lookDownHold=Math.min(0.6,lookDownHold+dt);
  }else{
   lookDownHold=Math.max(0,lookDownHold-dt*3.2);
  }
  const lookDownTarget=lookDownHold>0.10?220:0;
  lookDownOffset+=(lookDownTarget-lookDownOffset)*(1-Math.exp(-dt*6.5));
  camZoom += (1.0 - camZoom) * (1 - Math.exp(-dt * 4.5));
  const viewW = W / camZoom;
  const desiredLook = dir < 0 ? .56 : dir > 0 ? .42 : look;
  look += (desiredLook - look) * (1 - Math.exp(-dt * 3.8));
  const desired = Math.max(0, Math.min(END - viewW, p.x - viewW * look));
  const diffX = desired - cam;
  const dzX = Math.abs(diffX) <= 3 ? 0 : diffX - Math.sign(diffX) * 3;
  cam += dzX * (1 - Math.exp(-dt * 7.2));
  const actLv = (typeof getActiveLevel === 'function') ? getActiveLevel() : levels[levelIndex];
  const minCY = (actLv && typeof actLv.minCamY === 'number') ? actLv.minCamY : -2650;
  const maxCY = (actLv && typeof actLv.maxCamY === 'number') ? actLv.maxCamY : 160;
  const vertAnchor = inTower3Descent ? 285 : 420;
  const targetCamY = Math.min(maxCY, Math.max(minCY, p.y - vertAnchor + lookDownOffset));
  camY += (targetCamY - camY) * (1 - Math.exp(-dt * 6.5));
 }else if(camProfile==='challenge_vertical'){
  lookDownHold=0;lookDownOffset=0;
  camZoom=1.0;prevCamZoom=1.0;
  const actLv=(typeof getActiveLevel==='function')?getActiveLevel():null;
  const minCY=(actLv&&typeof actLv.minCamY==='number')?actLv.minCamY:-3860;
  const maxCY=(actLv&&typeof actLv.maxCamY==='number')?actLv.maxCamY:120;
  const desiredX=Math.max(0,Math.min(END-W,p.x-W*0.45));
  cam+=(desiredX-cam)*(1-Math.exp(-dt*7.5));
  const desiredY=Math.min(maxCY,Math.max(minCY,p.y-435));
  camY+=(desiredY-camY)*(1-Math.exp(-dt*7.0));
 }else if(camProfile==='challenge_horizontal'){
  lookDownHold=0;lookDownOffset=0;
  camZoom+=(1.0-camZoom)*(1-Math.exp(-dt*4.5));
  const desiredX=Math.max(0,Math.min(END-W,p.x-W*0.36));
  cam+=(desiredX-cam)*(1-Math.exp(-dt*8.0));
  const desiredY=Math.min(100,Math.max(-450,p.y-440));
  camY+=(desiredY-camY)*(1-Math.exp(-dt*6.5));
 }else if(camProfile==='erpien_boss_zoom'){
  lookDownHold=0;lookDownOffset=0;
  const targetZoom=0.88;
  const e=STAGE_ANCHORS.erpien;
  const desiredX=e.arenaOrigin||15700;
  const desiredY=-98;
  if(typeof arena!=='undefined'&&arena&&arena.entered&&(arena.phase==='combat'||arena.phase==='finale'||Math.abs(desiredX-cam)<1.2)){
   // Gate 7 (P0): After the initial entry zoom-out, lock the arena camera 100% still with ZERO X/Y/Zoom jitter!
   camZoom=targetZoom;prevCamZoom=targetZoom;
   cam=desiredX;prevCam=desiredX;
   camY=desiredY;prevCamY=desiredY;
  }else{
   camZoom+=(targetZoom-camZoom)*(1-Math.exp(-dt*5.5));
   cam+=(desiredX-cam)*(1-Math.exp(-dt*7.5));
   camY+=(desiredY-camY)*(1-Math.exp(-dt*7.5));
   if(Math.abs(targetZoom-camZoom)<0.002)camZoom=targetZoom;
   if(Math.abs(desiredX-cam)<0.8)cam=desiredX;
   if(Math.abs(desiredY-camY)<0.8)camY=desiredY;
  }
 }else{
  lookDownHold=0;
  lookDownOffset=0;
  camZoom+=(1.0-camZoom)*(1-Math.exp(-dt*4.2));
  const viewW=W/camZoom;
  const desiredLook=dir<0?.56:dir>0?.42:look;
  look+=(desiredLook-look)*(1-Math.exp(-dt*3.8));
  const desired=Math.max(0,Math.min(END-viewW,p.x-viewW*look));
  const diffX=desired-cam;
  const dzX=Math.abs(diffX)<=3?0:diffX-Math.sign(diffX)*3;
  cam+=dzX*(1-Math.exp(-dt*7.2));
  const desiredY=Math.min(140,Math.max(-650,p.y-camY<275?p.y-275:p.y-camY>595?p.y-595:camY));
  camY+=(desiredY-camY)*(1-Math.exp(-dt*5.5));
 }

 if(typeof gameMode!=='undefined'&&gameMode==='challenge'){
  $('progress').style.width=Math.max(0,Math.min(100,(p.x/Math.max(1,END))*100))+'%';
 }else{
  $('progress').style.width=((levels.slice(0,levelIndex).reduce((v,lv)=>v+lv.worldWidth,0)+p.x)/levels.reduce((v,lv)=>v+lv.worldWidth,0)*100)+'%';
 }
 $('dashStatus').textContent=p.guardStun>0?`경직 중 (${p.guardStun.toFixed(1)}s)`:p.dash>0?'대시 중':p.airDashUsed&&!p.ground?'대시 · 착지 후 충전':p.dashCooldown>0?'대시 · 충전 중':'L SHIFT · 대시 준비';
 $('jumpMeter').style.width=(p.jumpHeld?Math.min(100,p.hold/.24*100):0)+'%';
 $('jumpInfo').textContent=lookDownHold>0.10?'↓ 아래보기 활성화 중':'SPACE · 짧게 / 길게 · ↓ 아래보기';
 updateRest(dt,dir);updateShadow(dt);updateAnimation(dt);
 if(dashing)trail.push({x:p.x,y:p.y,life:.13,face:p.dashDir});trail=trail.filter(t=>(t.life-=dt)>0);
 particles=particles.filter(q=>q.life>0);for(const q of particles){q.life-=dt;q.x+=q.vx*dt;q.y+=q.vy*dt;q.vy+=250*dt;}
}
let seed=7;function rand(){seed=(seed*16807)%2147483647;return seed/2147483647;}const noise=document.createElement('canvas');noise.width=noise.height=256;const nc=noise.getContext('2d');for(let i=0;i<9000;i++){nc.fillStyle=i%2?'#705d3510':'#ffffff38';nc.fillRect(rand()*256,rand()*256,rand()*2+1,1);}const texture=ctx.createPattern(noise,'repeat');
function ellipse(x,y,rx,ry,color){ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill();}
function line(x1,y1,x2,y2,color,width=3){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}
function cloud(x,y,s){ellipse(x,y,65*s,22*s,'#fffdf1');ellipse(x-28*s,y-12*s,29*s,28*s,'#fffdf1');ellipse(x+17*s,y-20*s,35*s,32*s,'#fffdf1');}
function flower(x,y,s=1){line(x,y,x,y-30*s,'#9eaf81',2);ellipse(x-7*s,y-10*s,9*s,4*s,'#b0c294');for(let i=0;i<5;i++){let a=i*Math.PI*2/5;ellipse(x+Math.cos(a)*9*s,y-34*s+Math.sin(a)*9*s,6*s,6*s,'#e9b8ac');}ellipse(x,y-34*s,5*s,5*s,'#e9cd7d');}
function label(text,x,y){ctx.font='bold 16px Arial, "Malgun Gothic"';ctx.textAlign='center';ctx.fillStyle='#7b9074';ctx.fillText(text,x,y);}
function frame(now){
 if(!last)last=now;
 const dt=Math.min(.1,(now-last)/1000);
 last=now;
 eventTick(now);
 if(state==='playing'){
  acc+=dt;
  let loops=0;
  while(acc>=STEP&&loops++<12){
   update(STEP);
   acc-=STEP;
   if(state!=='playing')break;
  }
  renderAlpha=Math.max(0,Math.min(1,acc/STEP));
  rCam=prevCam+(cam-prevCam)*renderAlpha;
  rCamY=prevCamY+(camY-prevCamY)*renderAlpha;
  rCamZoom=prevCamZoom+(camZoom-prevCamZoom)*renderAlpha;
  rPx=p.prevX+(p.x-p.prevX)*renderAlpha;
  rPy=p.prevY+(p.y-p.prevY)*renderAlpha;
 }else{
  if(state==='ready'||state==='won'){time+=dt;animTime+=dt;updateAnimation(dt);}
  renderAlpha=1;rCam=cam;rCamY=camY;rCamZoom=camZoom;rPx=p.x;rPy=p.y;
 }
 debugMetrics.renderFrames++;
 debugMetrics.fpsAccum+=dt;debugMetrics.fpsCount++;
 if(debugMetrics.fpsAccum>=.5){debugMetrics.fps=Math.round(debugMetrics.fpsCount/debugMetrics.fpsAccum);debugMetrics.fpsAccum=0;debugMetrics.fpsCount=0;}
 debugMetrics.camDelta=Math.abs(rCam-debugMetrics.lastDrawCam);
 debugMetrics.playerDrawDelta=Math.abs(rPx-debugMetrics.lastDrawPx);
 if(state==='playing'){
  debugMetrics.maxCamDelta=Math.max(debugMetrics.maxCamDelta,debugMetrics.camDelta);
  debugMetrics.maxPlayerDrawDelta=Math.max(debugMetrics.maxPlayerDrawDelta,debugMetrics.playerDrawDelta);
 }
 debugMetrics.lastDrawCam=rCam;debugMetrics.lastDrawPx=rPx;
 if(debugMetrics.enabled){
  const dh=$('debugHud');
  const lvlCandy=coins.filter(c=>c.got).length+'/'+coins.length;
  if(dh){dh.hidden=false;dh.textContent=`FPS: ${debugMetrics.fps} | physSteps: ${debugMetrics.physicsUpdates} | pos: (${Math.round(p.x)}, ${Math.round(p.y)})
cam: (${Math.round(rCam)}, ${Math.round(rCamY)}) | prof: ${debugMetrics.cameraProfile} | candy(lvl): ${lvlCandy} | crayon: ${activeSpecialSet().size}/${TOTAL_SPECIAL_COINS}`;}
 }
 draw();
 requestAnimationFrame(frame);
}
async function load(){try{Object.assign(meta,{
  "idle": {"frames": 31, "fps": 24, "facing": 1},
  "run": {"frames": 19, "fps": 24, "facing": -1},
  "jump": {"frames": 16, "fps": 24, "facing": -1},
  "spin": {"frames": 14, "fps": 24, "facing": -1},
  "win": {"frames": 72, "fps": 24, "facing": 1},
  "rest_angry_3": {"frames": 26, "fps": 24, "cols": 8, "facing": 1},
  "rest_blank_3": {"frames": 33, "fps": 24, "cols": 8, "facing": 1},
  "rest_close_1": {"frames": 33, "fps": 24, "cols": 8, "facing": 1},
  "rest_cute_3": {"frames": 33, "fps": 24, "cols": 8, "facing": 1},
  "rest_eat_2": {"frames": 26, "fps": 24, "cols": 8, "facing": 1},
  "rest_happy_1": {"frames": 33, "fps": 24, "cols": 8, "facing": 1},
  "rest_happy_2": {"frames": 33, "fps": 24, "cols": 8, "facing": 1},
  "rest_happy_8": {"frames": 33, "fps": 24, "cols": 8, "facing": 1}
});await Promise.all(Object.keys(meta).map(name=>new Promise((ok,no)=>{let im=new Image();im.onload=()=>{images[name]=im;ok();};im.onerror=no;im.src='assets/'+name+'.png?v=12';})));if(document.fonts&&document.fonts.load){try{await document.fonts.load('16px "ONE Mobile POP"');}catch{}}await loadWorldImages();await loadNpcImages();if(typeof preloadEventImages==='function')await preloadEventImages();resetJourney();initVoiceClips();state='ready';$('start').disabled=false;$('start').textContent='이벤트 시작하기  →';updateHud();}catch(e){$('start').textContent='새로고침해 다시 불러오기';$('start').disabled=false;$('start').onclick=()=>location.reload();$('modalText').textContent='두두 모션을 불러오지 못했어요. 다시 시도해 주세요.';console.error(e);}}
