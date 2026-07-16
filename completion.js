/* =========================================================
   동영상 교육 이수 모듈 (drop-in)
   - 역할 분리:
       자료실(제품 페이지) = 문서 참고 라이브러리 (이수 없음, 유튜브 숨김)
       학습 대시보드(learning.html) = 이수 관리 (영상 주 / 문서 부, 90% 자동 이수)
   - 이수 단위 = "영상이 있는 콘텐츠"(강의). 영상 없는 문서는 자료실 전용 참고자료.
   - 진도율/완료일/마지막 방문일 + 1달 알림, 휴대폰 간편 로그인.
   - 표시는 localStorage 기준, 서버(/api/progress·/api/identify)로 best-effort 동기화.
   ========================================================= */
(function () {
  'use strict';

  // ---------- 운영 설정 (정책 변경 시 이 값만 수정) ----------
  var CFG = {
    // 이수 커리큘럼 기준: 'video' = 영상 있는 콘텐츠만 강의로 인정(수동 체크 불필요)
    //                    'all'   = 모든 콘텐츠를 강의로 인정(영상 없는 자료는 수동 체크)
    CURRICULUM: 'video',
    // 자료실(제품 페이지) 모달에서 유튜브 섹션 숨김 → 영상은 학습 탭에서만
    HIDE_YT_IN_ARCHIVE: true
  };
  var MANUAL_COMPLETE = (CFG.CURRICULUM === 'all'); // 'video'면 수동 "학습 완료" 버튼 미노출

  var KEY = 'vatech_edu_completion_v1';
  var PASS = 90;              // 이수 기준 (영상 시청 %)
  var DEADLINE_DAYS = 30;     // 최초 학습 시작 후 이수 권장 기한
  var REVISIT_DAYS = 30;      // 재방문 알림 기준
  var DAY = 86400000;
  var IS_LEARNING_PAGE = false; // learning.html 여부 (init에서 설정)

  // ---------- 상태 ----------
  function blank(){ return { identity:null, items:{}, firstStartAt:null, lastVisit:null }; }
  var state;
  try { state = JSON.parse(localStorage.getItem(KEY)) || blank(); } catch(e){ state = blank(); }
  function save(){ try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(e){} }

  var now = function(){ return Date.now(); };
  function fmt(ts){ if(!ts) return '—'; var d=new Date(ts);
    return d.getFullYear()+'.'+String(d.getMonth()+1).padStart(2,'0')+'.'+String(d.getDate()).padStart(2,'0'); }
  function daysBetween(a,b){ return Math.floor((a-b)/DAY); }

  // 휴대폰 번호 자동 하이픈 (010-XXXX-XXXX / 02-XXXX-XXXX 등)
  function formatPhone(v){
    var d = (v||'').replace(/\D/g,'').slice(0,11);
    if(d.indexOf('02')===0){                 // 서울 지역번호(2자리 국번)
      if(d.length<3) return d;
      if(d.length<7) return d.slice(0,2)+'-'+d.slice(2);
      if(d.length<11) return d.slice(0,2)+'-'+d.slice(2,d.length-4)+'-'+d.slice(d.length-4);
      return d.slice(0,2)+'-'+d.slice(2,6)+'-'+d.slice(6,10);
    }
    if(d.length<4) return d;                  // 010 등 3자리 국번
    if(d.length<8) return d.slice(0,3)+'-'+d.slice(3);
    if(d.length<11) return d.slice(0,3)+'-'+d.slice(3,d.length-4)+'-'+d.slice(d.length-4);
    return d.slice(0,3)+'-'+d.slice(3,7)+'-'+d.slice(7,11);
  }

  // ---------- 콘텐츠 카탈로그 (search-data.js) ----------
  var CATALOG = (typeof SEARCH_ITEMS !== 'undefined') ? SEARCH_ITEMS : [];
  var PRODUCTS = CATALOG.reduce(function(a,i){ if(a.indexOf(i.product)<0)a.push(i.product); return a; }, []);
  function productMeta(p){
    if(p==='Clever Lab')  return { cls:'lab',        color:'#01c0a6' };
    if(p==='Clever One')  return { cls:'clever-one', color:'#1c1b18' };
    return                       { cls:'dental',     color:'#00a672' };
  }
  var LINKS = (typeof PRODUCT_LINKS !== 'undefined') ? PRODUCT_LINKS : {};
  function hasVideo(i){ return !!(i && (i.yt||'').trim()); }
  // 이수 커리큘럼: CFG.CURRICULUM='video' 이면 영상 있는 콘텐츠만 "강의"로 인정
  var LESSONS = CATALOG.filter(function(i){ return CFG.CURRICULUM==='all' ? true : hasVideo(i); });
  function itemsOf(p){ return LESSONS.filter(function(i){ return i.product===p; }); }
  function hasCourse(p){ return itemsOf(p).length > 0; }          // 개설된 과정 여부
  function docsOf(p){ return CATALOG.filter(function(i){ return i.product===p && !hasVideo(i); }); }
  function it(url){ return state.items[url] || {progress:0,completedAt:null,lastVisit:null}; }
  function ensure(url){ if(!state.items[url]) state.items[url]={progress:0,completedAt:null,lastVisit:null}; return state.items[url]; }
  function isDone(url){ return !!it(url).completedAt; }
  function productPct(p){ var a=itemsOf(p); if(!a.length) return 0;
    return Math.round(a.filter(function(i){return isDone(i.url);}).length / a.length * 100); }
  function productDone(p){ return itemsOf(p).filter(function(i){return isDone(i.url);}).length; }
  function overallPct(){ if(!LESSONS.length) return 0;
    return Math.round(LESSONS.filter(function(i){return isDone(i.url);}).length / LESSONS.length * 100); }
  function overallDone(){ return LESSONS.filter(function(i){return isDone(i.url);}).length; }

  // ---------- 수강 선택(enrollment) ----------
  function enrolledList(){ return state.enrolled ? Object.keys(state.enrolled) : []; }
  function isEnrolled(p){ return !!(state.enrolled && state.enrolled[p]); }
  function setEnrolled(p, on){
    if(!state.enrolled) state.enrolled = {};
    if(on){ if(!state.enrolled[p]) state.enrolled[p] = now(); }
    else { delete state.enrolled[p]; }
    save(); syncEnroll();
  }
  function productOfUrl(url){ var m = CATALOG.filter(function(i){ return i.url===url; })[0]; return m ? m.product : ''; }

  // ---------- 프로그램별 지표 ----------
  function progObj(p){ if(!state.programs) state.programs={}; if(!state.programs[p]) state.programs[p]={startedAt:null,completedAt:null}; return state.programs[p]; }
  function programLastVisit(p){ var mx=null; itemsOf(p).forEach(function(i){ var lv=it(i.url).lastVisit; if(lv&&(!mx||lv>mx))mx=lv; }); return mx; }
  function programStartedAt(p){ var o=progObj(p); if(o.startedAt) return o.startedAt;
    var mn=null; itemsOf(p).forEach(function(i){ var fv=it(i.url).firstVisit; if(fv&&(!mn||fv<mn))mn=fv; });
    return mn || (state.enrolled && state.enrolled[p]) || null; }
  function programCompletedAt(p){ return progObj(p).completedAt; }
  function touchProgram(p){ if(!p) return; var o=progObj(p);
    if(!o.startedAt) o.startedAt = now();
    if(itemsOf(p).length>0 && productPct(p)>=100 && !o.completedAt) o.completedAt = now(); }

  // ---------- 수강 프로그램 기준 종합 ----------
  function enrolledItems(){ return LESSONS.filter(function(i){ return isEnrolled(i.product); }); }
  function enrolledPct(){ var a=enrolledItems(); if(!a.length) return 0; return Math.round(a.filter(function(i){return isDone(i.url);}).length/a.length*100); }
  function enrolledDone(){ return enrolledItems().filter(function(i){return isDone(i.url);}).length; }
  function enrolledLastVisit(){ var mx=null; enrolledList().forEach(function(p){ var lv=programLastVisit(p); if(lv&&(!mx||lv>mx))mx=lv; }); return mx; }

  // ---------- 서버 동기화 (best-effort) ----------
  function syncProgress(url, item, product, name){
    if(!state.identity) return;
    fetch('/api/progress', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ phone:state.identity.phone, name:state.identity.name,
        clinic:state.identity.clinic||'', consent:!!state.identity.consent,
        url:url, product:product||'', content_name:name||'',
        progress:item.progress, completed:!!item.completedAt }) }).catch(function(){});
  }
  function syncIdentify(){
    if(!state.identity) return;
    fetch('/api/identify', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(state.identity) }).catch(function(){});
  }
  function syncEnroll(){
    if(!state.identity) return;
    fetch('/api/enroll', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ phone:state.identity.phone, products:enrolledList() }) }).catch(function(){});
  }

  // ---------- 이수 처리 ----------
  function applyProgress(url, pct, product, name){
    var item = ensure(url); if(!item.firstVisit) item.firstVisit = now();
    pct = Math.max(0, Math.min(100, Math.round(pct)));
    if(pct > item.progress) item.progress = pct;
    if(item.progress >= PASS && !item.completedAt) item.completedAt = now();
    item.lastVisit = now(); state.lastVisit = now();
    if(!state.firstStartAt) state.firstStartAt = now();
    touchProgram(product || productOfUrl(url));
    save(); syncProgress(url, item, product, name);
    decorateCards(); updateModalBar(url, product, name); refreshChip(); refreshDashboard();
  }
  function markComplete(url, product, name){
    if(!state.identity){ openIdentity(function(){ markComplete(url, product, name); }); return; }
    var item = ensure(url); if(!item.firstVisit) item.firstVisit = now();
    item.progress = 100;
    if(!item.completedAt) item.completedAt = now();
    item.lastVisit = now(); state.lastVisit = now();
    if(!state.firstStartAt) state.firstStartAt = now();
    touchProgram(product || productOfUrl(url));
    save(); syncProgress(url, item, product, name);
    decorateCards(); updateModalBar(url, product, name); refreshChip(); refreshDashboard();
  }
  function recordVisit(url){
    var item = ensure(url); if(!item.firstVisit) item.firstVisit = now();
    item.lastVisit = now(); state.lastVisit = now();
    if(!state.firstStartAt) state.firstStartAt = now();
    touchProgram(productOfUrl(url)); save();
  }

  // =========================================================
  // 카드 뱃지
  // =========================================================
  function decorateCards(){
    var lessonUrls = {}; LESSONS.forEach(function(i){ lessonUrls[i.url]=1; });
    var cards = document.querySelectorAll('.video-card[data-url]');
    cards.forEach(function(card){
      var url = card.getAttribute('data-url');
      var thumb = card.querySelector('.video-thumb');
      if(!thumb) return;
      var badge = thumb.querySelector('.vc-badge');
      var item = it(url);
      card.classList.remove('vc-completed');
      // 이수 대상(영상 강의)이 아니면 뱃지 없음 — 자료실은 참고 라이브러리
      if(!lessonUrls[url]){ if(badge) badge.remove(); return; }
      if(!badge){ badge = document.createElement('span'); badge.className='vc-badge'; thumb.appendChild(badge); }
      if(item.completedAt){ badge.className='vc-badge done'; badge.textContent='✓ 이수완료'; card.classList.add('vc-completed'); }
      else if(item.progress>0){ badge.className='vc-badge ing'; badge.textContent='● 수강중 '+item.progress+'%'; }
      else { badge.className='vc-badge todo'; badge.textContent='영상 강의'; }
    });
  }

  // =========================================================
  // 콘텐츠 모달 이수 바 (openContentModal 래핑)
  // =========================================================
  // =========================================================
  // 서면 자료 뷰어 (캡쳐 이미지 방식) + 레이아웃 토글
  // =========================================================
  var DOCS = (typeof DOC_ASSETS !== 'undefined') ? DOC_ASSETS : {};
  var docMode = 'scroll';   // 'scroll' = 세로 스크롤 / 'page' = 가로 넘김
  var docZoom = 'fit';      // 'fit' = 폭 맞춤 / 'zoom' = 확대
  var docPage = 1;
  var layoutMode = 'video'; // 'video' = 영상 중심 / 'doc' = 문서 중심

  function docAssetOf(url){ return DOCS[url] || null; }

  function buildDocViewer(url, hostEl){
    var a = docAssetOf(url); if(!a) return null;
    var host = hostEl || document.querySelector('.detail-frame-wrap'); if(!host) return null;
    docPage = 1;
    var imgs = a.pages.map(function(src,i){
      return '<figure class="vd-page" data-p="'+(i+1)+'">'+
        '<img src="'+src+'" alt="'+(i+1)+'페이지" loading="'+(i===0?'eager':'lazy')+'">'+
        '<figcaption>'+(i+1)+' / '+a.pages.length+'</figcaption></figure>';
    }).join('');
    host.classList.add('vd-host');
    host.innerHTML =
      '<div class="vd-bar">'+
        '<span class="vd-label">참고 문서</span>'+
        '<div class="vd-seg" role="group" aria-label="보기 방식">'+
          '<button type="button" data-dmode="scroll" class="'+(docMode==='scroll'?'on':'')+'">세로 스크롤</button>'+
          '<button type="button" data-dmode="page" class="'+(docMode==='page'?'on':'')+'">가로 넘김</button>'+
        '</div>'+
        '<button type="button" class="vd-btn" id="vdZoom">'+(docZoom==='fit'?'＋ 확대':'– 폭 맞춤')+'</button>'+
        '<span class="vd-count" id="vdCount">1 / '+a.pages.length+'</span>'+
      '</div>'+
      '<div class="vd-view '+docMode+' '+docZoom+'" id="vdView">'+imgs+'</div>'+
      '<button type="button" class="vd-nav prev" id="vdPrev" aria-label="이전 페이지">‹</button>'+
      '<button type="button" class="vd-nav next" id="vdNext" aria-label="다음 페이지">›</button>';

    var view = host.querySelector('#vdView');
    var count = host.querySelector('#vdCount');
    var total = a.pages.length;
    function sync(){
      view.className = 'vd-view '+docMode+' '+docZoom;
      host.querySelectorAll('[data-dmode]').forEach(function(b){ b.classList.toggle('on', b.getAttribute('data-dmode')===docMode); });
      host.querySelector('#vdZoom').textContent = (docZoom==='fit'?'＋ 확대':'– 폭 맞춤');
      host.classList.toggle('paged', docMode==='page');
      count.textContent = docPage+' / '+total;
    }
    function goto(p){
      docPage = Math.max(1, Math.min(total, p));
      var el = view.querySelector('.vd-page[data-p="'+docPage+'"]');
      if(!el) return;
      if(docMode==='page') view.scrollTo({ left: el.offsetLeft - view.offsetLeft, behavior:'smooth' });
      else view.scrollTo({ top: el.offsetTop - view.offsetTop, behavior:'smooth' });
      sync();
    }
    host.querySelectorAll('[data-dmode]').forEach(function(b){ b.onclick=function(){ docMode=b.getAttribute('data-dmode'); sync(); goto(docPage); }; });
    host.querySelector('#vdZoom').onclick = function(){ docZoom = (docZoom==='fit'?'zoom':'fit'); sync(); };
    host.querySelector('#vdPrev').onclick = function(){ goto(docPage-1); };
    host.querySelector('#vdNext').onclick = function(){ goto(docPage+1); };
    // 스크롤 위치로 현재 페이지 표시 갱신
    view.addEventListener('scroll', function(){
      var best=1, bd=Infinity;
      view.querySelectorAll('.vd-page').forEach(function(el){
        var d = docMode==='page' ? Math.abs(el.offsetLeft - view.offsetLeft - view.scrollLeft)
                                 : Math.abs(el.offsetTop - view.offsetTop - view.scrollTop);
        if(d<bd){ bd=d; best=parseInt(el.getAttribute('data-p'),10); }
      });
      if(best!==docPage){ docPage=best; count.textContent = docPage+' / '+total; }
    });
    sync();
    return true;
  }

  function injectLayoutToggle(){
    var modal = document.querySelector('.content-modal'); if(!modal) return;
    if(modal.querySelector('.vc-layout-seg')) return;
    var bar = modal.querySelector('.vc-modal-bar'); if(!bar) return;
    var seg = document.createElement('div');
    seg.className='vc-layout-seg';
    seg.innerHTML =
      '<button type="button" data-lay="video" class="'+(layoutMode==='video'?'on':'')+'">영상 크게</button>'+
      '<button type="button" data-lay="doc" class="'+(layoutMode==='doc'?'on':'')+'">문서 크게</button>';
    bar.appendChild(seg);
    seg.querySelectorAll('[data-lay]').forEach(function(b){ b.onclick=function(){
      layoutMode = b.getAttribute('data-lay');
      applyLayout();
      seg.querySelectorAll('[data-lay]').forEach(function(x){ x.classList.toggle('on', x.getAttribute('data-lay')===layoutMode); });
    }; });
  }
  function applyLayout(){
    var modal = document.querySelector('.content-modal'); if(!modal) return;
    modal.classList.toggle('doc-focus', layoutMode==='doc');
  }

  var _origOpen = window.openContentModal;
  var currentModalUrl = null;
  window.openContentModal = function(url, name, product, yt){
    if(typeof _origOpen === 'function') _origOpen(url, name, product, yt);
    var cm = document.querySelector('.content-modal');
    var ys = document.getElementById('modalYtSection');
    var hasYt = !!(yt && String(yt).trim());

    if(!IS_LEARNING_PAGE){
      // 자료실(제품 페이지) = 문서 참고 라이브러리. 유튜브/이수 UI 없음.
      if(CFG.HIDE_YT_IN_ARCHIVE && ys){ ys.style.display='none'; var yf=document.getElementById('modalYtFrame'); if(yf) yf.src=''; }
      if(cm){ cm.classList.remove('has-video','learn-mode','doc-focus'); }
      var oldBar = cm && cm.querySelector('.vc-modal-bar'); if(oldBar) oldBar.remove();
      currentModalUrl = url;
      buildDocViewer(url);   // 자체 호스팅 문서가 있으면 이미지 뷰어로 대체
      return;
    }

    // 학습 대시보드 = 이수 관리. 영상(주) + 문서(부).
    if(cm){ cm.classList.add('learn-mode'); if(hasYt) cm.classList.add('has-video'); else cm.classList.remove('has-video'); }
    if(ys && hasYt) ys.style.display='block';
    currentModalUrl = url;
    recordVisit(url);
    injectModalBar();
    updateModalBar(url, product, name);
    injectLayoutToggle();
    applyLayout();
    buildDocViewer(url);
    if(hasYt) trackYouTube(url, product, name, yt);
    decorateCards();
    refreshChip();
  };

  function injectModalBar(){
    var modal = document.querySelector('.content-modal'); if(!modal) return;
    if(modal.querySelector('.vc-modal-bar')) return;
    var bar = document.createElement('div');
    bar.className = 'vc-modal-bar';
    bar.innerHTML =
      '<div class="vc-ring"><svg viewBox="0 0 46 46"><circle class="t" cx="23" cy="23" r="19"/>'+
      '<circle class="f" id="vcModalRing" cx="23" cy="23" r="19"/></svg><span id="vcModalPct">0%</span></div>'+
      '<div class="vc-txt" id="vcModalTxt"></div>'+
      (MANUAL_COMPLETE ? '<button type="button" class="vc-complete-btn" id="vcModalBtn">학습 완료로 표시</button>' : '');
    // 모달 최상단(제목 아래)에 삽입
    var top = modal.querySelector('.modal-top');
    if(top && top.nextSibling) modal.insertBefore(bar, top.nextSibling);
    else modal.insertBefore(bar, modal.firstChild);
  }

  function updateModalBar(url, product, name){
    var ring = document.getElementById('vcModalRing');
    var pctEl = document.getElementById('vcModalPct');
    var txt = document.getElementById('vcModalTxt');
    var btn = document.getElementById('vcModalBtn');
    if(!ring || !pctEl || !txt) return;
    if(url) currentModalUrl = url;
    var item = it(currentModalUrl);
    var C = 2*Math.PI*19, off = C*(1 - item.progress/100);
    ring.setAttribute('stroke-dasharray', C); ring.setAttribute('stroke-dashoffset', off);
    pctEl.textContent = item.progress + '%';
    if(item.completedAt){
      txt.innerHTML = '<b>이수 완료</b> · '+fmt(item.completedAt)+'에 이수했어요.';
      if(btn){ btn.textContent = '✓ 이수 완료'; btn.classList.add('is-done'); }
    } else {
      txt.innerHTML = '<b>이수 기준: 영상 90% 이상 시청</b><br/>영상을 끝까지 시청하면 자동으로 이수 처리됩니다.';
      if(btn){ btn.textContent = '학습 완료로 표시'; btn.classList.remove('is-done'); }
    }
    if(btn) btn.onclick = function(){ markComplete(currentModalUrl, product, name); };
  }

  // =========================================================
  // YouTube 시청 진도율 (IFrame Player API) — best-effort
  // =========================================================
  var ytPlayer = null, ytPoll = null, ytApiLoading = false, ytApiReady = false;
  function ytId(u){ try{ var x=new URL(u);
    if(x.hostname.indexOf('youtu.be')>=0) return x.pathname.slice(1);
    if(x.searchParams.get('v')) return x.searchParams.get('v');
  }catch(e){} return ''; }

  function loadYTAPI(cb){
    if(ytApiReady){ cb(); return; }
    window.onYouTubeIframeAPIReady = function(){ ytApiReady = true; cb(); };
    if(ytApiLoading) return; ytApiLoading = true;
    var s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  }

  // 오류 153 방지: origin 파라미터는 http(s) 로 서빙될 때만 유효.
  // file:// 로 열면 location.origin 이 "null" 이라 플레이어 구성 오류가 발생함.
  function ytEmbedSrc(vid){
    var base = 'https://www.youtube.com/embed/'+vid+'?enablejsapi=1&rel=0&playsinline=1';
    if(location.protocol==='http:' || location.protocol==='https:'){
      base += '&origin=' + encodeURIComponent(location.origin);
    }
    return base;
  }

  function trackYouTube(url, product, name, ytUrl, frameId, onEnded){
    var vid = ytId(ytUrl); if(!vid) return;
    var fid = frameId || 'modalYtFrame';
    var frame = document.getElementById(fid); if(!frame) return;
    frame.src = ytEmbedSrc(vid);
    stopYTPoll();
    loadYTAPI(function(){
      try{
        if(ytPlayer && ytPlayer.destroy){ try{ ytPlayer.destroy(); }catch(e){} ytPlayer=null; }
        ytPlayer = new YT.Player(fid, { events: {
          'onStateChange': function(e){
            if(e.data === YT.PlayerState.PLAYING) startYTPoll(url, product, name);
            else stopYTPoll();
            if(e.data === YT.PlayerState.ENDED){
              applyProgress(url, 100, product, name);   // 끝까지 시청 → 이수 확정
              if(typeof onEnded === 'function') onEnded();
            }
          }
        }});
      }catch(e){}
    });
  }
  function startYTPoll(url, product, name){
    stopYTPoll();
    ytPoll = setInterval(function(){
      try{
        if(!ytPlayer || !ytPlayer.getDuration) return;
        var dur = ytPlayer.getDuration(), cur = ytPlayer.getCurrentTime();
        if(dur > 0){
          var pct = Math.round(cur/dur*100);
          applyProgress(url, pct, product, name);
          if(pct >= PASS) stopYTPoll();
        }
      }catch(e){}
    }, 2000);
  }
  function stopYTPoll(){ if(ytPoll){ clearInterval(ytPoll); ytPoll=null; } }

  // 모달이 닫히면 폴링 정지 (기존 close 버튼/배경 클릭/ESC 대응)
  document.addEventListener('click', function(e){
    var back = document.getElementById('contentModalBackdrop');
    if(!back) return;
    if(e.target && (e.target.id==='modalClose' || e.target.closest && e.target.closest('#modalClose') || e.target===back)) stopYTPoll();
  }, true);
  document.addEventListener('keydown', function(e){ if(e.key==='Escape') stopYTPoll(); });

  // =========================================================
  // 헤더 "내 학습" 칩
  // =========================================================
  function mountChip(){
    var host = document.querySelector('.header-icons'); if(!host) return;
    if(document.getElementById('vcChip')) return;
    var wrap = document.createElement('div');
    wrap.className='vc-chip-wrap'; wrap.id='vcChipWrap';
    var chip = document.createElement('button');
    chip.type='button'; chip.id='vcChip'; chip.className='vc-chip';
    chip.setAttribute('aria-haspopup','true'); chip.setAttribute('aria-expanded','false');
    chip.onclick = function(e){
      e.stopPropagation();
      if(!state.identity){ openIdentity(function(){ refreshChip(); refreshDashboard(); }); return; }
      toggleMenu();
    };
    var menu = document.createElement('div');
    menu.className='vc-menu'; menu.id='vcMenu';
    wrap.appendChild(chip); wrap.appendChild(menu);
    host.insertBefore(wrap, host.firstChild);
    // 바깥 클릭 / ESC 로 닫기
    document.addEventListener('click', function(){ closeMenu(); });
    document.addEventListener('keydown', function(e){ if(e.key==='Escape') closeMenu(); });
    menu.addEventListener('click', function(e){ e.stopPropagation(); });
    refreshChip();
  }
  function openMenu(){
    var m=document.getElementById('vcMenu'), c=document.getElementById('vcChip');
    if(!m) return; m.classList.add('open'); if(c) c.setAttribute('aria-expanded','true');
  }
  function closeMenu(){
    var m=document.getElementById('vcMenu'), c=document.getElementById('vcChip');
    if(!m) return; m.classList.remove('open'); if(c) c.setAttribute('aria-expanded','false');
  }
  function toggleMenu(){
    var m=document.getElementById('vcMenu'); if(!m) return;
    if(m.classList.contains('open')) closeMenu(); else openMenu();
  }
  function doLogout(){
    if(!confirm('로그아웃할까요?\n학습 기록은 이 브라우저에 보관되며, 같은 번호로 다시 로그인하면 이어집니다.')) return;
    state.identity = null; save(); closeMenu();
    refreshChip(); decorateCards();
    if(document.getElementById('vcDashboard')){ dashView='overview'; dashProgram=null; dashLesson=null; refreshDashboard(); }
  }
  function refreshChip(){
    var chip = document.getElementById('vcChip'); if(!chip) return;
    var menu = document.getElementById('vcMenu');
    var cap = '<svg class="vc-chip-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1 3 3 6 3s6-2 6-3v-5"/></svg>';

    if(!state.identity){
      chip.classList.remove('has-menu');
      chip.innerHTML = cap + '<span>로그인</span>';
      if(menu){ menu.innerHTML=''; menu.classList.remove('open'); }
      return;
    }

    var p = enrolledList().length ? enrolledPct() : overallPct();
    var done = enrolledList().length ? enrolledDone() : overallDone();
    var total = enrolledList().length ? enrolledItems().length : LESSONS.length;
    chip.classList.add('has-menu');
    chip.innerHTML = cap + '<span>'+esc(state.identity.name||'내 학습')+'</span>'+
      '<span class="vc-chip-pct '+(p===0?'zero':'')+'">'+p+'%</span>'+
      '<svg class="vc-chip-c" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

    if(!menu) return;
    var onDash = !!document.getElementById('vcDashboard');
    menu.innerHTML =
      '<div class="vc-menu-head"><b>'+esc(state.identity.name||'학습자')+'</b>'+
        '<span>'+esc(state.identity.clinic||state.identity.phone)+'</span></div>'+
      '<div class="vc-menu-stat">'+
        '<div><em>평균 수강률</em><b>'+p+'%</b></div>'+
        '<div><em>이수 강의</em><b>'+done+' / '+total+'</b></div>'+
      '</div>'+
      '<div class="vc-menu-bar"><i style="width:'+p+'%"></i></div>'+
      '<button type="button" class="vc-menu-item primary" id="vcGoDash">'+
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>'+
        (onDash ? '대시보드 맨 위로' : '학습 대시보드 열기') + '</button>'+
      '<button type="button" class="vc-menu-item" id="vcMenuOut">'+
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>로그아웃</button>';

    menu.querySelector('#vcGoDash').onclick = function(){
      closeMenu();
      if(onDash) window.scrollTo({top:0, behavior:'smooth'});
      else window.location.href = 'learning.html';
    };
    menu.querySelector('#vcMenuOut').onclick = doLogout;
  }

  // =========================================================
  // 오버레이 골격
  // =========================================================
  function makeOverlay(id){
    var o = document.getElementById(id);
    if(o) return o;
    o = document.createElement('div'); o.className='vc-overlay'; o.id=id;
    document.body.appendChild(o);
    o.addEventListener('click', function(e){ if(e.target===o) o.classList.remove('open'); });
    return o;
  }
  function closeX(){ return '<button type="button" class="vc-x" aria-label="닫기"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'; }

  // ---------- 식별(시작) ----------
  function openIdentity(onDone){
    var o = makeOverlay('vcIdentity');
    o.innerHTML =
      '<div class="vc-modal">'+ closeX() +'<div class="vc-pad">'+
        '<div class="vc-start-head"><div class="m">V</div>'+
          '<h2>간편 로그인</h2><p>가입·비밀번호 없이, 휴대폰 번호만으로 학습 기록이 이어집니다.</p></div>'+
        '<div class="vc-form">'+
          '<div class="vc-field"><label>이름 <span>(필수)</span></label><input id="vcName" type="text" placeholder="예: 김하나" autocomplete="name"></div>'+
          '<div class="vc-field"><label>휴대폰 번호 <span>(필수)</span></label><input id="vcPhone" type="tel" inputmode="numeric" placeholder="010-0000-0000" autocomplete="tel">'+
            '<div class="hint">이 번호가 학습 기록을 식별하는 열쇠입니다. 다음 방문 때 자동으로 이어집니다.</div></div>'+
          '<div class="vc-field"><label>병원·기관명 <span>(선택)</span></label><input id="vcClinic" type="text" placeholder="예: 하나치과의원" autocomplete="organization"></div>'+
          '<div class="vc-agree">'+
            '<div class="vc-agree-title">개인정보 수집·이용 안내</div>'+
            '<div class="vc-agree-desc">· 목적: 교육 콘텐츠 학습 진도·이수 관리 및 본인 식별<br>'+
              '· 수집 항목: (필수) 이름·휴대폰 번호 / (선택) 병원·기관명<br>'+
              '· 보유·이용 기간: 학습 기록 삭제 요청 또는 수집 목적 달성 시까지<br>'+
              '· 동의 거부 권리: 필수 항목 동의를 거부할 수 있으나, 거부 시 학습 기록 저장 기능 이용이 제한됩니다.</div>'+
            '<label class="vc-check"><input id="vcPrivacy" type="checkbox"><span><b>[필수]</b> 개인정보 수집·이용에 동의합니다.</span></label>'+
            '<label class="vc-check"><input id="vcConsent" type="checkbox"><span><b>[선택]</b> 광고성 정보(학습 알림) 문자·알림톡 수신에 동의합니다. <em>미동의 시에도 학습은 그대로 이용할 수 있습니다.</em></span></label>'+
          '</div>'+
          '<button type="button" class="vc-primary" id="vcStartBtn">로그인</button>'+
          '<div class="vc-foot">입력한 정보는 학습 진도·이수 관리 목적으로만 사용됩니다.</div>'+
        '</div>'+
      '</div></div>';
    o.classList.add('open');
    o.querySelector('.vc-x').onclick = function(){ o.classList.remove('open'); };
    if(state.identity){ o.querySelector('#vcName').value=state.identity.name||''; o.querySelector('#vcPhone').value=formatPhone(state.identity.phone||''); o.querySelector('#vcClinic').value=state.identity.clinic||''; o.querySelector('#vcConsent').checked=!!state.identity.consent; o.querySelector('#vcPrivacy').checked=true; }
    var vcPhoneInput = o.querySelector('#vcPhone');
    vcPhoneInput.addEventListener('input', function(){ vcPhoneInput.value = formatPhone(vcPhoneInput.value); });
    o.querySelector('#vcStartBtn').onclick = function(){
      var name=o.querySelector('#vcName').value.trim();
      var phone=o.querySelector('#vcPhone').value.trim();
      var clinic=o.querySelector('#vcClinic').value.trim();
      var privacy=o.querySelector('#vcPrivacy').checked;
      var consent=o.querySelector('#vcConsent').checked;
      if(!name){ alert('이름을 입력해 주세요.'); return; }
      if(phone.replace(/\D/g,'').length < 10){ alert('휴대폰 번호를 정확히 입력해 주세요.'); return; }
      if(!privacy){ alert('개인정보 수집·이용 동의(필수)가 필요합니다.'); return; }
      state.identity = { name:name, phone:phone, clinic:clinic, consent:consent, privacy:true };
      if(!state.firstStartAt) state.firstStartAt = now();
      state.lastVisit = now(); save(); syncIdentify();
      o.classList.remove('open'); refreshChip();
      if(typeof onDone==='function') onDone();
    };
  }

  // ---------- 내 학습 ----------
  function statusOf(pr){
    var pc=productPct(pr), dn=productDone(pr), tot=itemsOf(pr).length;
    if(tot>0 && pc>=100) return {cls:'done', label:'이수완료'};
    if(dn>0 || pc>0)      return {cls:'ing',  label:'학습중'};
    return {cls:'todo', label:'미시작'};
  }

  function programCard(pr){
    var m=productMeta(pr), pc=productPct(pr), tot=itemsOf(pr).length, dn=productDone(pr);
    var full = tot>0 && pc>=100;
    var st=statusOf(pr);
    var started=programStartedAt(pr), lastv=programLastVisit(pr), comp=programCompletedAt(pr);
    var ddText='—';
    if(full){ ddText='완료'; }
    else if(started){ var dd=DEADLINE_DAYS - daysBetween(now(), started); ddText = dd>=0 ? ('D-'+dd) : ('기한 경과 '+(-dd)+'일'); }
    return '<div class="vc-pcard">'+
      '<div class="ph"><span class="dot" style="background:'+m.color+'"></span>'+
        '<span class="nm">'+pr+'</span>'+
        '<span class="status '+st.cls+'">'+st.label+'</span>'+
        '<button type="button" class="cert" '+(full?('data-cert="'+pr+'"'):'disabled')+'>이수증</button></div>'+
      '<div class="vc-metrics">'+
        '<div class="vc-metric"><div class="k">진도율</div><div class="v">'+pc+'%</div></div>'+
        '<div class="vc-metric"><div class="k">이수 강의</div><div class="v">'+dn+'<span style="font-size:11px;color:var(--vatech-gray)"> / '+tot+'강</span></div></div>'+
        '<div class="vc-metric"><div class="k">완료일</div><div class="v" style="font-size:13px">'+fmt(comp)+'</div></div>'+
        '<div class="vc-metric"><div class="k">마지막 방문일</div><div class="v" style="font-size:13px">'+fmt(lastv)+'</div></div>'+
        '<div class="vc-metric"><div class="k">학습 시작일</div><div class="v" style="font-size:13px">'+fmt(started)+'</div></div>'+
        '<div class="vc-metric"><div class="k">이수 기한</div><div class="v" style="font-size:13px">'+ddText+'</div></div>'+
      '</div>'+
      '<div class="bar"><i style="width:'+pc+'%;background:'+(full?'#00a672':m.color)+'"></i></div>'+
    '</div>';
  }

  function enrollChecklist(){
    var rows = PRODUCTS.map(function(pr){
      var m=productMeta(pr), on=isEnrolled(pr);
      return '<label class="vc-enroll-item"><input type="checkbox" class="vc-enroll-cb" value="'+pr+'" '+(on?'checked':'')+'>'+
        '<span class="dot" style="background:'+m.color+'"></span>'+pr+
        '<span style="margin-left:auto;font-size:11px;color:var(--vatech-gray);font-weight:600">'+itemsOf(pr).length+'강</span></label>';
    }).join('');
    return '<div class="vc-enroll-list">'+rows+'</div>';
  }

  function openMyLearning(){
    var o = makeOverlay('vcLearning');
    var enrolled = enrolledList();
    var p = enrolledPct(), done = enrolledDone(), total = enrolledItems().length;
    var C = 2*Math.PI*43, off = C*(1 - p/100);

    var body;
    if(!enrolled.length){
      body = '<div class="vc-enroll-empty"><b>수강할 프로그램을 선택하세요.</b><br>선택한 프로그램만을 기준으로 진도율·완료일·마지막 방문일이 표시됩니다.</div>'+ enrollChecklist();
    } else {
      body = enrolled.map(programCard).join('')+
        '<button type="button" class="vc-edit-toggle" id="vcEditEnroll">＋ 수강 프로그램 추가·편집</button>'+
        '<div id="vcEnrollBox" class="vc-enroll-box" style="display:none">'+ enrollChecklist() +'</div>';
    }

    o.innerHTML =
      '<div class="vc-modal wide">'+ closeX() +'<div class="vc-pad">'+
        '<div class="vc-eyebrow">My Learning</div>'+
        '<div class="vc-dash">'+
          '<div class="big-ring"><svg width="96" height="96"><circle class="t" cx="48" cy="48" r="43"/>'+
            '<circle class="f" cx="48" cy="48" r="43" stroke-dasharray="'+C+'" stroke-dashoffset="'+off+'"/></svg>'+
            '<div class="n"><div><b>'+p+'%</b><em>수강 진도</em></div></div></div>'+
          '<div class="who"><h2>'+(state.identity.name||'학습자')+'님</h2>'+
            '<p>'+(state.identity.clinic||state.identity.phone)+'</p>'+
            '<div class="mini"><span>수강 <b>'+enrolled.length+'</b>개</span>'+
              '<span>이수 <b>'+done+'</b>/'+total+'강</span>'+
              '<span>마지막 방문 <b>'+fmt(enrolledLastVisit())+'</b></span></div></div>'+
        '</div>'+
        '<div id="vcNudges"></div>'+
        '<div class="vc-plist">'+body+'</div>'+
        '<div class="vc-me"><span class="lbl">학습 알림(광고성) 수신 · 선택</span>'+
          '<button type="button" class="vc-toggle '+(state.identity.consent?'on':'')+'" id="vcConsentToggle" aria-label="알림 동의 전환"></button>'+
          '<button type="button" class="vc-reset" id="vcResetBtn">기록 초기화</button></div>'+
      '</div></div>';
    o.classList.add('open');
    o.querySelector('.vc-x').onclick = function(){ o.classList.remove('open'); };
    renderNudges(o.querySelector('#vcNudges'));
    o.querySelectorAll('[data-cert]').forEach(function(b){ b.onclick=function(){ openCert(b.getAttribute('data-cert')); }; });
    o.querySelectorAll('.vc-enroll-cb').forEach(function(cb){ cb.onchange=function(){ setEnrolled(cb.value, cb.checked); openMyLearning(); }; });
    var edit=o.querySelector('#vcEditEnroll');
    if(edit) edit.onclick=function(){ var box=o.querySelector('#vcEnrollBox'); box.style.display = box.style.display==='none' ? 'block' : 'none'; };
    o.querySelector('#vcConsentToggle').onclick = function(){ state.identity.consent=!state.identity.consent; save(); syncIdentify(); this.classList.toggle('on'); };
    o.querySelector('#vcResetBtn').onclick = function(){
      if(confirm('이 브라우저의 학습 기록을 모두 지웁니다. 계속할까요?')){ localStorage.removeItem(KEY); state=blank(); refreshChip(); decorateCards(); o.classList.remove('open'); }
    };
  }

  function renderNudges(host){
    if(!host) return;
    var enrolled = enrolledList();
    if(!enrolled.length){ host.innerHTML=''; return; }
    var p = enrolledPct(), done = enrolledDone(), total = enrolledItems().length, t = now(), items = [];
    if(done===total && total>0){
      items.push('<div class="vc-nudge done"><div class="i">✓</div><div><b>수강 프로그램을 모두 이수했어요.</b> 각 프로그램의 이수증을 발급할 수 있습니다.</div></div>');
    } else {
      var st=null; enrolled.forEach(function(pr){ var s=programStartedAt(pr); if(s&&(!st||s<st))st=s; });
      if(st){
        var dday = DEADLINE_DAYS - daysBetween(t, st);
        if(dday < 0) items.push('<div class="vc-nudge todo"><div class="i">!</div><div><b>이수 권장 기한이 지났어요.</b> 수강 중인 프로그램에 아직 '+(total-done)+'개 강의가 남았습니다.<span class="tag">서버 연동 시 동의자에게 문자·보이는 ARS 자동 발송</span></div></div>');
        else if(dday <= 7) items.push('<div class="vc-nudge ing"><div class="i">⏱</div><div><b>이수까지 D-'+dday+'.</b> 남은 '+(total-done)+'개 강의를 기한 내 마무리해 보세요.<span class="tag">서버 연동 시 D-7·D-3·D-Day 알림 발송</span></div></div>');
      }
      var lv = enrolledLastVisit();
      if(lv && daysBetween(t, lv) >= REVISIT_DAYS){
        items.push('<div class="vc-nudge ing"><div class="i">↻</div><div><b>마지막 학습이 '+daysBetween(t,lv)+'일 전이에요.</b> 진도율 '+p+'%에서 이어서 볼 수 있습니다.<span class="tag">서버 연동 시 30일 미접속 재방문 알림 발송</span></div></div>');
      }
    }
    host.innerHTML = items.join('') || '<div class="vc-nudge done" style="background:var(--cloud);color:var(--ink-soft);border-color:var(--line)"><div class="i" style="background:var(--vatech-gray)">▸</div><div>순조롭게 학습 중이에요. 콘텐츠를 이어서 확인해 보세요.</div></div>';
  }

  // ---------- 이수증 (전문 교육기관 수료증 양식 참고) ----------
  function openCert(product){
    // 다른 오버레이는 닫아 인쇄 시 이수증만 출력되도록
    ['vcLearning','vcIdentity'].forEach(function(id){ var e=document.getElementById(id); if(e) e.classList.remove('open'); });
    var o = makeOverlay('vcCert');
    var tot=itemsOf(product).length, dn=productDone(product);
    var st=programStartedAt(product), comp=programCompletedAt(product);
    var d = new Date();
    var no = 'VMCIS-'+(LINKS[product]||product).toString().toUpperCase().replace(/[^A-Z0-9]/g,'')+'-'+d.getFullYear()+'-'+String(Math.abs(hash(state.identity.phone))%10000).padStart(4,'0');
    o.innerHTML =
      '<div class="vc-modal">'+ closeX() +'<div class="vc-pad">'+
        '<div class="vc-cert"><div class="frame">'+
          '<img class="logo" src="assets/logo-vatechmcis.png" alt="Vatech MCIS" onerror="this.style.display=\'none\'">'+
          '<div class="en">CERTIFICATE OF COMPLETION</div>'+
          '<h3>이 수 증</h3>'+
          '<div class="no-top">No. '+no+'</div>'+
          '<div class="give">아래 사람은 다음 교육 과정을 성실히 이수하였기에 이 증서를 수여합니다.</div>'+
          '<div class="name">'+(state.identity.name||'학습자')+'</div>'+
          '<div class="aff">'+(state.identity.clinic||'')+'</div>'+
          '<div class="course">'+product+' 교육 과정</div>'+
          '<div class="detail">이수 강의 '+dn+'강 / 전체 '+tot+'강 &nbsp;·&nbsp; 이수 기간 '+fmt(st)+' ~ '+fmt(comp)+'</div>'+
          '<div class="sign">'+
            '<div class="date">발급일<br><b>'+fmt(now())+'</b></div>'+
            '<div class="issuer">(주)바텍엠시스 교육팀<div class="seal">VATECH<br>MCIS<br>교육팀</div></div>'+
          '</div>'+
        '</div></div>'+
        '<button type="button" class="vc-primary" style="margin-top:16px" onclick="window.print()">PDF로 저장 / 인쇄</button>'+
      '</div></div>';
    o.classList.add('open');
    o.querySelector('.vc-x').onclick = function(){ o.classList.remove('open'); };
  }
  function hash(s){ var h=0; s=s||''; for(var i=0;i<s.length;i++){ h=(h*31+s.charCodeAt(i))|0; } return h; }

  // =========================================================
  // 학습 대시보드 (별도 페이지 learning.html 의 #vcDashboard 에 렌더)
  // =========================================================
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  var dashView='overview', dashProgram=null, dashTab='all', dashLesson=null;

  // 강의 카드 (프로그램 상세의 가로 캐러셀용)
  function lessonCard(item, idx){
    var m=productMeta(item.product), s=it(item.url), done=!!s.completedAt;
    var badge = done ? '<span class="lc-badge done">이수완료</span>'
              : (s.progress>0 ? '<span class="lc-badge ing">수강중 '+s.progress+'%</span>'
              : '<span class="lc-badge todo">미수강</span>');
    return '<div class="vc-lc'+(done?' done':'')+'">'+
      '<div class="lc-thumb" style="background:linear-gradient(135deg,'+m.color+',#12324a)" data-open-url="'+esc(item.url)+'">'+
        badge+'<span class="lc-no">'+(idx+1)+'강</span>'+
        (item.yt?'<span class="lc-tag yt">▶ YouTube</span>':'<span class="lc-tag doc">문서</span>')+
        '<span class="lc-play"></span></div>'+
      '<div class="lc-body"><div class="lc-title">'+esc(item.name)+'</div>'+
        '<div class="lc-bar"><i class="'+(done?'full':'')+'" style="width:'+s.progress+'%"></i></div>'+
        '<button type="button" class="lc-btn" data-open-url="'+esc(item.url)+'">'+(done?'다시 보기':(s.progress>0?'이어듣기':'수강하기'))+'</button>'+
      '</div></div>';
  }

  // 코스(프로그램) 카드 (대시보드 개요의 가로 캐러셀용)
  function courseCard(pr){
    var m=productMeta(pr), stt=statusOf(pr), pc=productPct(pr), tot=itemsOf(pr).length, dn=productDone(pr), enr=isEnrolled(pr);
    var full=tot>0 && pc>=100;
    var ready=hasCourse(pr);
    if(!ready){
      return '<div class="vc-cc soon">'+
        '<div class="cc-thumb" style="background:linear-gradient(135deg,#9aa5ae,#5f6b75)">'+
          '<span class="cc-type">'+esc(pr)+'</span>'+
          '<span class="cc-status todo">준비중</span></div>'+
        '<div class="cc-body"><div class="cc-name">'+esc(pr)+' 교육 과정</div>'+
          '<div class="cc-meta">영상 강의 준비 중 · 문서 '+docsOf(pr).length+'건</div>'+
          '<div class="cc-bar"><i style="width:0%"></i></div>'+
          '<div class="cc-foot"><span class="cc-pct">—</span>'+
            '<a class="cc-go" href="'+(LINKS[pr]||'index')+'.html">문서 보기 ›</a></div></div></div>';
    }
    return '<div class="vc-cc'+(enr?' clickable':'')+'" '+(enr?('data-prog="'+esc(pr)+'"'):'')+'>'+
      '<div class="cc-thumb" style="background:linear-gradient(135deg,'+m.color+',#0f2233)">'+
        '<span class="cc-type">'+esc(pr)+'</span>'+
        '<span class="cc-status '+stt.cls+'">'+stt.label+'</span></div>'+
      '<div class="cc-body"><div class="cc-name">'+esc(pr)+' 교육 과정</div>'+
        '<div class="cc-meta">영상 강의 '+tot+'강 · 이수 '+dn+'강</div>'+
        '<div class="cc-bar"><i class="'+(full?'full':'')+'" style="width:'+pc+'%;background:'+(full?'#00a672':m.color)+'"></i></div>'+
        '<div class="cc-foot"><span class="cc-pct">'+pc+'%</span>'+
          (enr?'<span class="cc-go">강의실 입장 ›</span>'
              :'<button type="button" class="cc-enroll" data-enroll="'+esc(pr)+'">＋ 수강신청</button>')+
        '</div></div></div>';
  }

  // 가로 캐러셀
  function carousel(id, cards){
    return '<div class="vc-carousel">'+
      '<button type="button" class="vc-rail-nav prev" data-rail="'+id+'" data-dir="-1" aria-label="이전">‹</button>'+
      '<div class="vc-rail" id="'+id+'">'+cards+'</div>'+
      '<button type="button" class="vc-rail-nav next" data-rail="'+id+'" data-dir="1" aria-label="다음">›</button></div>';
  }

  // 공통 바인딩 (캐러셀 화살표 / 콘텐츠 열기 / 이수증 / 수강신청)
  function bindCommon(root){
    root.querySelectorAll('.vc-rail-nav').forEach(function(b){ b.onclick=function(){
      var rail=root.querySelector('#'+b.getAttribute('data-rail')); if(!rail) return;
      rail.scrollBy({ left:(rail.clientWidth*0.85)*parseInt(b.getAttribute('data-dir'),10), behavior:'smooth' }); }; });
    root.querySelectorAll('[data-open-url]').forEach(function(el){ el.onclick=function(e){ e.stopPropagation();
      var u=el.getAttribute('data-open-url');
      var lesson=LESSONS.filter(function(x){return x.url===u;})[0];
      // 학습 페이지 = 플레이어로 진입 / 그 외 = 기존 모달
      if(lesson && document.getElementById('vcDashboard')){ openLesson(root, u); return; }
      var item=CATALOG.filter(function(x){return x.url===u;})[0];
      if(item && typeof window.openContentModal==='function') openContentModal(item.url,item.name,item.product,item.yt); }; });
    root.querySelectorAll('[data-cert]').forEach(function(b){ b.onclick=function(e){ e.stopPropagation(); openCert(b.getAttribute('data-cert')); }; });
    root.querySelectorAll('[data-enroll]').forEach(function(b){ b.onclick=function(e){ e.stopPropagation(); setEnrolled(b.getAttribute('data-enroll'), true); renderDashboard(root); refreshChip(); }; });
  }

  // 색상 원형 그래프 헬퍼
  function donut(items, size, thick, top, bottom){
    var r=(size/2)-thick/2-1, C=2*Math.PI*r, total=0, i;
    for(i=0;i<items.length;i++) total+=items[i].value;
    var segs='', cum=0;
    if(total>0){
      for(i=0;i<items.length;i++){ var v=items[i].value; if(v<=0) continue;
        var frac=v/total, arc=frac*C;
        segs += '<circle cx="'+size/2+'" cy="'+size/2+'" r="'+r+'" fill="none" stroke="'+items[i].color+'" stroke-width="'+thick+'" stroke-dasharray="'+arc+' '+(C-arc)+'" stroke-dashoffset="'+(-cum*C)+'"/>';
        cum+=frac;
      }
    }
    return '<div class="vc-donut'+(bottom?' has-cap':'')+'" style="width:'+size+'px">'+
      '<div class="vc-donut-g" style="width:'+size+'px;height:'+size+'px">'+
      '<svg width="'+size+'" height="'+size+'" style="transform:rotate(-90deg)">'+
        '<circle cx="'+size/2+'" cy="'+size/2+'" r="'+r+'" fill="none" stroke="#eef1f4" stroke-width="'+thick+'"/>'+segs+'</svg>'+
      '<div class="vc-donut-c">'+(top?'<b>'+top+'</b>':'')+'</div></div>'+
      (bottom?'<div class="vc-donut-cap">'+bottom+'</div>':'')+'</div>';
  }
  function ring2(pct, size, thick, color, top, bottom){
    var r=(size/2)-thick/2-1, C=2*Math.PI*r, off=C*(1-Math.max(0,Math.min(100,pct))/100);
    return '<div class="vc-donut'+(bottom?' has-cap':'')+'" style="width:'+size+'px">'+
      '<div class="vc-donut-g" style="width:'+size+'px;height:'+size+'px">'+
      '<svg width="'+size+'" height="'+size+'" style="transform:rotate(-90deg)">'+
        '<circle cx="'+size/2+'" cy="'+size/2+'" r="'+r+'" fill="none" stroke="#eef1f4" stroke-width="'+thick+'"/>'+
        '<circle cx="'+size/2+'" cy="'+size/2+'" r="'+r+'" fill="none" stroke="'+color+'" stroke-width="'+thick+'" stroke-linecap="round" stroke-dasharray="'+C+'" stroke-dashoffset="'+off+'"/></svg>'+
      '<div class="vc-donut-c">'+(top?'<b>'+top+'</b>':'')+'</div></div>'+
      (bottom?'<div class="vc-donut-cap">'+bottom+'</div>':'')+'</div>';
  }

  function renderDashboard(root){
    if(!root) return;
    if(!state.identity){
      root.innerHTML = '<div class="vc-dp"><div class="vc-dp-empty"><h2>학습 대시보드</h2>'+
        '<p>휴대폰 번호로 간편 로그인하면 나만의 학습 현황이 이어집니다.</p>'+
        '<button type="button" class="vc-primary" id="vcDpStart" style="max-width:240px;margin:16px auto 0">간편 로그인</button></div></div>';
      root.querySelector('#vcDpStart').onclick = function(){ openIdentity(function(){ renderDashboard(root); refreshChip(); }); };
      return;
    }
    if(dashView==='player' && dashLesson){
      var li = LESSONS.filter(function(x){ return x.url===dashLesson; })[0];
      if(li && isEnrolled(li.product)){ renderPlayer(root, li); return; }
      dashView='overview'; dashLesson=null;
    }
    if(dashView==='program' && dashProgram && isEnrolled(dashProgram)){ renderProgramDetail(root, dashProgram); return; }
    dashView='overview'; dashProgram=null; renderOverview(root);
  }

  // ---------- 강의 플레이어 (좌: 영상 / 우: 강의 목차) ----------
  function openLesson(root, url){
    var li = LESSONS.filter(function(x){ return x.url===url; })[0]; if(!li) return;
    dashLesson=url; dashProgram=li.product; dashView='player';
    renderDashboard(root); window.scrollTo({top:0,behavior:'instant'});
  }

  function renderPlayer(root, li){
    var pr=li.product, m=productMeta(pr);
    var list=itemsOf(pr);
    var idx=list.findIndex(function(x){ return x.url===li.url; });
    var next=list[idx+1]||null;
    var st=it(li.url), done=!!st.completedAt;
    var pc=productPct(pr), dn=productDone(pr), tot=list.length;
    var hasDoc=!!docAssetOf(li.url);

    var playlist=list.map(function(x,i){
      var s=it(x.url), d=!!s.completedAt, cur=x.url===li.url;
      return '<button type="button" class="vp-item'+(cur?' cur':'')+(d?' done':'')+'" data-lesson="'+esc(x.url)+'">'+
        '<span class="vp-no">'+(d?'✓':(i+1))+'</span>'+
        '<span class="vp-t">'+esc(x.name)+'</span>'+
        '<span class="vp-s">'+(d?'이수':(s.progress>0?s.progress+'%':'미수강'))+'</span></button>';
    }).join('');

    root.innerHTML='<div class="vc-dp">'+
      '<button type="button" class="vc-back" id="vcBack">← 강의실로</button>'+
      '<div class="vp-wrap">'+
        '<div class="vp-main">'+
          '<div class="vp-stage"><div id="vcPlayerFrame"></div></div>'+
          '<div class="vp-info">'+
            '<div class="vp-eyebrow" style="color:'+m.color+'">'+esc(pr)+' · '+(idx+1)+'강</div>'+
            '<h1>'+esc(li.name)+'</h1>'+
            '<div class="vp-status'+(done?' done':'')+'" id="vpStatus">'+
              (done?'✓ 이수 완료 · '+fmt(st.completedAt):'이수 기준: 영상 90% 이상 시청 시 자동 이수')+'</div>'+
          '</div>'+
          '<div class="vp-next" id="vpNext" style="display:none">'+
            '<div class="vp-next-t"><b>강의를 모두 들었어요.</b>'+(next?'다음 강의로 이어서 학습할까요?':'이 과정의 마지막 강의입니다.')+'</div>'+
            (next?'<button type="button" class="vp-next-btn" data-lesson="'+esc(next.url)+'">다음 강의 ▸ '+esc(next.name)+'</button>'
                 :'<button type="button" class="vp-next-btn" id="vpDone">강의실로 돌아가기</button>')+
          '</div>'+
          (hasDoc?'<div class="vp-doc"><div class="detail-frame-wrap" id="vpDocHost"></div></div>':'')+
        '</div>'+
        '<aside class="vp-side">'+
          '<div class="vp-side-h"><div><b>강의 목차</b><span>'+dn+' / '+tot+'강 이수 · '+pc+'%</span></div></div>'+
          '<div class="vp-side-bar"><i style="width:'+pc+'%;background:'+(pc>=100?'#00a672':m.color)+'"></i></div>'+
          '<div class="vp-list">'+playlist+'</div>'+
        '</aside>'+
      '</div></div>';

    root.querySelector('#vcBack').onclick=function(){ stopYTPoll(); dashView='program'; dashLesson=null; renderDashboard(root); window.scrollTo({top:0,behavior:'instant'}); };
    root.querySelectorAll('[data-lesson]').forEach(function(b){ b.onclick=function(){ stopYTPoll(); openLesson(root, b.getAttribute('data-lesson')); }; });
    var dn2=root.querySelector('#vpDone'); if(dn2) dn2.onclick=function(){ stopYTPoll(); dashView='program'; dashLesson=null; renderDashboard(root); };
    if(hasDoc) buildDocViewer(li.url, root.querySelector('#vpDocHost'));

    recordVisit(li.url);
    trackYouTube(li.url, pr, li.name, li.yt, 'vcPlayerFrame', function(){
      var n=root.querySelector('#vpNext'); if(n) n.style.display='flex';
      var s=root.querySelector('#vpStatus'); if(s){ s.textContent='✓ 이수 완료 · '+fmt(now()); s.classList.add('done'); }
    });
    refreshChip();
  }

  // ---------- 개요(내 강의실) ----------
  function renderOverview(root){
    var enrolled=enrolledList();
    var available=PRODUCTS.filter(function(pr){ return !isEnrolled(pr); });
    var p=enrolledPct(), done=enrolledDone(), total=enrolledItems().length;
    var progDone=enrolled.filter(function(pr){ return itemsOf(pr).length>0 && productPct(pr)>=100; }).length;
    var C=2*Math.PI*54, off=C*(1-p/100);

    var hero = '<div class="vc-dp-hero">'+
      '<div class="vc-dp-ringwrap">'+
      '<div class="vc-dp-ring"><svg width="128" height="128">'+
        '<defs><linearGradient id="vcHeroGrad" x1="0" y1="0" x2="1" y2="1">'+
          '<stop offset="0" stop-color="#00a672"/><stop offset="1" stop-color="#01c0a6"/></linearGradient></defs>'+
        '<circle class="t" cx="64" cy="64" r="54"/>'+
        '<circle class="f" cx="64" cy="64" r="54" stroke="url(#vcHeroGrad)" stroke-dasharray="'+C+'" stroke-dashoffset="'+off+'"/></svg>'+
        '<div class="n"><b>'+p+'%</b></div></div>'+
        '<div class="vc-dp-ringcap">평균 수강률</div></div>'+
      '<div class="vc-dp-hi"><div class="vc-eyebrow">My Classroom · 내 강의실</div>'+
        '<h1>'+esc(state.identity.name||'학습자')+'님의 학습 현황</h1>'+
        '<p>'+esc(state.identity.clinic||state.identity.phone)+'</p>'+
        '<div class="vc-dp-stats">'+
          '<div><b>'+enrolled.length+'</b><span>수강 강좌</span></div>'+
          '<div><b>'+done+' / '+total+'</b><span>이수 강의</span></div>'+
          '<div><b>'+progDone+' / '+enrolled.length+'</b><span>수료 프로그램</span></div>'+
          '<div><b>'+fmt(enrolledLastVisit())+'</b><span>최근 학습</span></div>'+
        '</div></div></div>';

    // 색상 원형 그래프(도넛) 통계
    var C_DONE='#00a672', C_ING='#f5a21b', C_TODO='#cbd2d9', C_REST='#e6eaef';
    var sc={done:0,ing:0,todo:0}; enrolled.forEach(function(pr){ sc[statusOf(pr).cls]++; });
    var statsHtml='';
    if(enrolled.length>0){
      var d1=donut([{value:sc.done,color:C_DONE},{value:sc.ing,color:C_ING},{value:sc.todo,color:C_TODO}], 96, 14, String(enrolled.length), '프로그램');
      var d2=donut([{value:done,color:C_DONE},{value:Math.max(0,total-done),color:C_REST}], 96, 14, p+'%', '이수율');
      statsHtml='<div class="vc-stats">'+
        '<div class="vc-statcard">'+d1+'<div class="sc-info"><h4>프로그램 이수 현황</h4><div class="vc-legend">'+
          '<div class="lg"><span class="sw" style="background:'+C_DONE+'"></span>수료<b>'+sc.done+'</b></div>'+
          '<div class="lg"><span class="sw" style="background:'+C_ING+'"></span>수강중<b>'+sc.ing+'</b></div>'+
          '<div class="lg"><span class="sw" style="background:'+C_TODO+'"></span>미시작<b>'+sc.todo+'</b></div>'+
        '</div></div></div>'+
        '<div class="vc-statcard">'+d2+'<div class="sc-info"><h4>전체 강의 이수율</h4><div class="vc-legend">'+
          '<div class="lg"><span class="sw" style="background:'+C_DONE+'"></span>이수<b>'+done+'강</b></div>'+
          '<div class="lg"><span class="sw" style="background:'+C_REST+'"></span>미이수<b>'+Math.max(0,total-done)+'강</b></div>'+
        '</div></div></div>'+
      '</div>';
    }

    var next = enrolledItems().filter(function(i){ var s=it(i.url); return s.progress>0 && !s.completedAt; })[0]
            || enrolledItems().filter(function(i){ return !it(i.url).completedAt; })[0];
    var cont='';
    if(next){ var mm=productMeta(next.product), pr2=it(next.url).progress;
      cont='<div class="vc-dp-continue">'+
        '<div class="cbadge" style="background:'+mm.color+'">이어서 학습</div>'+
        '<div class="cmeta"><span>'+esc(next.product)+'</span><h3>'+esc(next.name)+'</h3></div>'+
        '<button type="button" class="vc-primary" data-open-url="'+esc(next.url)+'" style="width:auto;padding:11px 18px">'+(pr2>0?'이어듣기':'학습 시작')+'</button></div>';
    }

    var tabs='<div class="vc-tabs">'+['all','ing','done'].map(function(t){ var lbl=(t==='all'?'전체':(t==='ing'?'수강중':'수강완료'));
      return '<button type="button" class="vc-tab'+(dashTab===t?' on':'')+'" data-tab="'+t+'">'+lbl+'</button>'; }).join('')+'</div>';
    var shown=enrolled.filter(function(pr){ var full=itemsOf(pr).length>0 && productPct(pr)>=100;
      if(dashTab==='done') return full; if(dashTab==='ing') return !full; return true; });
    var myRoom = enrolled.length
      ? (shown.length ? carousel('railMy', shown.map(courseCard).join('')) : '<div class="vc-dp-note">해당 상태의 강좌가 없습니다.</div>')
      : '<div class="vc-dp-note">아직 수강 중인 강좌가 없습니다. 아래 <b>수강신청</b>에서 프로그램을 담아보세요.</div>';
    var avail = available.length ? carousel('railAvail', available.map(courseCard).join('')) : '<div class="vc-dp-note">모든 프로그램을 수강 중입니다.</div>';

    var foot = '<div class="vc-dp-foot"><div class="vc-me">'+
        '<span class="lbl">학습 알림(광고성) 수신 · 선택</span>'+
        '<button type="button" class="vc-toggle '+(state.identity.consent?'on':'')+'" id="vcDpConsent" aria-label="알림 동의 전환"></button>'+
        '<button type="button" class="vc-logout-btn" id="vcDpLogout">로그아웃</button>'+
        '<button type="button" class="vc-reset" id="vcDpReset">기록 초기화</button></div>'+
      '<a class="vc-dp-back" href="index.html">← 교육 홈으로</a></div>';

    root.innerHTML='<div class="vc-dp">'+hero+statsHtml+'<div id="vcDpNudges" class="vc-dp-nudges"></div>'+cont+
      '<div class="vc-sec"><div class="vc-sec-h"><h2>내 강의실</h2>'+tabs+'</div>'+myRoom+'</div>'+
      '<div class="vc-sec"><div class="vc-sec-h"><h2>수강신청</h2><span class="vc-sec-sub">관심 프로그램을 담고 학습을 시작하세요</span></div>'+avail+'</div>'+
      foot+'</div>';

    renderNudges(root.querySelector('#vcDpNudges'));
    bindCommon(root);
    root.querySelectorAll('.vc-cc[data-prog]').forEach(function(el){ el.onclick=function(){ dashProgram=el.getAttribute('data-prog'); dashView='program'; renderDashboard(root); window.scrollTo({top:0,behavior:'instant'}); }; });
    root.querySelectorAll('.vc-tab').forEach(function(b){ b.onclick=function(){ dashTab=b.getAttribute('data-tab'); renderOverview(root); }; });
    var ct=root.querySelector('#vcDpConsent'); if(ct) ct.onclick=function(){ state.identity.consent=!state.identity.consent; save(); syncIdentify(); this.classList.toggle('on'); };
    var lo=root.querySelector('#vcDpLogout'); if(lo) lo.onclick=doLogout;
    var rs=root.querySelector('#vcDpReset'); if(rs) rs.onclick=function(){ if(confirm('이 브라우저의 학습 기록을 모두 지웁니다. 계속할까요?')){ localStorage.removeItem(KEY); state=blank(); dashView='overview'; dashProgram=null; renderDashboard(root); refreshChip(); } };
  }

  // ---------- 프로그램 상세(강의실) ----------
  function renderProgramDetail(root, pr){
    var m=productMeta(pr), stt=statusOf(pr), pc=productPct(pr), tot=itemsOf(pr).length, dn=productDone(pr);
    var full=tot>0 && pc>=100;
    var started=programStartedAt(pr), lastv=programLastVisit(pr), comp=programCompletedAt(pr);
    var ddText='—'; if(full) ddText='완료'; else if(started){ var dd=DEADLINE_DAYS-daysBetween(now(),started); ddText=dd>=0?('D-'+dd):('기한 경과 '+(-dd)+'일'); }
    var cards=itemsOf(pr).map(lessonCard).join('');

    root.innerHTML='<div class="vc-dp">'+
      '<button type="button" class="vc-back" id="vcBack">← 대시보드로</button>'+
      '<div class="vc-pd-head">'+
        '<div class="pd-ring">'+ring2(pc, 72, 9, m.color, pc+'%', '수강률')+'</div>'+
        '<div class="pd-hi"><div class="vc-eyebrow">강의실</div><h1>'+esc(pr)+' 교육 과정</h1>'+
          '<span class="pd-status '+stt.cls+'">'+stt.label+'</span></div>'+
        '<div class="pd-actions">'+(full?('<button type="button" class="pd-cert" data-cert="'+esc(pr)+'">이수증 발급</button>'):'')+
          '<button type="button" class="pd-cancel" data-cancel="'+esc(pr)+'">수강 취소</button></div></div>'+
      '<div class="vc-pd-bar"><i class="'+(full?'full':'')+'" style="width:'+pc+'%;background:'+(full?'#00a672':m.color)+'"></i></div>'+
      '<div class="vc-metrics vc-pd-metrics">'+
        '<div class="vc-metric"><div class="k">진도율(수강률)</div><div class="v">'+pc+'%</div></div>'+
        '<div class="vc-metric"><div class="k">이수 강의</div><div class="v">'+dn+'<span style="font-size:11px;color:var(--vatech-gray)"> / '+tot+'강</span></div></div>'+
        '<div class="vc-metric"><div class="k">완료일</div><div class="v" style="font-size:13px">'+fmt(comp)+'</div></div>'+
        '<div class="vc-metric"><div class="k">마지막 방문일</div><div class="v" style="font-size:13px">'+fmt(lastv)+'</div></div>'+
        '<div class="vc-metric"><div class="k">학습 시작일</div><div class="v" style="font-size:13px">'+fmt(started)+'</div></div>'+
        '<div class="vc-metric"><div class="k">이수 기한</div><div class="v" style="font-size:13px">'+ddText+'</div></div></div>'+
      '<div class="vc-sec"><div class="vc-sec-h"><h2>강의 목차</h2><span class="vc-sec-sub">'+dn+' / '+tot+'강 이수 · 영상 90% 이상 시청 시 자동 이수</span></div>'+
        carousel('railLes', cards)+'</div>'+
      (docsOf(pr).length ? '<div class="vc-sec"><div class="vc-sec-h"><h2>참고 문서</h2><span class="vc-sec-sub">이수 대상이 아닌 보조 자료 · 자료실에서 열람</span></div>'+
        '<div class="vc-doclist">'+docsOf(pr).map(function(d){
          return '<a class="vc-doc" href="'+(LINKS[pr]||'index')+'.html">'+esc(d.name)+'</a>'; }).join('')+'</div></div>' : '')+
    '</div>';

    bindCommon(root);
    root.querySelector('#vcBack').onclick=function(){ dashView='overview'; dashProgram=null; renderDashboard(root); window.scrollTo({top:0,behavior:'instant'}); };
    var cancel=root.querySelector('[data-cancel]'); if(cancel) cancel.onclick=function(){
      if(confirm(pr+' 강좌 수강을 취소하시겠어요? (학습 기록은 보관되며, 다시 수강신청하면 이어집니다)')){
        setEnrolled(pr,false); dashView='overview'; dashProgram=null; renderDashboard(root); refreshChip(); } };
  }

  // 재생 중에는 전체 재렌더 금지 (iframe 재생성 → 영상이 처음으로 되돌아감).
  // 플레이어 화면에서는 진도 관련 요소만 부분 갱신한다.
  function refreshDashboard(){
    var el=document.getElementById('vcDashboard'); if(!el) return;
    if(dashView==='player' && dashLesson){ updatePlayerProgress(); return; }
    renderDashboard(el);
  }

  function updatePlayerProgress(){
    var root=document.getElementById('vcDashboard'); if(!root || !dashLesson) return;
    var li=LESSONS.filter(function(x){ return x.url===dashLesson; })[0]; if(!li) return;
    var pr=li.product, m=productMeta(pr);
    var list=itemsOf(pr), pc=productPct(pr), dn=productDone(pr), tot=list.length;

    var h=root.querySelector('.vp-side-h span');
    if(h) h.textContent = dn+' / '+tot+'강 이수 · '+pc+'%';
    var bar=root.querySelector('.vp-side-bar i');
    if(bar){ bar.style.width=pc+'%'; bar.style.background=(pc>=100?'#00a672':m.color); }

    root.querySelectorAll('.vp-item').forEach(function(el){
      var u=el.getAttribute('data-lesson'); if(!u) return;
      var s=it(u), d=!!s.completedAt;
      var idx=-1; list.forEach(function(x,i){ if(x.url===u) idx=i; });
      el.classList.toggle('done', d);
      var no=el.querySelector('.vp-no'); if(no) no.textContent = d ? '✓' : (idx+1);
      var st=el.querySelector('.vp-s'); if(st) st.textContent = d ? '이수' : (s.progress>0 ? s.progress+'%' : '미수강');
    });

    var cur=it(dashLesson);
    var sEl=root.querySelector('#vpStatus');
    if(sEl){
      if(cur.completedAt){ sEl.textContent='✓ 이수 완료 · '+fmt(cur.completedAt); sEl.classList.add('done'); }
      else { sEl.textContent='이수 기준: 영상 90% 이상 시청 시 자동 이수 · 현재 '+cur.progress+'%'; sEl.classList.remove('done'); }
    }
  }

  // =========================================================
  // 초기화
  // =========================================================
  function init(){
    IS_LEARNING_PAGE = !!document.getElementById('vcDashboard');
    mountChip();
    decorateCards();
    var dash = document.getElementById('vcDashboard');
    if(dash) renderDashboard(dash);
    if(state.identity){ state.lastVisit = state.lastVisit || now(); }
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
