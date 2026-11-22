const $=id=>document.getElementById(id);
let pw=sessionStorage.getItem('tjtoken')||'',me=null,secTimer,lastLevel=0;
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const el=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e};
const api=async(p,body,method)=>{const r=await fetch('/api/'+p,{method:method||(body===undefined?'GET':'POST'),headers:{Authorization:'Bearer '+pw,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const txt=await r.text();let j={};try{j=JSON.parse(txt)}catch{j={error:txt.slice(0,200)}}
  if(r.status===401||(r.status===403&&/blocked/i.test(j.error||'')))throw Object.assign(new Error(j.error||'Please log in.'),{auth:true});
  if(r.status===429)throw Object.assign(new Error('Too many requests. Slow down.'),{auth:true});
  if(!r.ok)throw new Error(j.error||'Request failed');return j};
let tt;const toast=(m,bad)=>{const t=$('toast');t.textContent=m;t.className=bad?'bad':'';t.style.display='block';clearTimeout(tt);tt=setTimeout(()=>t.style.display='none',3500)};
const run=async(fn,ok)=>{try{await fn();if(ok)toast(ok);tick()}catch(e){if(e.auth){showLogin(e.message);return}toast(e.message,true)}};
const row=(a,b)=>{const r=el('div','row');r.append(el('span',0,a),el('span',0,b));return r};
const fill=(id,...kids)=>{const n=$(id);n.replaceChildren(...kids)};
function bar(cls,v,max){const b=el('div','bar '+cls),i=el('div');i.style.width=Math.max(0,Math.min(100,v/max*100))+'%';b.append(i);return b}

const t0=performance.now();
$('lf').onsubmit=async e=>{e.preventDefault();$('err').textContent='';const b=$('lf').querySelector('button');b.disabled=true;
  try{const r=await api('login',{username:$('lu').value.trim(),password:$('pw').value,hp:$('hp').value,elapsed:Math.round(performance.now()-t0)});pw=r.token;sessionStorage.setItem('tjtoken',pw);$('pw').value='';start(r.user)}
  catch(x){$('err').textContent=x.message;const f=$('lf');f.classList.remove('shake');void f.offsetWidth;f.classList.add('shake')}finally{b.disabled=false}};
function showLogin(msg){clearInterval(timer);clearInterval(secTimer);pw='';sessionStorage.removeItem('tjtoken');lastLevel=0;$('app').hidden=true;$('top').hidden=true;$('login').style.display='flex';$('err').textContent=msg||''}
$('bOut').onclick=async()=>{try{await api('logout',{})}catch{}showLogin('Logged out.')};
$('bDetect').onclick=async()=>{await api('detect',{});tick()};
$('bRe').onclick=async()=>{await api('reconnect',{})};
$('bStop').onclick=async()=>{await api('stop',{})};
$('cf').onsubmit=async e=>{e.preventDefault();const t=$('ci').value.trim();if(!t)return;$('ci').value='';await api('chat',{text:t});tick()};

function render(s){
  const L=s.level;
  setNum('lvl',L.level);setNum('xp',L.xp,' XP');if(lastLevel&&L.level>lastLevel)levelUp(L.level);lastLevel=L.level;$('stageName').textContent='Stage '+L.stage+': '+L.stageName;
  $('arc').style.strokeDashoffset=465*(1-L.intoLevel/L.levelSize);
  $('toNext').textContent=(L.levelSize-L.intoLevel)+' XP to level '+(L.level+1)+(L.unlockAll?' (all abilities unlocked)':'');
  fill('ladder',...s.stages.map(st=>{const li=el('li',st.n<L.stage?'done':st.n===L.stage?'now':'');li.append(el('i',0,st.n),el('span',0,st.name),el('small',0,'Lv '+st.minLevel));return li}));

  const online=s.status==='online';const busy=/connect|detect|start/.test(s.status);
  $('pill').replaceChildren(el('span','dot '+(online?'on':busy?'busy':'off')),document.createTextNode(s.status+(s.mode?' | '+s.mode:'')));
  const now=el('div');
  const st=row('Status','');st.lastChild.append(el('span','dot '+(online?'on':busy?'busy':'off')),document.createTextNode(s.status));
  now.append(st,row('Task',s.task?s.task.label:'idle'),row('Position',s.position?`${s.position.x}, ${s.position.y}, ${s.position.z}`:'-'),row('Dimension',s.dimension||'-'),
    row('Health',s.health!=null?s.health+' / 20':'-'));now.append(bar('hp',s.health||0,20),row('Food',s.food!=null?s.food+' / 20':'-'),bar('food',s.food||0,20));
  fill('now',now);

  const m=s.msa?(()=>{const d=el('div','msa');d.append(el('div',0,'Microsoft sign-in needed'),el('div','note','Open '+s.msa.url+' and enter:'),el('code',0,s.msa.code));return d})():el('span');
  fill('msa',m);
  const d=s.detect;const sv=el('div');
  if(!d)sv.append(el('div','empty','Not checked yet.'));
  else if(!d.online)sv.append(row('Server','offline'),el('div','note',d.error));
  else sv.append(row('Server',d.name),row('Version',d.version||'?'),row('Players',d.players),row('Connection',s.mode==='viaproxy'?'through ViaProxy':'direct (Microsoft login)'),row('Mineflayer supports it',d.supported?'yes':'no, needs ViaProxy'));
  fill('srv',sv);

  fill('near',...(s.entities.length?s.entities.map(e=>{const c=el('div','chip'+(e.hostile?' hostile':''));const a=el('div');a.append(el('div',0,(e.player?e.username:e.name)),e.player?el('em',0,'player'):el('em',0,e.look+'. '+e.behavior));c.append(a,el('em',0,e.distance+'m'));return c}):[el('div','empty','Nothing within 24 blocks.')]));
  fill('inv',...(s.inventory.length?s.inventory.map(i=>{const c=el('div','chip click');c.title='Click to hold this item';c.onclick=()=>run(()=>api('equip',{name:i.name}),'Holding '+i.display);c.append(el('span',0,i.display),el('em',0,'x'+i.count));return c}):[el('div','empty','Inventory is empty.')]));

  const lr=el('div');lr.append(row('Items known',s.discovered.items),row('Mobs known',s.discovered.mobs),row('Blocks known',s.discovered.blocks),row('Missions finished',L.counters.mission||0),row('Mobs defeated',L.counters.killMob||0));fill('learn',lr);
  fill('rec',...(s.records.length?s.records.map(r=>{const c=el('div','chip');c.append(el('span',0,'#'+r.n+' '+r.mission),el('em',0,r.result));return c}):[el('div','empty','No finished missions yet.')]));
  fill('mis',...(s.mistakes.length?s.mistakes.map(r=>{const c=el('div','chip hostile');c.append(el('span',0,r.mission),el('em',0,r.error));return c}):[el('div','empty','None so far.')]));

  fill('servers',...s.profiles.map(p=>{const c=el('div','srv'+(p.id===s.activeProfile?' active':''));const a=el('div');a.append(el('div',0,p.name+(p.id===s.activeProfile?' (current)':'')),el('div','note',p.host+':'+p.port+'  |  '+(p.mode||'default mode')+'  |  version '+(p.targetVersion||'default')));
    const b=el('div','acts');const j=el('button','primary','Join');j.onclick=()=>run(()=>api('join',{id:p.id}),'Joining '+p.name);
    const e=el('button',0,'Edit');e.onclick=()=>editProfile(p);const d=el('button',0,'Delete');d.onclick=()=>{if(confirm('Delete '+p.name+'?'))run(()=>api('profiles/'+p.id,undefined,'DELETE'),'Deleted')};
    b.append(j,e,d);c.append(a,b);return c}));
  const vr=el('div');vr.append(row('ViaProxy',s.viaAvailable?(s.viaRunning?'running':'stopped'):'not installed'),row('Used when','mode is ViaProxy, or auto picks it'));fill('via',vr);
  const vl=$('vlog'),vEnd=vl.scrollTop+vl.clientHeight>=vl.scrollHeight-30;vl.textContent=s.viaLog.join('\n')||'No output yet.';if(vEnd)vl.scrollTop=vl.scrollHeight;
  const log=$('log'),atEnd=log.scrollTop+log.clientHeight>=log.scrollHeight-30;log.textContent=s.log.join('\n');if(atEnd)log.scrollTop=log.scrollHeight;
  $('brainNote').textContent=s.hasApiKey?'AI brain: OpenRouter connected. Say "Hey TJ AI, ..." in Minecraft chat or type here.':'No OpenRouter key set, so it only understands basic commands (follow me, come, collect wood, status, stop). Add OPENROUTER_API_KEY to .env for natural conversation.';
}

let editId=null;
function editProfile(p){editId=p.id;$('pfName').value=p.name;$('pfHost').value=p.host;$('pfPort').value=p.port;$('pfMode').value=p.mode||'';$('pfVer').value=p.targetVersion||'';$('pfTitle').textContent='Edit '+p.name;$('pfCancel').hidden=false;$('pfName').focus()}
function resetProfile(){editId=null;['pfName','pfHost','pfVer'].forEach(i=>$(i).value='');$('pfPort').value=25565;$('pfMode').value='';$('pfTitle').textContent='Add a server';$('pfCancel').hidden=true}
$('pfCancel').onclick=resetProfile;
$('pfSave').onclick=()=>run(async()=>{await api('profiles',{id:editId,name:$('pfName').value,host:$('pfHost').value,port:$('pfPort').value,mode:$('pfMode').value,targetVersion:$('pfVer').value});resetProfile()},'Server saved');
const act=(action,args={})=>run(()=>api('action',{action,args,player:$('cPlayer').value.trim()}));
document.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>act(b.dataset.act));
document.querySelectorAll('[data-key]').forEach(b=>b.onclick=()=>run(()=>api('control',{key:b.dataset.key})));
document.querySelectorAll('[data-turn]').forEach(b=>b.onclick=()=>run(()=>api('turn',{deg:+b.dataset.turn})));
$('bWood').onclick=()=>act('collect_wood',{count:+$('cLogs').value});
$('bCraft').onclick=()=>act('craft',{item:$('cItem').value.trim(),count:+$('cCount').value});
$('bGo').onclick=()=>act('goto',{x:+$('gx').value,y:+$('gy').value,z:+$('gz').value});
$('rf').onsubmit=e=>{e.preventDefault();const t=$('ri').value.trim();if(!t)return;$('ri').value='';run(()=>api('raw',{text:t}))};
$('vf').onsubmit=e=>{e.preventDefault();const t=$('vi').value.trim();if(!t)return;$('vi').value='';run(()=>api('via',{op:'command',line:t}))};
$('bAcct').onclick=()=>run(()=>api('via',{op:'account'}),'Watch the ViaProxy console for the sign-in link and code');
$('bDis').onclick=()=>run(()=>api('disconnect',{}),'Left the server');
async function loadSettings(){const v=await api('settings');
  $('sMode').value=v.mode;$('sTarget').value=v.targetVersion;$('sVia').value=v.viaAuth;$('sBot').value=v.botName;$('sAcct').value=v.viaAccountIndex;$('sMs').value=v.msAccount||'';$('sModel').value=v.model;
  $('sClient').replaceChildren(...v.clientVersions.map(x=>{const o=el('option',0,x);o.value=x;return o}));$('sClient').value=v.clientVersion;
  $('sUnlock').checked=v.unlockAll;$('sDefend').checked=v.autoDefend;$('sGlance').checked=v.idleGlance;$('sKey').value=''}
const saveSettings=(extra={})=>run(async()=>{const body={mode:$('sMode').value,targetVersion:$('sTarget').value.trim()||'auto',clientVersion:$('sClient').value,viaAuth:$('sVia').value,viaAccountIndex:+$('sAcct').value||0,botName:$('sBot').value.trim(),msAccount:$('sMs').value.trim(),model:$('sModel').value.trim(),unlockAll:$('sUnlock').checked,autoDefend:$('sDefend').checked,idleGlance:$('sGlance').checked,...extra};
  if($('sKey').value)body.apiKey=$('sKey').value;
  const r=await api('settings',body);await loadSettings();toast(r.needsReconnect?'Saved. Rejoining the server...':'Saved.')});
$('sSave').onclick=()=>saveSettings();
$('sClearKey').onclick=()=>saveSettings({clearApiKey:true});

// ---------- accounts ----------
async function loadUsers(){const r=await api('users');
  fill('users',...r.users.map(u=>{const c=el('div','srv'),a=el('div'),acts=el('div','acts');
    a.append(el('div',0,u.username+(u.id===me.id?' (you)':'')),el('div','note','created '+new Date(u.createdAt).toLocaleDateString()));
    const sel=el('select');['admin','viewer'].forEach(x=>{const o=el('option',0,x);o.value=x;sel.append(o)});sel.value=u.role;
    sel.onchange=()=>run(async()=>{await api('users/'+u.id+'/role',{role:sel.value});await loadUsers()},'Role changed');
    const rp=el('button',0,'Reset password');rp.onclick=()=>{const p=prompt('New password for '+u.username+' (10+ characters):');if(p)run(()=>api('users/'+u.id+'/password',{password:p}),'Password changed')};
    const del=el('button',0,'Delete');del.disabled=u.id===me.id;
    del.onclick=()=>{if(confirm('Delete '+u.username+'?'))run(async()=>{await api('users/'+u.id,undefined,'DELETE');await loadUsers()},'Account deleted')};
    acts.append(sel,rp,del);c.append(a,acts);return c}))}
$('uAdd').onclick=()=>run(async()=>{await api('users',{username:$('uName').value.trim(),password:$('uPass').value,role:$('uRole').value});$('uName').value='';$('uPass').value='';await loadUsers()},'Account created');
$('myPw').onclick=()=>run(async()=>{await api('me/password',{current:$('pwCur').value,next:$('pwNew').value});$('pwCur').value='';$('pwNew').value='';showLogin('Password changed. Please log in again.')});

// ---------- security center ----------
async function loadSecurity(){const r=await api('security');
  $('sgOn').checked=r.enabled;$('sgStat').textContent=r.blocked.length+' IP'+(r.blocked.length===1?'':'s')+' blocked right now. Your IP: '+r.yourIp+'. Blocks happen at '+r.threshold+' strike points, or instantly for attacks.';
  fill('blocked',...(r.blocked.length?r.blocked.map(b=>{const c=el('div','chip hostile'),a=el('div');
    a.append(el('div',0,b.ip+'  (ban #'+b.count+')'),el('em',0,b.reason+' | until '+new Date(b.until).toLocaleString()));
    const u=el('button',0,'Unblock');u.onclick=()=>run(async()=>{await api('security/unblock',{ip:b.ip});await loadSecurity()},'Unblocked '+b.ip);c.append(a,u);return c}):[el('div','empty','No blocked IPs.')]));
  fill('events',...(r.events.length?r.events.slice(0,25).map(x=>{const c=el('div','chip'+(x.type==='block'?' hostile':''));c.append(el('span',0,new Date(x.t).toLocaleTimeString()+'  '+x.ip),el('em',0,x.detail));return c}):[el('div','empty','Nothing suspicious so far.')]))}
$('sgOn').onchange=()=>run(()=>api('security/enabled',{enabled:$('sgOn').checked}),'Saved');
$('sgBlock').onclick=()=>run(async()=>{await api('security/block',{ip:$('sgIp').value.trim(),hours:+$('sgHrs').value||24});$('sgIp').value='';await loadSecurity()},'IP blocked');

// ---------- animation ----------
function setNum(id,to,suffix=''){const n=$(id),from=+n.dataset.v||0;if(n.dataset.v!==undefined&&from===to)return;n.dataset.v=to;
  if(reduce||!n.textContent){n.textContent=to+suffix;return}
  const t0=performance.now(),d=800;(function f(t){const k=Math.min(1,(t-t0)/d),e=1-Math.pow(1-k,3);n.textContent=Math.round(from+(to-from)*e)+suffix;if(k<1)requestAnimationFrame(f)})(t0)}
function levelUp(n){toast('Level up! Now level '+n);if(reduce)return;const r=document.querySelector('.ring');r.classList.remove('flash');void r.offsetWidth;r.classList.add('flash');confetti()}
function confetti(){const c=$('fx'),x=c.getContext('2d');c.width=innerWidth;c.height=innerHeight;
  const cols=['#a35cff','#d9b3ff','#6d2fd1','#ffc15a','#4fd18b'],ps=Array.from({length:110},()=>({x:innerWidth/2,y:innerHeight/3,vx:(Math.random()-.5)*16,vy:-Math.random()*13-3,s:4+Math.random()*7,c:cols[Math.random()*cols.length|0],r:Math.random()*6}));
  let f=0;(function step(){x.clearRect(0,0,c.width,c.height);ps.forEach(p=>{p.vy+=.4;p.x+=p.vx;p.y+=p.vy;p.r+=.2;x.save();x.translate(p.x,p.y);x.rotate(p.r);x.fillStyle=p.c;x.fillRect(-p.s/2,-p.s/2,p.s,p.s);x.restore()});
    if(++f<110)requestAnimationFrame(step);else x.clearRect(0,0,c.width,c.height)})()}
// drifting blocks in the background
(function(){if(reduce)return;const c=$('bg'),x=c.getContext('2d');let w,h,bs=[];
  const size=()=>{w=c.width=innerWidth;h=c.height=innerHeight;bs=Array.from({length:Math.min(34,Math.round(w*h/40000))},()=>mk(true))};
  function mk(any){const s=14+Math.random()*34;return{x:Math.random()*w,y:any?Math.random()*h:h+s,s,v:.12+Math.random()*.3,a:.04+Math.random()*.09,sw:Math.random()*6.28,r:Math.random()*.6-.3}}
  addEventListener('resize',size);size();
  (function f(){if(!document.hidden){x.clearRect(0,0,w,h);for(const b of bs){b.y-=b.v;b.sw+=.01;b.r+=.002;if(b.y<-b.s*2){Object.assign(b,mk(false))}
    x.save();x.translate(b.x+Math.sin(b.sw)*14,b.y);x.rotate(b.r);x.fillStyle='rgba(163,92,255,'+b.a+')';x.fillRect(-b.s/2,-b.s/2,b.s,b.s);x.strokeStyle='rgba(217,179,255,'+b.a*1.6+')';x.lineWidth=1;x.strokeRect(-b.s/2,-b.s/2,b.s,b.s);x.restore()}}
    requestAnimationFrame(f)})()})();

// ---------- boot ----------
let timer;async function tick(){try{render(await api('state'))}catch(e){if(e.auth)showLogin(e.message)}}
function start(user){me=user;document.body.classList.toggle('viewer',user.role!=='admin');$('login').style.display='none';
  $('app').hidden=false;$('top').hidden=false;$('who').textContent=user.username+' ('+user.role+')';
  document.querySelectorAll('main .card,.rail').forEach((c,i)=>c.style.setProperty('--i',i));
  $('app').classList.remove('enter');void $('app').offsetWidth;$('app').classList.add('enter');
  if(user.role==='admin'){loadSettings().catch(()=>{});loadUsers().catch(()=>{});loadSecurity().catch(()=>{});secTimer=setInterval(()=>loadSecurity().catch(()=>{}),4000)}
  tick();timer=setInterval(tick,1000)}
if(pw)api('me').then(r=>start(r.user)).catch(()=>showLogin(''));
