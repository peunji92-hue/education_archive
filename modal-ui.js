// 콘텐츠 상세 모달 공통 로직 (모든 페이지에서 공유)
(function () {
  const backdrop = document.getElementById('contentModalBackdrop');
  if (!backdrop) return;

  const frame = document.getElementById('modalFrame');
  const ytFrame = document.getElementById('modalYtFrame');
  const ytSection = document.getElementById('modalYtSection');
  const titleEl = document.getElementById('modalTitle');
  const eyebrowEl = document.getElementById('modalEyebrow');
  const openNewTab = document.getElementById('modalOpenNewTab');
  const closeBtn = document.getElementById('modalClose');

  function parseYoutubeId(ytUrl) {
    try {
      const u = new URL(ytUrl);
      if (u.hostname.includes('youtu.be')) return u.pathname.slice(1);
      if (u.searchParams.get('v')) return u.searchParams.get('v');
    } catch (e) {}
    return '';
  }

  window.openContentModal = function (url, name, product, yt) {
    titleEl.textContent = name;
    eyebrowEl.textContent = product;
    frame.src = url;
    openNewTab.href = url;

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

    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';

    // 모달 오픈 = 콘텐츠 열람으로 간주하여 조회수 +1 (화면에는 노출하지 않음)
    fetch('/api/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, type: 'miricanvas', name, product })
    }).catch(() => {});
  };

  function closeModal() {
    backdrop.classList.remove('open');
    document.body.style.overflow = '';
    frame.src = '';
    ytFrame.src = '';
  }

  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) closeModal();
  });
})();
