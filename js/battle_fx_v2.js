/** Battle FX v2: Canvas atmosphere/particles + SVG skill subjects. */
(function (g) {
  'use strict';
  g.LS = g.LS || {};

  var THEMES = {
    metal: ['#fff4c7', '#d6a83f'], wood: ['#d5f5a8', '#55a968'],
    water: ['#d9f6ff', '#4c99c9'], fire: ['#ffe3a0', '#df593c'],
    earth: ['#ead0a0', '#95704b'], qi: ['#f7ebc8', '#a692cf']
  };
  var EL = { '金': 'metal', '木': 'wood', '水': 'water', '火': 'fire', '土': 'earth', '五行': 'qi' };

  /* Each player skill owns a distinct subject, motion and impact composition. */
  var SCENES = {
    tunazhang:       { t:'qi',    s:'palm',    m:'push',   i:'air',      p:1 },
    yujianshu:       { t:'metal', s:'swords',  m:'volley', i:'cuts',     p:1 },
    pojunzhan:       { t:'metal', s:'crescent',m:'dash',   i:'cross',    p:2 },
    benming:         { t:'metal', s:'soulblade',m:'return',i:'pierce',   p:3 },
    wuxingshu:       { t:'qi',    s:'wheel',   m:'converge',i:'five',    p:2 },
    sanmeihuo:       { t:'fire',  s:'triflame',m:'spiral', i:'lotusfire',p:2 },
    xuanbingjian:    { t:'water', s:'icearrow',m:'arrow',  i:'icetree',  p:2 },
    qingmuchan:      { t:'wood',  s:'roots',   m:'ground', i:'bind',     p:2 },
    hutigangqi:      { t:'qi',    s:'aura',    m:'self',   i:'guard',    p:1 },
    jinzhongzhao:    { t:'metal', s:'bell',    m:'self',   i:'guard',    p:1 },
    zhoutian:        { t:'water', s:'meridian',m:'self',   i:'heal',     p:1 },
    chunhuijue:      { t:'wood',  s:'blossom', m:'self',   i:'heal',     p:2 },
    xunleiji:        { t:'metal', s:'thunder', m:'blink',  i:'triple',   p:1 },
    zhuifengjian:    { t:'metal', s:'windblade',m:'zigzag',i:'windcut',  p:3 },
    jingangquan:     { t:'earth', s:'vajra',   m:'punch',  i:'seal',     p:4 },
    fentianjin:      { t:'fire',  s:'firebody',m:'surge',  i:'pillar',   p:5 },
    xingchenzhi:     { t:'metal', s:'star',    m:'beam',   i:'starburst',p:6 },
    hunyuanyiqi:     { t:'earth', s:'yinyang', m:'compress',i:'void',    p:7 },
    dayan_shenlei:   { t:'metal', s:'thunderseal',m:'sky', i:'ninebolt', p:8 },
    zhanxian_feidao: { t:'metal', s:'gourdblade',m:'flash',i:'redline',  p:9 },
    gengjinrui:      { t:'metal', s:'shards',  m:'align',  i:'spear',    p:2 },
    houtu_qing:      { t:'earth', s:'stoneplates',m:'rise',i:'rampart',  p:2 },
    qingtengfu:      { t:'wood',  s:'vinecage',m:'ground', i:'cage',     p:4 },
    tianleipo:       { t:'metal', s:'stormrift',m:'sky',   i:'giantbolt',p:5 },
    liaoyuanhuo:     { t:'fire',  s:'fireline',m:'ground', i:'wildfire', p:5 },
    canghaitun:      { t:'water', s:'wave',    m:'swell',  i:'maelstrom',p:5 },
    wulei_zhengfa:   { t:'qi',    s:'fivethunder',m:'sky', i:'judgment', p:9 },
    guixigong:       { t:'water', s:'turtle',  m:'self',   i:'guard',    p:1 },
    tiebushan:       { t:'metal', s:'ironcoat',m:'self',   i:'guard',    p:2 },
    xuanwu_zhenyue:  { t:'earth', s:'xuanwu',  m:'self',   i:'guard',    p:3 },
    jingang_buhuai:  { t:'metal', s:'sutra',   m:'self',   i:'guard',    p:6 },
    zhoutian_xingdou:{ t:'qi',    s:'stardome',m:'self',   i:'guard',    p:9 },
    yusui_danfang:   { t:'wood',  s:'cauldron',m:'self',   i:'heal',     p:4 },
    taiqing_zaohua:  { t:'wood',  s:'lotus',   m:'self',   i:'heal',     p:9 }
  };

  var box, canvas, ctx, domLayer, floatLayer, myEl, opEl, raf, ro;
  var particles = [], waves = [], strokes = [], decals = [], busy = false;
  var guards = { my:null, op:null }, guardVal = { my:0, op:0 }, pendingGuard = { my:'aura', op:'aura' };
  var roots = { my:null, op:null };

  function esc(v) { return String(v == null ? '' : v).replace(/[<>&]/g, function (m) { return ({'<':'&lt;','>':'&gt;','&':'&amp;'})[m]; }); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function sideEl(side) { return side === 'my' ? myEl : opEl; }
  function foe(side) { return side === 'my' ? 'op' : 'my'; }
  function center(side) {
    var e = sideEl(side), a = box.getBoundingClientRect(), r = e.getBoundingClientRect();
    return { x:r.left-a.left+r.width/2, y:r.top-a.top+r.height*.45 };
  }
  function theme(scene, el) { return THEMES[(scene && scene.t) || EL[el] || 'qi']; }
  function cls(e, n, on) { if (e) e.classList[on ? 'add' : 'remove'](n); }

  function fighter(side, el) {
    var robe = side === 'my' ? '#2f6f63' : '#8c3b2e', trim = '#e8dcc8';
    return '<svg class="bfx2-body" viewBox="0 0 64 104"><ellipse class="bfx2-aura" cx="32" cy="62" rx="23" ry="35" fill="' + (theme(null,el)[1]) + '"/>' +
      '<ellipse cx="32" cy="100" rx="18" ry="4" fill="rgba(0,0,0,.28)"/><g class="bfx2-figure">' +
      '<path d="M18 47L32 30l14 17-2 34H20z" fill="' + robe + '"/><path d="M32 30l14 17-2 34H32z" fill="#182b2a" opacity=".22"/>' +
      '<path d="M24 47l8 13 8-13-8-16z" fill="' + trim + '" opacity=".85"/><rect x="18" y="59" width="28" height="5" rx="2" fill="' + trim + '" opacity=".7"/>' +
      '<rect x="22" y="78" width="9" height="17" rx="4" fill="#314b47"/><rect x="33" y="78" width="9" height="17" rx="4" fill="#314b47"/>' +
      '<circle cx="32" cy="22" r="13" fill="#e8c9a0"/><path d="M19 21a13 13 0 0126 0q-13-8-26 0" fill="#241f1a"/><circle cx="32" cy="7" r="5" fill="#241f1a"/>' +
      '<rect class="bfx2-arm a1" x="11" y="43" width="8" height="27" rx="4" fill="' + robe + '"/><rect class="bfx2-arm a2" x="45" y="43" width="8" height="27" rx="4" fill="' + robe + '"/>' +
      '</g></svg>';
  }

  function resize() {
    if (!box || !canvas) return;
    var d = Math.min(devicePixelRatio || 1, 2), r = box.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width*d)); canvas.height = Math.max(1, Math.round(r.height*d));
    canvas.style.width = r.width+'px'; canvas.style.height = r.height+'px'; ctx.setTransform(d,0,0,d,0,0);
  }
  function particle(x,y,c,opt) {
    opt=opt||{}; particles.push({x:x,y:y,px:x,py:y,vx:opt.vx||0,vy:opt.vy||0,g:opt.g||0,life:opt.life||650,max:opt.life||650,size:opt.size||3,c:c,shape:opt.shape||'dot'});
  }
  function burst(at, colors, count, power, shape) {
    if (document.documentElement.classList.contains('lowfx')) count=Math.ceil(count*.45);
    for(var i=0;i<count;i++){var a=Math.PI*2*i/count+(Math.random()-.5)*.35,s=power*(.55+Math.random()*.6);particle(at.x,at.y,colors[i%2],{vx:Math.cos(a)*s,vy:Math.sin(a)*s,g:.025,life:520+Math.random()*360,size:2+Math.random()*3,shape:shape});}
  }
  function wave(at,c,r,life,kind){waves.push({x:at.x,y:at.y,c:c,r0:r*.12,r:r,life:life,max:life,kind:kind||'ring'});}
  function trail(from,to,colors,kind,power){
    var bend=kind==='zigzag'?-24:kind==='swell'?30:kind==='ground'?34:kind==='sky'?-42:kind==='return'?-38:0;
    strokes.push({x1:from.x,y1:from.y,x2:to.x,y2:to.y,c1:colors[0],c2:colors[1],bend:bend,kind:kind,life:520+(power||1)*25,max:520+(power||1)*25,width:kind==='flash'?2.4:kind==='swell'?7:3});
  }
  function leaveMark(at,colors,kind,strong){decals.push({x:at.x,y:at.y,c1:colors[0],c2:colors[1],kind:kind,life:strong?1250:900,max:strong?1250:900,r:strong?54:40});}
  function frame(dt) {
    if (!ctx || !canvas) return;
    var w=canvas.clientWidth,h=canvas.clientHeight; ctx.clearRect(0,0,w,h);
    for(var d=decals.length-1;d>=0;d--){var dc=decals[d];dc.life-=dt;if(dc.life<=0){decals.splice(d,1);continue;}var da=dc.life/dc.max;ctx.save();ctx.globalAlpha=Math.min(.58,da);ctx.translate(dc.x,dc.y+28);if(dc.kind==='wildfire'||dc.kind==='pillar'){var gr=ctx.createRadialGradient(0,0,2,0,0,dc.r);gr.addColorStop(0,dc.c2);gr.addColorStop(.5,'rgba(90,35,22,.32)');gr.addColorStop(1,'transparent');ctx.fillStyle=gr;ctx.scale(1,.3);ctx.beginPath();ctx.arc(0,0,dc.r,0,Math.PI*2);ctx.fill();}else if(dc.kind==='icetree'||dc.kind==='bind'||dc.kind==='cage'){ctx.strokeStyle=dc.c1;ctx.lineWidth=2;for(var di=0;di<8;di++){ctx.rotate(Math.PI/4);ctx.beginPath();ctx.moveTo(5,0);ctx.lineTo(dc.r,0);ctx.lineTo(dc.r-8,-5);ctx.moveTo(dc.r-12,0);ctx.lineTo(dc.r-20,6);ctx.stroke();}}else if(dc.kind==='redline'){ctx.strokeStyle='#bd4038';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-dc.r*1.5,-18);ctx.lineTo(dc.r*1.5,18);ctx.stroke();}else if(dc.kind==='maelstrom'){ctx.strokeStyle=dc.c2;ctx.lineWidth=2;for(var wi=0;wi<3;wi++){ctx.beginPath();ctx.ellipse(0,0,dc.r-wi*9,(dc.r-wi*9)*.28,wi*.22,0,Math.PI*1.65);ctx.stroke();}}else{ctx.strokeStyle=dc.c2;ctx.lineWidth=2;for(var ci=0;ci<5;ci++){ctx.rotate(1.25);ctx.beginPath();ctx.moveTo(3,0);ctx.lineTo(dc.r*.5,0);ctx.lineTo(dc.r,8);ctx.stroke();}}ctx.restore();}
    for(var s=strokes.length-1;s>=0;s--){var st=strokes[s];st.life-=dt;if(st.life<=0){strokes.splice(s,1);continue;}var sa=st.life/st.max,grad=ctx.createLinearGradient(st.x1,st.y1,st.x2,st.y2);grad.addColorStop(0,'transparent');grad.addColorStop(.35,st.c2);grad.addColorStop(1,st.c1);ctx.save();ctx.globalAlpha=Math.min(1,sa*1.8);ctx.strokeStyle=grad;ctx.lineWidth=st.width;ctx.lineCap='round';ctx.setLineDash(st.kind==='flash'?[34,14]:[18,10]);ctx.lineDashOffset=-sa*70;ctx.shadowBlur=8;ctx.shadowColor=st.c2;ctx.beginPath();ctx.moveTo(st.x1,st.y1);ctx.quadraticCurveTo((st.x1+st.x2)/2,(st.y1+st.y2)/2+st.bend,st.x2,st.y2);ctx.stroke();ctx.restore();}
    for(var j=waves.length-1;j>=0;j--){var q=waves[j];q.life-=dt;if(q.life<=0){waves.splice(j,1);continue;}var t=1-q.life/q.max,rr=q.r0+(q.r-q.r0)*t;ctx.save();ctx.globalAlpha=(1-t)*.8;ctx.strokeStyle=q.c;ctx.lineWidth=q.kind==='shock'?3:1.5;ctx.shadowBlur=q.kind==='shock'?8:3;ctx.shadowColor=q.c;ctx.beginPath();ctx.ellipse(q.x,q.y,rr,q.kind==='ground'?rr*.28:rr,0,0,Math.PI*2);ctx.stroke();ctx.restore();}
    for(var i=particles.length-1;i>=0;i--){var p=particles[i];p.life-=dt;if(p.life<=0){particles.splice(i,1);continue;}p.px=p.x;p.py=p.y;p.vy+=p.g*dt;p.x+=p.vx*dt*.06;p.y+=p.vy*dt*.06;ctx.save();ctx.globalAlpha=Math.min(1,p.life/p.max*1.8);ctx.strokeStyle=p.c;ctx.fillStyle=p.c;ctx.lineWidth=p.size;if(p.shape==='streak'){ctx.beginPath();ctx.moveTo(p.px,p.py);ctx.lineTo(p.x-p.vx*.8,p.y-p.vy*.8);ctx.stroke();}else if(p.shape==='leaf'){ctx.translate(p.x,p.y);ctx.rotate(Math.atan2(p.vy,p.vx));ctx.beginPath();ctx.ellipse(0,0,p.size*1.8,p.size*.7,0,0,Math.PI*2);ctx.fill();}else{ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.fill();}ctx.restore();}
    raf=requestAnimationFrame(loop);
  }
  var last=0; function loop(t){var dt=Math.min(32,t-last||16);last=t;frame(dt);}

  function sigil(shape, colors, phase) {
    var a=colors[0],b=colors[1], body='';
    if (shape==='swords') body='<g fill="'+a+'" stroke="#fff"><path d="M7 21l27-9-20 21z"/><path d="M50 8l25 8-28 6z"/><path d="M12 58l25-14-17 27z"/><path d="M47 58l29-13-20 28z"/><path d="M34 32l31 9-31 9z"/></g>';
    else if (shape==='crescent') body='<path d="M10 65Q47 7 78 18 46 27 24 73z" fill="'+a+'"/><path d="M18 63Q48 18 72 20" fill="none" stroke="#fff" stroke-width="3"/>';
    else if (shape==='soulblade') body='<path d="M9 48L66 13l-10 29-39 20z" fill="'+a+'" stroke="#fff" stroke-width="2"/><path d="M15 63Q42 78 72 56" fill="none" stroke="'+b+'" stroke-width="3" stroke-dasharray="4 4"/><circle cx="70" cy="55" r="5" fill="'+b+'"/>';
    else if (shape==='windblade') body=phase==='impact'?'<g fill="none" stroke="'+a+'" stroke-width="4"><path d="M3 18Q42 45 81 16"/><path d="M2 42Q42 68 82 40"/><path d="M8 65Q42 78 76 62" opacity=".6"/></g>':'<g fill="none" stroke="'+a+'" stroke-width="4"><path d="M5 26Q38 5 76 22"/><path d="M4 43Q42 20 80 40" opacity=".75"/><path d="M9 61Q40 39 73 58" opacity=".45"/></g><path d="M20 51L67 22 52 51z" fill="'+a+'" opacity=".8"/>';
    else if (shape==='gourdblade') body=phase==='flight'||phase==='impact'?'<path d="M5 44L72 35 56 49z" fill="#fff"/><path d="M8 47h67" stroke="#b83d32" stroke-width="2"/><circle cx="74" cy="42" r="4" fill="'+a+'"/>':'<path d="M35 9q14 0 14 12-6 6-1 12 18 10 15 29-5 16-21 16S19 68 20 55q1-14 16-22 5-6-1-12-1-8 0-12" fill="'+b+'" stroke="'+a+'" stroke-width="3"/><path d="M32 50q10-8 20 0" stroke="#b83d32" stroke-width="3"/>';
    else if (shape==='shards') body='<g fill="'+a+'" stroke="#fff"><path d="M7 45l20-9-8 16z"/><path d="M29 25l24-8-12 19z"/><path d="M48 45l31-10-19 22z"/><path d="M25 64l29-13-15 25z"/></g>';
    else if (shape==='triflame') body='<g><path d="M25 69Q6 49 27 16q17 29 0 53" fill="#e54832"/><path d="M43 72Q23 43 44 7q20 32 0 65" fill="'+a+'"/><path d="M60 69Q44 43 62 19q17 29-2 50" fill="#7e9cff"/></g>';
    else if (shape==='firebody') body='<path d="M42 4Q72 25 64 52q-7 25-22 28-16-4-23-23Q10 31 34 9q-1 24 8 29 10-12 0-34" fill="'+b+'"/><path d="M42 39q15 15 0 33-16-15 0-33" fill="'+a+'"/><path d="M16 67h52" stroke="#fff" stroke-width="3"/>';
    else if (shape==='fireline') body='<path d="M4 61Q20 48 31 61T57 58q12-14 23-2" fill="none" stroke="'+b+'" stroke-width="9"/><path d="M8 55l8-21 8 17 10-31 10 32 11-22 9 23 9-17 7 20" fill="'+a+'" opacity=".88"/>';
    else if (shape==='icearrow') body=phase==='impact'?'<path d="M42 76V12M42 34L20 18M42 47L68 24M42 56L17 65M42 62l25 10" stroke="'+a+'" stroke-width="6"/><g fill="#fff"><path d="M42 6l7 16-7 8-7-8z"/><path d="M13 13l17 5-1 10-10 1z"/><path d="M72 17l-5 18-10-1-2-9z"/></g>':'<path d="M5 47L68 20l-11 20 22 3-68 18z" fill="'+a+'" stroke="#fff" stroke-width="2"/><path d="M28 47l-9-16m20 12-6-21m18 17-2-19" stroke="'+b+'" stroke-width="3"/>';
    else if (shape==='wave') body='<path d="M2 61Q24 8 50 39q14 17 32-9-4 43-31 43-20 0-29-16-8 11-20 4" fill="'+b+'"/><path d="M12 54q20-32 40-9 11 12 23-3" fill="none" stroke="'+a+'" stroke-width="5"/>';
    else if (shape==='roots') body='<path d="M42 7v41M42 37Q20 25 13 12M42 43q22-20 31-30M42 47Q21 57 10 76M42 49q21 8 32 27" fill="none" stroke="'+b+'" stroke-width="6"/><path d="M8 76q34-18 68 0" fill="none" stroke="'+a+'" stroke-width="4"/>';
    else if (shape==='vinecage') body='<path d="M12 72Q4 22 26 10M72 72q8-50-14-62M24 75Q13 34 42 7M60 75Q72 34 42 7" fill="none" stroke="'+b+'" stroke-width="6"/><path d="M13 39h58M18 57h48" stroke="'+a+'" stroke-width="3"/>';
    else if (shape==='blossom') body='<path d="M42 77V37" stroke="'+b+'" stroke-width="6"/><g fill="'+a+'"><ellipse cx="42" cy="24" rx="9" ry="20"/><ellipse cx="42" cy="24" rx="9" ry="20" transform="rotate(72 42 24)"/><ellipse cx="42" cy="24" rx="9" ry="20" transform="rotate(144 42 24)"/><ellipse cx="42" cy="24" rx="9" ry="20" transform="rotate(216 42 24)"/><ellipse cx="42" cy="24" rx="9" ry="20" transform="rotate(288 42 24)"/></g><circle cx="42" cy="24" r="8" fill="#fff0a8"/>';
    else if (shape==='lotus') body='<g fill="'+a+'" stroke="'+b+'"><path d="M42 67Q18 45 42 14q24 31 0 53"/><path d="M40 69Q10 65 12 37q26 4 28 32"/><path d="M44 69q30-4 28-32-26 4-28 32"/><path d="M39 72Q13 80 5 58q23-5 34 14"/><path d="M45 72q26 8 34-14-23-5-34 14"/></g>';
    else if (/sword|blade|crescent|shards|wind/.test(shape)) body='<path d="M8 48L74 12 53 52 16 62z" fill="'+a+'"/><path d="M13 52L69 18" stroke="#fff" stroke-width="2"/>';
    else if (/fire|flame/.test(shape)) body='<path d="M42 5C66 28 70 48 54 67 37 86 10 68 17 45 22 59 35 57 32 43 29 29 43 21 42 5z" fill="'+b+'"/><path d="M42 32c12 13 11 27 1 34-11-5-14-17-1-34" fill="'+a+'"/>';
    else if (/ice|water|wave/.test(shape)) body='<path d="M5 48Q22 15 42 42T79 25Q68 69 42 61T5 48" fill="'+b+'"/><path d="M12 46q20-19 35 0" fill="none" stroke="'+a+'" stroke-width="5"/>';
    else if (/root|vine|blossom|lotus/.test(shape)) body='<path d="M42 73Q18 53 17 23q24 5 25 31Q48 17 70 13q0 33-28 60" fill="none" stroke="'+b+'" stroke-width="7"/><path d="M42 46q-18-17-28-3 17 13 28 3m0 8q18-17 29-3-18 13-29 3" fill="'+a+'"/>';
    else if (/bell/.test(shape)) body='<path d="M18 65h48L58 53V30Q56 9 42 9T26 30v23z" fill="'+b+'" stroke="'+a+'" stroke-width="3"/><circle cx="42" cy="70" r="6" fill="'+a+'"/>';
    else if (shape==='turtle') body='<ellipse cx="39" cy="47" rx="29" ry="18" fill="'+b+'" stroke="'+a+'" stroke-width="3"/><path d="M18 37l42 20M17 56l43-20M39 29v36" stroke="'+a+'" opacity=".7"/><circle cx="70" cy="47" r="7" fill="'+b+'"/><path d="M11 46L4 39m8 15-8 7" stroke="'+a+'" stroke-width="4"/>';
    else if (shape==='xuanwu') body='<path d="M8 68L20 31l22-20 24 21 10 36z" fill="'+b+'" stroke="'+a+'" stroke-width="4"/><ellipse cx="41" cy="51" rx="25" ry="17" fill="#4f6d55" stroke="'+a+'" stroke-width="3"/><path d="M21 45l39 14M21 59l39-14" stroke="'+a+'"/><path d="M60 36q19-19 15 9-3 19-18 22" fill="none" stroke="#7fb5c8" stroke-width="4"/>';
    else if (shape==='stardome') body='<path d="M9 61Q42 5 75 61" fill="none" stroke="'+a+'" stroke-width="3"/><path d="M17 51l17-18 18 9 17-17M24 64l18-22 18 22" fill="none" stroke="'+b+'" stroke-width="2"/><g fill="#fff"><circle cx="17" cy="51" r="3"/><circle cx="34" cy="33" r="3"/><circle cx="52" cy="42" r="3"/><circle cx="69" cy="25" r="3"/></g>';
    else if (/star/.test(shape)) body='<path d="M42 4l8 28 28 8-28 8-8 28-8-28-28-8 28-8z" fill="'+a+'"/><circle cx="42" cy="40" r="10" fill="#fff"/>';
    else if (shape==='palm') body='<path d="M24 67V35q0-7 6-7v22-34q0-7 6-7v38-35q0-7 6-7v42-31q0-7 6-7v40l8-14q5-7 10-2L53 65Q47 77 35 77z" fill="none" stroke="'+a+'" stroke-width="4"/><path d="M30 60q12-14 24 0M34 49h16" stroke="'+b+'" stroke-width="3"/>';
    else if (shape==='vajra') body='<path d="M17 63q3-25 16-32V16l9-9 9 9v15q14 9 17 32L52 77H32z" fill="'+b+'" stroke="'+a+'" stroke-width="4"/><circle cx="42" cy="48" r="13" fill="none" stroke="'+a+'" stroke-width="4"/><path d="M33 48h18M42 39v18" stroke="#fff" stroke-width="2"/>';
    else if (/yinyang/.test(shape)) body='<circle cx="42" cy="42" r="32" fill="'+a+'"/><path d="M42 10a16 16 0 010 32 16 16 0 000 32 32 32 0 000-64" fill="'+b+'"/><circle cx="42" cy="26" r="5" fill="'+b+'"/><circle cx="42" cy="58" r="5" fill="'+a+'"/>';
    else if (/stoneplates/.test(shape)) body='<path d="M7 69l9-34 17 8 9-31 13 31 17-8 6 34z" fill="'+b+'" stroke="'+a+'" stroke-width="3"/><path d="M17 55h49M33 43l9 26M55 43L45 69" stroke="'+a+'"/>';
    else if (/cauldron/.test(shape)) body='<path d="M18 29h48l-7 35q-17 15-34 0z" fill="'+b+'" stroke="'+a+'" stroke-width="3"/><path d="M12 24h60M28 18q14-12 28 0M26 68l-7 8m39-8 7 8" stroke="'+a+'" stroke-width="4"/><circle cx="34" cy="44" r="4" fill="'+a+'"/><circle cx="50" cy="51" r="5" fill="'+a+'"/>';
    else if (/ironcoat/.test(shape)) body='<path d="M20 18l22-9 22 9v47L42 78 20 65z" fill="'+b+'" stroke="'+a+'" stroke-width="3"/><path d="M20 31h44M20 48h44M42 9v69M20 31l44 17M64 31L20 48" stroke="'+a+'" opacity=".75"/>';
    else if (/sutra/.test(shape)) body='<circle cx="42" cy="42" r="31" fill="none" stroke="'+a+'" stroke-width="4" stroke-dasharray="7 4"/><rect x="27" y="18" width="30" height="48" rx="4" fill="'+b+'"/><path d="M34 29h16M34 38h16M34 47h16M34 56h16" stroke="'+a+'" stroke-width="3"/>';
    else if (shape==='thunder') body='<g fill="'+a+'" stroke="#fff"><path d="M27 5L9 39h15L17 71l27-41H30z"/><path d="M60 11L43 43h14L49 76l26-43H63z" opacity=".7"/></g>';
    else if (shape==='stormrift') body='<path d="M4 24Q20 3 39 19 58-3 80 23L67 37H17z" fill="'+b+'"/><path d="M49 24L24 52h18L31 80l31-39H47z" fill="'+a+'" stroke="#fff" stroke-width="2"/>';
    else if (/thunder/.test(shape)) body='<path d="M53 4L20 46h20L29 80l36-48H45z" fill="'+a+'" stroke="#fff" stroke-width="2"/><path d="M11 20q12-15 24 0 12-17 29 0" fill="none" stroke="'+b+'" stroke-width="6"/>';
    else if (/meridian/.test(shape)) body='<path d="M42 8c-14 9-19 21-14 34s17 20 14 34m0-68c14 9 19 21 14 34S39 62 42 76" fill="none" stroke="'+b+'" stroke-width="4"/><g fill="'+a+'"><circle cx="42" cy="16" r="4"/><circle cx="31" cy="34" r="4"/><circle cx="53" cy="50" r="4"/><circle cx="42" cy="69" r="4"/></g>';
    else if (shape==='wheel') body='<circle cx="42" cy="42" r="32" fill="none" stroke="'+a+'" stroke-width="3"/><path d="M42 42L42 10A32 32 0 0155 13z" fill="#e2bf56"/><path d="M42 42L55 13A32 32 0 0172 34z" fill="#69ad69"/><path d="M42 42L72 34A32 32 0 0158 68z" fill="#65a7d0"/><path d="M42 42L58 68A32 32 0 0121 68z" fill="#dd6746"/><path d="M42 42L21 68A32 32 0 0142 10z" fill="#a47d55"/><circle cx="42" cy="42" r="9" fill="#fff3cf"/>';
    else if (shape==='fivethunder') body='<circle cx="42" cy="42" r="33" fill="none" stroke="'+a+'" stroke-width="3"/><g stroke="#fff" stroke-width="2"><path d="M18 8l-7 24h8l-5 18"/><path d="M34 4l-7 26h8l-5 20"/><path d="M50 4l-7 26h8l-5 20"/><path d="M66 8l-7 24h8l-5 18"/><path d="M42 34l-8 26h9l-6 21"/></g><circle cx="42" cy="42" r="7" fill="'+b+'"/>';
    else if (/thunderseal/.test(shape)) body='<circle cx="42" cy="42" r="31" fill="none" stroke="'+a+'" stroke-width="3"/><path d="M42 11v62M11 42h62M20 20l44 44M64 20L20 64" stroke="'+b+'" stroke-width="2"/><circle cx="42" cy="42" r="9" fill="'+a+'"/>';
    else body='<circle cx="42" cy="42" r="28" fill="'+b+'" opacity=".65"/><circle cx="42" cy="42" r="15" fill="'+a+'"/><path d="M7 42h70M42 7v70" stroke="#fff" opacity=".75"/>';
    return '<svg viewBox="0 0 84 84">'+body+'</svg>';
  }

  function addSubject(scene, at, side, phase) {
    var c=theme(scene), n=document.createElement('div');
    n.className='bfx2-subject subject-'+scene.s+' motion-'+scene.m+' impact-'+scene.i+' phase-'+phase+' side-'+side;
    n.style.left=at.x+'px';n.style.top=at.y+'px';n.style.setProperty('--a',c[0]);n.style.setProperty('--b',c[1]);n.innerHTML=sigil(scene.s,c,phase);domLayer.appendChild(n);return n;
  }
  function cast(side, scene) {
    var at=center(side),c=theme(scene),n=addSubject(scene,at,side,'cast');
    wave(at,c[0],34+scene.p*2,520,'ring');burst(at,c,5+scene.p,1.2,'dot');
    var stage=box.querySelector('.bfx2-stage');stage.style.setProperty('--cast-color',c[1]);cls(stage,'is-casting',true);cls(sideEl(side),'bfx2-casting',true);return n;
  }
  function launch(side,scene) {
    var from=center(side),to=center(foe(side)),n=addSubject(scene,from,side,'flight');
    n.style.setProperty('--tx',(to.x-from.x)+'px');n.style.setProperty('--ty',(to.y-from.y)+'px');
    n.style.setProperty('--tx22',((to.x-from.x)*.22)+'px');n.style.setProperty('--ty22',((to.y-from.y)*.22)+'px');
    n.style.setProperty('--tx55',((to.x-from.x)*.55)+'px');n.style.setProperty('--ty55',((to.y-from.y)*.55)+'px');
    n.style.setProperty('--tx68',((to.x-from.x)*.68)+'px');n.style.setProperty('--ty68',((to.y-from.y)*.68)+'px');
    n.style.setProperty('--tx78',((to.x-from.x)*.78)+'px');n.style.setProperty('--ty78',((to.y-from.y)*.78)+'px');
    n.style.setProperty('--tx90',((to.x-from.x)*.9)+'px');n.style.setProperty('--ty90',((to.y-from.y)*.9)+'px');
    trail(from,to,theme(scene),scene.m,scene.p);
    var c=theme(scene),steps=scene.m==='zigzag'?14:9;
    for(var i=0;i<steps;i++){var t=i/(steps-1),x=from.x+(to.x-from.x)*t,y=from.y+(to.y-from.y)*t+(scene.m==='zigzag'?(i%2?12:-12):0);particle(x,y,c[i%2],{vx:(Math.random()-.5)*.4,vy:(Math.random()-.5)*.4,life:500,size:2,shape:'streak'});}
    setTimeout(function(){if(n.parentNode)n.parentNode.removeChild(n);},470);return to;
  }
  function hit(side,scene,strong) {
    var at=center(side),c=theme(scene),count=8+scene.p*2;
    leaveMark(at,c,scene.i,strong);
    if(scene.i==='ninebolt'||scene.i==='judgment'){
      for(var b=0;b<(scene.i==='judgment'?5:9);b++){var bx=at.x-34+(b%5)*17,by=at.y-42+Math.floor(b/5)*12;wave({x:bx,y:by},c[b%2],24+b%3*7,420+b*35,'shock');burst({x:bx,y:by},c,3,1.5,'streak');}
    }else if(scene.i==='wildfire'){for(var f=-2;f<=2;f++)wave({x:at.x+f*22,y:at.y+28},c[1],32,620+Math.abs(f)*80,'ground');}
    else if(scene.i==='maelstrom'){for(var w=0;w<4;w++)wave(at,c[w%2],32+w*14,520+w*90,'ground');}
    else if(scene.i==='triple'){for(var z=-1;z<=1;z++)wave({x:at.x+z*16,y:at.y},c[z===0?0:1],32+Math.abs(z)*8,460+z*40,'shock');}
    else {wave(at,c[0],strong?70:52,650,'shock');wave(at,c[1],strong?52:38,520,'ring');}
    burst(at,c,count,strong?2.3:1.7,/wood|blossom|vine/.test(scene.s)?'leaf':'streak');
    var n=addSubject(scene,at,side,'impact');setTimeout(function(){if(n.parentNode)n.parentNode.removeChild(n);},720);
    if(strong){var stage=box.querySelector('.bfx2-stage');cls(stage,'bfx2-quake',true);setTimeout(function(){cls(stage,'bfx2-quake',false);},300);}
    cls(sideEl(side),'bfx2-hurt',true);if(strong)cls(sideEl(side),'is-strong',true);
    setTimeout(function(){cls(sideEl(side),'bfx2-hurt',false);cls(sideEl(side),'is-strong',false);},430);
  }
  function selfEffect(side,scene,kind){var at=center(side),c=theme(scene);wave(at,c[0],kind==='shield'?62:48,720,kind==='shield'?'ring':'ground');burst(at,c,8+scene.p,kind==='shield'?1.2:.7,kind==='heal'?'leaf':'dot');var n=addSubject(scene,at,side,'self');setTimeout(function(){if(n.parentNode)n.parentNode.removeChild(n);},950);}

  function floatText(side,text,kind){if(!floatLayer)return;var n=document.createElement('div');n.className='bfx2-float '+(kind||'');n.style.left=(side==='my'?22:78)+'%';n.textContent=text;floatLayer.appendChild(n);setTimeout(function(){if(n.parentNode)n.parentNode.removeChild(n);},1300);}
  function fallback(card,el){return {t:EL[el]||'qi',s:(EL[el]||'qi'),m:'direct',i:'burst',p:Math.max(1,Math.min(5,card&&card.cost||1))};}

  function play(side,card,events,done,onHit){
    if(!box){if(done)done();return;}busy=true;var damage,heal,shield;(events||[]).forEach(function(e){if(e.type==='hit'&&!damage)damage=e;if(e.type==='heal')heal=e;if(e.type==='shield')shield=e;});
    var el=(damage&&damage.el)||(card&&card.el);if(el==='root')el=roots[side];var scene=SCENES[card&&card.id]||fallback(card,el),caster=cast(side,scene);
    wait(420).then(function(){if(caster&&caster.parentNode)caster.parentNode.removeChild(caster);var stage=box.querySelector('.bfx2-stage');cls(stage,'is-casting',false);cls(sideEl(side),'bfx2-casting',false);if(damage){launch(side,scene);return wait(430).then(function(){var strong=(damage.dealt||0)>=25;hit(foe(side),scene,strong);var blocked=damage.absorbed&&!damage.dealt;floatText(foe(side),blocked?'罡 -'+damage.absorbed:'-'+(damage.dealt||0),blocked?'block':strong?'crit':'damage');if(damage.elMult>1)floatText(foe(side),'克制','tag');else if(damage.elMult<1)floatText(foe(side),'受克','weak');if(damage.steal)floatText(side,'+'+damage.steal,'heal');if(onHit)onHit();return wait(420);});}}
    ).then(function(){if(heal){selfEffect(side,scene,'heal');floatText(side,'+'+heal.amount,'heal');if(onHit)onHit();return wait(520);}})
    .then(function(){if(shield){pendingGuard[side]=GUARD_SCENE[card&&card.id]||scene.s||'aura';selfEffect(side,scene,'shield');floatText(side,'+'+shield.amount,'shield');if(onHit)onHit();return wait(560);}})
    .then(function(){if(!damage&&!heal&&!shield)floatText(side,'调息','weak');return wait(120);})
    .then(function(){busy=false;if(done)done();});
  }

  var GUARD_SCENE={hutigangqi:'aura',jinzhongzhao:'bell',guixigong:'turtle',tiebushan:'ironcoat',xuanwu_zhenyue:'xuanwu',jingang_buhuai:'sutra',zhoutian_xingdou:'stardome'};
  function guardMarkup(kind){var inner=sigil(kind,kind==='xuanwu'?THEMES.earth:kind==='turtle'?THEMES.water:THEMES.metal);return '<div class="guard-shell"></div><div class="guard-emblem">'+inner+'</div><div class="guard-fractures"></div>';}
  function setShield(side,value){var v=Math.max(0,Math.round(value||0)),prev=guardVal[side]||0,n=guards[side],kind=pendingGuard[side]||'aura';guardVal[side]=v;if(v>0&&!n){n=document.createElement('div');n.className='bfx2-guard guard-'+side+' guard-'+kind;n.innerHTML=guardMarkup(kind);box.querySelector('.bfx2-stage').appendChild(n);guards[side]=n;requestAnimationFrame(function(){cls(n,'is-up',true);});}else if(n&&v<=0){cls(n,'is-break',true);guards[side]=null;setTimeout(function(){if(n.parentNode)n.parentNode.removeChild(n);},700);}else if(n&&v<prev){cls(n,'is-hit',true);setTimeout(function(){cls(n,'is-hit',false);},420);}}

  function mount(el,info){unmount();box=el;if(!box)return;var my=info&&info.my||{},op=info&&info.op||{};roots.my=my.el;roots.op=op.el;box.innerHTML='<div class="bfx2-stage"><canvas class="bfx2-canvas"></canvas><div class="bfx2-fighter side-my">'+fighter('my',my.el)+'</div><div class="bfx2-fighter side-op">'+fighter('op',op.el)+'</div><div class="bfx2-dom"></div><div class="bfx2-floats"></div><div class="bfx2-name name-my">'+esc(my.dao)+'</div><div class="bfx2-name name-op">'+esc(op.dao)+'</div></div>';canvas=box.querySelector('canvas');ctx=canvas.getContext('2d');domLayer=box.querySelector('.bfx2-dom');floatLayer=box.querySelector('.bfx2-floats');myEl=box.querySelector('.side-my');opEl=box.querySelector('.side-op');resize();if(typeof ResizeObserver!=='undefined'){ro=new ResizeObserver(resize);ro.observe(box);}last=0;raf=requestAnimationFrame(loop);}
  function unmount(){if(raf)cancelAnimationFrame(raf);if(ro)ro.disconnect();if(box)box.innerHTML='';box=canvas=ctx=domLayer=floatLayer=myEl=opEl=null;particles=[];waves=[];strokes=[];decals=[];guards={my:null,op:null};guardVal={my:0,op:0};pendingGuard={my:'aura',op:'aura'};busy=false;}
  function intent(side){cls(sideEl(side),'bfx2-ready',true);setTimeout(function(){cls(sideEl(side),'bfx2-ready',false);},650);}
  function kick(){cls(myEl,'bfx2-enter',true);cls(opEl,'bfx2-enter',true);setTimeout(function(){cls(myEl,'bfx2-enter',false);cls(opEl,'bfx2-enter',false);},800);}
  function down(side){cls(sideEl(side),'bfx2-down',true);if(guards[side]){cls(guards[side],'is-break',true);guards[side]=null;}}
  g.LS.battleFx={mount:mount,unmount:unmount,play:play,intent:intent,kick:kick,float:floatText,down:down,setShield:setShield,get busy(){return busy;}};
})(typeof window!=='undefined'?window:globalThis);
