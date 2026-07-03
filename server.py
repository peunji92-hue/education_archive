"""
Education Team 아카이브 - 조회수 집계 서버
------------------------------------------------
- 정적 파일(index.html 등)을 서빙하면서, 동시에 클릭 조회수를 기록하는 간단한 API 서버입니다.
- 외부 패키지 설치가 필요 없습니다 (Python 3 표준 라이브러리만 사용).
- 최초 실행 시 seed_data.json에 있는 "미리캔버스에서 이미 확인한 조회수"로 DB를 초기화하고,
  그 이후부터는 실제 클릭이 발생할 때마다 그 값 위에 1씩 누적됩니다.

실행 방법:
    python3 server.py
    -> http://localhost:8000 접속

배포 시 주의:
    - 이 서버는 로컬 테스트/사내망 용도의 간단한 구현입니다.
    - 실제로 여러 사람이 사용하게 하려면, 사내 서버(또는 클라우드 VM)에 올리고
      계속 켜져 있어야 합니다 (예: systemd, pm2, screen, nohup 등으로 상시 구동).
    - HTTPS가 필요하면 앞단에 nginx 등 리버스 프록시를 두는 걸 권장합니다.
"""

import json
import os
import sqlite3
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "public")
DB_PATH = os.path.join(BASE_DIR, "clicks.db")
SEED_PATH = os.path.join(BASE_DIR, "seed_data.json")
PORT = 8000


# ---------------------------------------------------------------------------
# DB 초기화 / 시드 데이터 주입
# ---------------------------------------------------------------------------
def init_db():
    is_new = not os.path.exists(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS clicks (
            url TEXT PRIMARY KEY,
            product TEXT,
            name TEXT,
            youtube_url TEXT,
            miricanvas_views INTEGER DEFAULT 0,
            youtube_views INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()

    if is_new and os.path.exists(SEED_PATH):
        with open(SEED_PATH, "r", encoding="utf-8") as f:
            seed = json.load(f)
        for url, info in seed.items():
            conn.execute(
                """INSERT OR IGNORE INTO clicks
                   (url, product, name, youtube_url, miricanvas_views, youtube_views)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    url,
                    info.get("product"),
                    info.get("name"),
                    info.get("youtube_url"),
                    int(info.get("miricanvas_views") or 0),
                    int(info.get("youtube_views") or 0),
                ),
            )
        conn.commit()
        print(f"[init] 시드 데이터 {len(seed)}건을 clicks.db에 반영했습니다.")
    conn.close()


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ---------------------------------------------------------------------------
# HTTP 핸들러
# ---------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    # -------------------- GET --------------------
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/counts":
            self._api_counts()
            return
        if path == "/api/summary":
            self._api_summary()
            return

        # 정적 파일 서빙
        self._serve_static(path)

    def _serve_static(self, path):
        if path == "/":
            path = "/index.html"
        file_path = os.path.normpath(os.path.join(STATIC_DIR, path.lstrip("/")))
        if not file_path.startswith(STATIC_DIR):
            self.send_error(403)
            return
        if not os.path.isfile(file_path):
            self.send_error(404, "File not found")
            return
        ctype = mimetypes.guess_type(file_path)[0] or "application/octet-stream"
        with open(file_path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _api_counts(self):
        conn = get_conn()
        rows = conn.execute("SELECT * FROM clicks").fetchall()
        conn.close()
        data = {
            r["url"]: {
                "product": r["product"],
                "name": r["name"],
                "miricanvas_views": r["miricanvas_views"],
                "youtube_views": r["youtube_views"],
            }
            for r in rows
        }
        self._send_json(data)

    def _api_summary(self):
        conn = get_conn()
        rows = conn.execute(
            "SELECT product, SUM(miricanvas_views) as total_views, COUNT(*) as item_count "
            "FROM clicks GROUP BY product"
        ).fetchall()
        conn.close()
        self._send_json([dict(r) for r in rows])

    # -------------------- POST --------------------
    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/click":
            self._api_click()
            return
        self.send_error(404)

    def _api_click(self):
        body = self._read_json_body()
        url = body.get("url")
        kind = body.get("type", "miricanvas")  # 'miricanvas' or 'youtube'

        if not url:
            self._send_json({"error": "url is required"}, status=400)
            return

        column = "miricanvas_views" if kind != "youtube" else "youtube_views"

        conn = get_conn()
        row = conn.execute("SELECT * FROM clicks WHERE url = ?", (url,)).fetchone()
        if row is None:
            # 시트에 없던 새 링크가 들어오면 0부터 시작해서 새로 등록
            conn.execute(
                "INSERT INTO clicks (url, product, name, miricanvas_views, youtube_views) "
                "VALUES (?, ?, ?, 0, 0)",
                (url, body.get("product", ""), body.get("name", "")),
            )
            conn.commit()

        conn.execute(
            f"UPDATE clicks SET {column} = {column} + 1, updated_at = CURRENT_TIMESTAMP WHERE url = ?",
            (url,),
        )
        conn.commit()
        new_row = conn.execute("SELECT * FROM clicks WHERE url = ?", (url,)).fetchone()
        conn.close()

        self._send_json({
            "url": url,
            "miricanvas_views": new_row["miricanvas_views"],
            "youtube_views": new_row["youtube_views"],
        })

    # CORS preflight (같은 서버에서 서빙하면 보통 필요 없지만, 안전하게 열어둠)
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()


def main():
    init_db()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[server] http://localhost:{PORT} 에서 실행 중입니다. (Ctrl+C로 종료)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[server] 종료합니다.")
        server.server_close()


if __name__ == "__main__":
    main()
