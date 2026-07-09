// ================= 모바일 앱 공용 로직 =================
let searchDebounceTimer;

function switchTab(tab) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + tab).classList.add('active');
  document.querySelectorAll('.tab-item').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  window.scrollTo(0, 0);
}

// ---------- 카테고리 드릴다운 ----------
function openCategory(product) {
  switchTab('category');
  const listWrap = document.getElementById('categoryListWrap');
  const detailWrap = document.getElementById('categoryDetailWrap');
  const items = CATEGORY_ITEMS[product] || [];
  const meta = PRODUCT_META[product] || {};

  listWrap.style.display = 'none';
  detailWrap.style.display = 'block';

  const rowsHtml = items.map((it, idx) => feedCardHtml(it, product, idx + 1)).join('');

  detailWrap.innerHTML = `
    <div class="sub-header">
      <button class="back-btn" onclick="closeCategoryDetail()">${ICONS.back}</button>
      <h2>${escapeHtml(product)}</h2>
    </div>
    <div class="mini-search">
      ${ICONS.search}
      <input type="text" id="catSearchInput" placeholder="${escapeHtml(product)} 검색..." oninput="onCatSearchInput()" />
    </div>
    <div id="catItemList">${rowsHtml}</div>
    <div id="catEmpty" style="display:none;" class="search-empty-state">검색 결과가 없습니다.</div>
  `;
}

function closeCategoryDetail() {
  document.getElementById('categoryListWrap').style.display = 'block';
  document.getElementById('categoryDetailWrap').style.display = 'none';
  document.getElementById('categoryDetailWrap').innerHTML = '';
}

function onCatSearchInput() {
  clearTimeout(searchDebounceTimer);
  const val = document.getElementById('catSearchInput').value;
  searchDebounceTimer = setTimeout(() => applyCatSearch(val), 300);
}
function applyCatSearch(val) {
  const q = val.trim().toLowerCase();
  const rows = document.querySelectorAll('#catItemList .feed-card[data-name]');
  let visible = 0;
  rows.forEach(r => {
    const show = r.dataset.name.includes(q);
    r.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  document.getElementById('catEmpty').style.display = visible === 0 ? 'block' : 'none';
}

// ---------- 검색 뷰 ----------
const searchInputEl = document.getElementById('searchInput');
if (searchInputEl) {
  searchInputEl.addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    const val = searchInputEl.value;
    searchDebounceTimer = setTimeout(() => runSearch(val), 300);
  });
}
function runSearch(val) {
  const q = val.trim().toLowerCase();
  const resultsEl = document.getElementById('searchResults');
  if (!q) { resultsEl.innerHTML = ''; return; }
  const matches = MOBILE_ITEMS.filter(it =>
    it.name.toLowerCase().includes(q) || it.product.toLowerCase().includes(q)
  ).slice(0, 30);
  if (matches.length === 0) {
    resultsEl.innerHTML = '<div class="search-empty-state">검색 결과가 없습니다.</div>';
    return;
  }
  resultsEl.innerHTML = matches.map((it, idx) => feedCardHtml(it, it.product, null)).join('');
}

// ---------- 카드 렌더 헬퍼 ----------
function feedCardHtml(it, product, idx) {
  const brand = (PRODUCT_META[product] || {}).brand || 'dental';
  const initial = (PRODUCT_META[product] || {}).initial || '';
  const thumbHtml = it.thumb
    ? `<div class="fc-thumb ${brand}"><img src="assets/thumbnails/${it.thumb}" alt="" loading="lazy" /></div>`
    : `<div class="fc-thumb ${brand}">${escapeHtml(initial)}</div>`;
  const nameAttr = escapeHtml(it.name).toLowerCase();
  return `<div class="feed-card" data-name="${nameAttr}" onclick="${onclickFor(it, product)}">
    ${thumbHtml}
    <div class="fc-body">
      <div class="fc-title">${idx ? idx + '. ' : ''}${escapeHtml(it.name)}</div>
      <div class="fc-tag">${escapeHtml(product)}</div>
    </div>
    <div class="fc-arrow">›</div>
  </div>`;
}

function onclickFor(it, product) {
  const u = it.url.replace(/'/g, "\\'");
  const n = escapeHtml(it.name).replace(/'/g, "\\'");
  const p = product.replace(/'/g, "\\'");
  const y = (it.yt || '').replace(/'/g, "\\'");
  const t = (it.thumb || '').replace(/'/g, "\\'");
  return `openDetail('${u}','${n}','${p}','${y}','${t}')`;
}

function escapeHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const ICONS = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
};

// ---------- 콘텐츠 상세 (풀스크린 시트) ----------
function parseYoutubeId(ytUrl) {
  try {
    const u = new URL(ytUrl);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1);
    if (u.searchParams.get('v')) return u.searchParams.get('v');
  } catch (e) {}
  return '';
}

function openDetail(url, name, product, yt) {
  document.getElementById('dsTitle').textContent = name;
  document.getElementById('dsFrame').src = url;
  document.getElementById('dsOpenNewTab').href = url;

  const ytSection = document.getElementById('dsYtSection');
  const ytFrame = document.getElementById('dsYtFrame');
  if (yt) {
    const vid = parseYoutubeId(yt);
    if (vid) {
      ytFrame.src = 'https://www.youtube.com/embed/' + vid;
      ytSection.style.display = 'block';
    } else {
      ytSection.style.display = 'none';
    }
  } else {
    ytSection.style.display = 'none';
    ytFrame.src = '';
  }

  document.getElementById('detailSheet').classList.add('open');
  document.body.style.overflow = 'hidden';

  fetch('/api/click', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, type: 'miricanvas', name, product })
  }).catch(() => {});
}

function closeDetail() {
  document.getElementById('detailSheet').classList.remove('open');
  document.body.style.overflow = '';
  document.getElementById('dsFrame').src = '';
  document.getElementById('dsYtFrame').src = '';
}
