// 검색 오버레이 공통 로직 (모든 페이지에서 공유)
(function () {
  const toggle = document.getElementById('searchToggle');
  const overlay = document.getElementById('searchOverlay');
  const closeLink = document.getElementById('searchClose');
  const input = document.getElementById('searchInput');
  const defaultView = document.getElementById('searchDefault');
  const resultsView = document.getElementById('searchResults');
  const popularWrap = document.getElementById('popularQuickLinks');

  if (!toggle || !overlay) return;

  function itemLinkAttrs(it) {
    const u = it.url.replace(/'/g, "\\'");
    const n = it.name.replace(/'/g, "\\'");
    const p = it.product.replace(/'/g, "\\'");
    const y = (it.yt || '').replace(/'/g, "\\'");
    return `href="#" onclick="closeSearchAndOpenModal('${u}','${n}','${p}','${y}'); return false;"`;
  }

  window.closeSearchAndOpenModal = function (u, n, p, y) {
    if (overlay.classList.contains('open')) {
      overlay.classList.remove('open');
      if (input) input.value = '';
    }
    if (typeof openContentModal === 'function') {
      openContentModal(u, n, p, y);
    }
  };

  // 인기 콘텐츠 5개를 빠른 링크 형태로 렌더 (클릭 시 모달)
  if (popularWrap && typeof SEARCH_ITEMS !== 'undefined') {
    const top5 = SEARCH_ITEMS.slice(0, 5);
    popularWrap.innerHTML = top5.map(it =>
      `<a ${itemLinkAttrs(it)}>${it.name}</a>`
    ).join('');
  }

  function openOverlay() {
    overlay.classList.add('open');
    setTimeout(() => input && input.focus(), 50);
  }
  function closeOverlay() {
    overlay.classList.remove('open');
    if (input) input.value = '';
    showDefault();
  }
  function showDefault() {
    defaultView.style.display = 'block';
    resultsView.style.display = 'none';
  }

  toggle.addEventListener('click', () => {
    if (overlay.classList.contains('open')) closeOverlay();
    else openOverlay();
  });
  closeLink.addEventListener('click', closeOverlay);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeOverlay();
  });

  if (input) {
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { showDefault(); return; }
      defaultView.style.display = 'none';
      resultsView.style.display = 'block';

      const matches = (typeof SEARCH_ITEMS !== 'undefined' ? SEARCH_ITEMS : [])
        .filter(it => it.name.toLowerCase().includes(q) || it.product.toLowerCase().includes(q))
        .slice(0, 20);

      if (matches.length === 0) {
        resultsView.innerHTML = '<div class="search-empty">검색 결과가 없습니다.</div>';
        return;
      }
      resultsView.innerHTML = matches.map(it => {
        return `<div class="result-row">
          <a class="result-name" ${itemLinkAttrs(it)}>${it.name}</a>
          <span class="result-meta">${it.product}</span>
        </div>`;
      }).join('');
    });
  }
})();
