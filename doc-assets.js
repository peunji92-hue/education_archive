/* =========================================================
   서면 자료(문서) 자산 매핑  —  "캡쳐 이미지 방식"
   ---------------------------------------------------------
   PDF를 페이지 이미지(WebP)로 변환해 자체 호스팅하면,
   미리캔버스 iframe과 달리 스크롤·확대·페이지 넘김을 우리가 제어할 수 있습니다.

   변환 방법 (PDF → 페이지 이미지):
     pdftoppm -png -r 150 원본.pdf /tmp/pg
     python3 -c "from PIL import Image;import glob;\
       [Image.open(f).convert('RGB').save('docs/<slug>/p%d.webp'%i,'WEBP',quality=82,method=6) \
        for i,f in enumerate(sorted(glob.glob('/tmp/pg-*.png')),1)]"

   등록 방법: 콘텐츠 url(= search-data.js 의 url)을 키로 아래에 추가.
     pages : 페이지 이미지 경로 배열 (순서대로)
   ========================================================= */
const DOC_ASSETS = {
  "https://www.miricanvas.com/v/14geoj7": {
    pages: [
      "docs/clever-lab-01/p1.webp",
      "docs/clever-lab-01/p2.webp",
      "docs/clever-lab-01/p3.webp"
    ]
  }
};
