#!/usr/bin/env python3
"""Dependency-free, localhost-only memory review UI."""

from __future__ import annotations

import argparse
import html
import re
import secrets
import threading
import urllib.parse
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import profile as profile_cli

HOST = "127.0.0.1"
MAX_BODY = 16_384


def candidate_cards(vault: Path) -> str:
    files = sorted((vault / "30 Memory" / "Inbox").glob("*.md"))
    if not files:
        return '<section class="empty"><h2>没有待确认记忆</h2><p>继续与已连接的AI对话，候选记忆会出现在这里。</p></section>'
    cards: list[str] = []
    for file in files:
        try:
            metadata, body = profile_cli.read_record(file)
        except SystemExit:
            continue
        summary = re.search(r"(?ims)^##\s*摘要\s*\n(.+?)(?=\n##\s|\Z)", body)
        content = summary.group(1).strip() if summary else "（无摘要）"
        cards.append(
            '<article class="card">'
            f'<div class="meta"><span>{html.escape(metadata.get("type", "note"))}</span>'
            f'<span>{html.escape(metadata.get("source_agent", "unknown"))}</span>'
            f'<span>{html.escape(metadata.get("status", "candidate"))}</span></div>'
            f'<h2>{html.escape(metadata.get("subject") or "候选记忆")}</h2>'
            f'<p>{html.escape(content)}</p>'
            f'<a class="button" href="/candidate?file={urllib.parse.quote(file.name)}">审核</a>'
            '</article>'
        )
    return "".join(cards) or '<section class="empty"><h2>没有可审核的候选记忆</h2></section>'


def shell(title: str, body: str, message: str = "") -> bytes:
    notice = f'<div class="notice">{html.escape(message)}</div>' if message else ""
    document = f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title><style>
:root{{--bg:#f5f3ed;--paper:#fffdf8;--ink:#22211f;--muted:#706d66;--line:#ded9cf;--accent:#c4492d;--ok:#276749}}
*{{box-sizing:border-box}} body{{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,"Microsoft YaHei",sans-serif}}
header,main{{width:min(920px,calc(100% - 32px));margin:auto}} header{{padding:42px 0 24px;border-bottom:1px solid var(--line)}}
h1{{font-size:clamp(28px,5vw,48px);line-height:1.1;margin:0 0 8px}} .subtitle,.meta{{color:var(--muted)}}
main{{padding:28px 0 70px}} .grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}}
.card,.panel,.empty{{background:var(--paper);border:1px solid var(--line);border-radius:18px;padding:22px;box-shadow:0 8px 28px #332b1d0a}}
.meta{{display:flex;gap:8px;flex-wrap:wrap;font-size:13px}} .meta span{{border:1px solid var(--line);border-radius:999px;padding:2px 9px}}
.button,button{{display:inline-block;border:0;border-radius:10px;padding:10px 16px;background:var(--ink);color:white;text-decoration:none;font-weight:650;cursor:pointer}}
.danger{{background:var(--accent)}} .ok{{background:var(--ok)}} .secondary{{background:#77736b}} textarea,input{{width:100%;border:1px solid var(--line);border-radius:10px;padding:12px;font:inherit;background:white}}
textarea{{min-height:150px;resize:vertical}} label{{display:block;margin:18px 0 6px;font-weight:650}} .actions{{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}}
.notice{{background:#e9f5ec;color:#22543d;border-radius:10px;padding:12px 16px;margin-bottom:18px}} a.back{{color:var(--muted)}}
code{{word-break:break-all}} @media(max-width:560px){{header{{padding-top:28px}}.actions button{{flex:1}}}}
</style></head><body><header><h1>记忆审核</h1><div class="subtitle">私人、本地、由你确认</div></header><main>{notice}{body}</main></body></html>"""
    return document.encode("utf-8")


class ReviewServer(ThreadingHTTPServer):
    def __init__(self, address, vault: Path, token: str):
        super().__init__(address, ReviewHandler)
        self.vault = vault
        self.token = token


class ReviewHandler(BaseHTTPRequestHandler):
    server: ReviewServer

    def log_message(self, format: str, *args) -> None:
        return

    def allowed_host(self) -> bool:
        host = self.headers.get("Host", "").split(":", 1)[0].lower()
        return host in {"127.0.0.1", "localhost"}

    def send_html(self, content: bytes, status: HTTPStatus = HTTPStatus.OK) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        self.wfile.write(content)

    def redirect(self, message: str) -> None:
        location = "/?message=" + urllib.parse.quote(message)
        self.send_response(HTTPStatus.SEE_OTHER)
        self.send_header("Location", location)
        self.end_headers()

    def do_GET(self) -> None:
        if not self.allowed_host():
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        if parsed.path == "/":
            message = query.get("message", [""])[0]
            body = (
                f'<div class="grid">{candidate_cards(self.server.vault)}</div>'
                f'<form method="post" action="/action" class="actions"><input type="hidden" name="csrf" value="{self.server.token}">'
                '<button name="action" value="shutdown" class="secondary">关闭审核界面</button></form>'
            )
            self.send_html(shell("记忆审核", body, message))
            return
        if parsed.path == "/candidate":
            filename = query.get("file", [""])[0]
            try:
                path = profile_cli.safe_record(self.server.vault, "Inbox", filename)
                metadata, body = profile_cli.read_record(path)
            except SystemExit as exc:
                self.send_html(shell("未找到", f'<section class="panel"><p>{html.escape(str(exc))}</p></section>'), HTTPStatus.NOT_FOUND)
                return
            summary = re.search(r"(?ims)^##\s*摘要\s*\n(.+?)(?=\n##\s|\Z)", body)
            content = summary.group(1).strip() if summary else ""
            fields = "".join(
                f'<span>{html.escape(key)}: {html.escape(value)}</span>'
                for key, value in metadata.items() if key in {"status", "type", "subject", "source_agent", "created", "conflicts_with"}
            )
            form = f"""<a class="back" href="/">← 返回列表</a><section class="panel"><div class="meta">{fields}</div>
<form method="post" action="/action"><input type="hidden" name="csrf" value="{self.server.token}"><input type="hidden" name="file" value="{html.escape(filename)}">
<label for="content">记忆内容</label><textarea id="content" name="content" maxlength="4000">{html.escape(content)}</textarea>
<label for="reason">拒绝原因（可选）</label><input id="reason" name="reason" maxlength="200" placeholder="例如：不是长期信息">
<div class="actions"><button name="action" value="edit" class="secondary">保存修改</button><button name="action" value="confirm" class="ok">确认记忆</button><button name="action" value="reject" class="danger">拒绝</button></div></form></section>"""
            self.send_html(shell("审核候选记忆", form))
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        if not self.allowed_host() or self.path != "/action":
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_error(HTTPStatus.BAD_REQUEST)
            return
        if length <= 0 or length > MAX_BODY:
            self.send_error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
            return
        data = urllib.parse.parse_qs(self.rfile.read(length).decode("utf-8"), keep_blank_values=True)
        if not secrets.compare_digest(data.get("csrf", [""])[0], self.server.token):
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        filename = data.get("file", [""])[0]
        action = data.get("action", [""])[0]
        try:
            if action == "shutdown":
                self.send_html(shell("已关闭", '<section class="empty"><h2>审核界面已关闭</h2><p>现在可以关闭这个浏览器标签页。</p></section>'))
                threading.Thread(target=self.server.shutdown, daemon=True).start()
            elif action == "edit":
                profile_cli.edit_candidate(str(self.server.vault), filename, data.get("content", [""])[0])
                self.redirect("候选记忆已修改")
            elif action == "confirm":
                profile_cli.confirm(str(self.server.vault), filename)
                self.redirect("记忆已确认，其他AI现在可以检索到它")
            elif action == "reject":
                reason = data.get("reason", [""])[0] or "user-rejected-in-review-ui"
                profile_cli.reject(str(self.server.vault), filename, reason)
                self.redirect("候选记忆已拒绝并保留审计记录")
            else:
                self.send_error(HTTPStatus.BAD_REQUEST)
        except SystemExit as exc:
            self.send_html(shell("操作未完成", f'<section class="panel"><p>{html.escape(str(exc))}</p><a href="/">返回</a></section>'), HTTPStatus.CONFLICT)


def create_server(vault: Path, port: int = 0) -> ReviewServer:
    root = vault.expanduser().resolve()
    missing = [name for name in profile_cli.REQUIRED if not (root / name).is_file()]
    if missing:
        raise SystemExit(f"私人档案结构不完整：{', '.join(missing)}")
    return ReviewServer((HOST, port), root, secrets.token_urlsafe(32))


def main() -> None:
    parser = argparse.ArgumentParser(description="打开本地记忆审核界面")
    parser.add_argument("--vault", required=True)
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    server = create_server(Path(args.vault), args.port)
    url = f"http://{HOST}:{server.server_port}/"
    print(f"记忆审核界面：{url}\n按 Ctrl+C 关闭。")
    if not args.no_browser:
        threading.Timer(0.3, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

