#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
博客后台服务
------------
零依赖 Python 3 标准库实现。所有内容通过 GitHub Contents API 直接提交到仓库，
沿用现有的 GitHub Actions -> deploy 分支 -> 服务器 cron 发布链路。

环境变量:
  ADMIN_PASSWORD   登录密钥（必填）
  BLOG_REPO        owner/repo，默认 a1679423201-droid/blog
  BLOG_BRANCH      默认 main
  GITHUB_TOKEN     可选，也可以在后台里粘贴
  ADMIN_PORT       默认 8080
  ADMIN_MOCK       设为 1 时使用本地 data/mock 目录，便于本地调试
"""

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
STATIC = os.path.join(ROOT, "static")
MOCK_DIR = os.path.join(DATA, "mock")

REPO = os.environ.get("BLOG_REPO", "a1679423201-droid/blog")
BRANCH = os.environ.get("BLOG_BRANCH", "main")
PORT = int(os.environ.get("ADMIN_PORT", "8080"))
MOCK = os.environ.get("ADMIN_MOCK") == "1"
SITE_URL = os.environ.get("BLOG_SITE_URL", "").rstrip("/")
POSTS_DIR = "src/content/posts"
IMAGES_DIR = "public/images"
SETTINGS_PATH = "src/site-settings.json"

MAX_BODY = 8 * 1024 * 1024          # 8MB
SESSION_TTL = 7 * 24 * 3600
MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
}


# --------------------------------------------------------------------------
# 小工具
# --------------------------------------------------------------------------

def ensure_data():
    os.makedirs(DATA, exist_ok=True)
    if MOCK:
        os.makedirs(os.path.join(MOCK_DIR, POSTS_DIR), exist_ok=True)
        os.makedirs(os.path.join(MOCK_DIR, IMAGES_DIR), exist_ok=True)


def read_file(path, default=""):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except OSError:
        return default


def write_file(path, text, mode=0o600):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)


def secret_key():
    path = os.path.join(DATA, "secret")
    key = read_file(path).strip()
    if not key:
        key = secrets.token_hex(32)
        os.makedirs(DATA, exist_ok=True)
        write_file(path, key)
    return key.encode()


PASSWORD = os.environ.get("ADMIN_PASSWORD", "")


def token_path():
    return os.path.join(DATA, "github_token")


def get_token():
    env = os.environ.get("GITHUB_TOKEN", "").strip()
    if env:
        return env
    return read_file(token_path()).strip()


_WRITE_PROBE = {"at": 0.0, "ok": None}


def token_can_write():
    """当前令牌能否真的写仓库。fine-grained 令牌只勾 Administration 时
    permissions.push 也是 true，必须实际写一次才看得出来。结果缓存 10 分钟。"""
    if MOCK:
        return True
    token = get_token()
    if not token:
        return False
    now = time.time()
    if _WRITE_PROBE["ok"] is not None and now - _WRITE_PROBE["at"] < 600:
        return _WRITE_PROBE["ok"]
    try:
        gh_request("POST", "/repos/%s/git/blobs" % REPO,
                   {"content": "blog-admin probe", "encoding": "utf-8"}, token=token)
        ok = True
    except GitHubError as e:
        # 网络问题不当作没权限
        ok = e.status not in (401, 403, 404)
    _WRITE_PROBE.update(at=now, ok=ok)
    return ok


# --------------------------------------------------------------------------
# GitHub 客户端 / mock 客户端
# --------------------------------------------------------------------------

class GitHubError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def gh_request(method, path, body=None, token=None):
    url = "https://api.github.com" + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "blog-admin/1.0")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            raw = r.read().decode() or "{}"
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            msg = json.loads(raw).get("message", raw)
        except Exception:
            msg = raw
        if e.code == 403 and "Resource not accessible" in msg:
            msg = ("令牌没有这个仓库的写入权限。去 GitHub 的令牌设置里把 "
                   "Contents 改成 Read and write（Administration、Metadata 都不管用）")
        elif e.code == 403 and "rate limit" in msg.lower():
            msg = "GitHub 限流了，等几分钟再试"
        raise GitHubError(e.code, msg)
    except urllib.error.URLError as e:
        raise GitHubError(0, "无法连接 GitHub：%s" % e.reason)


def gh(method, path, body=None):
    token = get_token()
    if not token and not MOCK and method != "GET":
        raise GitHubError(401, "还没有配置 GitHub 令牌")
    try:
        return gh_request(method, path, body, token)
    except GitHubError as e:
        if not token and e.status == 404:
            raise GitHubError(401, "读不到仓库内容，如果是私有仓库请先在设置里填 GitHub 令牌")
        raise


def gh_get_file(path):
    """返回 (text, sha)"""
    if MOCK:
        full = os.path.join(MOCK_DIR, path)
        if not os.path.exists(full):
            raise GitHubError(404, "文件不存在")
        return read_file(full), "mock-sha-" + hashlib.sha1(path.encode()).hexdigest()[:10]
    r = gh("GET", "/repos/%s/contents/%s?ref=%s" % (REPO, urllib.parse.quote(path), BRANCH))
    text = base64.b64decode(r["content"]).decode("utf-8")
    return text, r["sha"]


def gh_list_files(path):
    if MOCK:
        full = os.path.join(MOCK_DIR, path)
        if not os.path.isdir(full):
            return []
        out = []
        for name in sorted(os.listdir(full)):
            out.append({
                "name": name,
                "path": path + "/" + name,
                "sha": "mock-sha-" + hashlib.sha1((path + "/" + name).encode()).hexdigest()[:10],
            })
        return out
    r = gh("GET", "/repos/%s/contents/%s?ref=%s" % (REPO, urllib.parse.quote(path), BRANCH))
    if not isinstance(r, list):
        raise GitHubError(500, "路径不是一个目录")
    return r


def gh_put_file(path, text, sha=None, message=None, encoding="utf-8"):
    if MOCK:
        full = os.path.join(MOCK_DIR, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        if encoding == "base64":
            with open(full, "wb") as f:
                f.write(base64.b64decode(text))
        else:
            write_file(full, text, mode=0o644)
        return {"content": {"path": path}}
    body = {
        "message": message or ("更新 " + os.path.basename(path)),
        "content": text if encoding == "base64" else base64.b64encode(text.encode()).decode(),
        "branch": BRANCH,
    }
    if encoding != "base64":
        body["encoding"] = "utf-8"
    if sha:
        body["sha"] = sha
    return gh("PUT", "/repos/%s/contents/%s" % (REPO, urllib.parse.quote(path)), body)


def gh_delete_file(path, sha, message=None):
    if MOCK:
        full = os.path.join(MOCK_DIR, path)
        if os.path.exists(full):
            os.remove(full)
        return {"ok": True}
    body = {"message": message or ("删除 " + os.path.basename(path)), "sha": sha, "branch": BRANCH}
    return gh("DELETE", "/repos/%s/contents/%s" % (REPO, urllib.parse.quote(path)), body)


# --------------------------------------------------------------------------
# frontmatter 解析 / 序列化
# --------------------------------------------------------------------------

FIELD_ORDER = ["title", "published", "updated", "description", "image",
               "tags", "category", "draft", "lang"]


def parse_scalar(raw):
    raw = raw.strip()
    if raw == "" :
        return ""
    if raw in ("true", "True"):
        return True
    if raw in ("false", "False"):
        return False
    if raw in ("null", "~"):
        return None
    if raw.startswith("[") and raw.endswith("]"):
        try:
            return json.loads(raw)
        except Exception:
            inner = raw[1:-1].strip()
            if not inner:
                return []
            return [x.strip().strip('"').strip("'") for x in inner.split(",") if x.strip()]
    if (raw.startswith('"') and raw.endswith('"')) or (raw.startswith("'") and raw.endswith("'")):
        if raw[0] == '"':
            try:
                return json.loads(raw)
            except Exception:
                return raw[1:-1]
        return raw[1:-1].replace("''", "'")
    return raw


def split_frontmatter(text):
    m = re.match(r"^---[ \t]*\r?\n(.*?)\r?\n---[ \t]*\r?\n?(.*)$", text, re.S)
    if not m:
        return {}, text
    fm = {}
    key = None
    for line in m.group(1).splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if re.match(r"^\s{2,}-\s+", line) and key:
            fm.setdefault(key, [])
            if not isinstance(fm[key], list):
                fm[key] = [fm[key]] if fm[key] not in ("", None) else []
            fm[key].append(parse_scalar(line.strip()[1:].strip()))
            continue
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        key = k.strip()
        val = v.strip()
        if val == "":
            fm[key] = []
        else:
            fm[key] = parse_scalar(val)
    return fm, m.group(2)


def dump_frontmatter(fm):
    lines = ["---"]
    for k in FIELD_ORDER:
        if k not in fm:
            continue
        v = fm[k]
        if k == "tags":
            if not v:
                continue
            lines.append("tags: " + json.dumps(list(v), ensure_ascii=False))
            continue
        if k == "draft":
            lines.append("draft: " + ("true" if v else "false"))
            continue
        if v is None or v == "":
            continue
        if k in ("published", "updated"):
            lines.append("%s: %s" % (k, str(v)))
        else:
            lines.append("%s: %s" % (k, json.dumps(str(v), ensure_ascii=False)))
    lines.append("---")
    return "\n".join(lines)


def normalize_slug(slug):
    """只保留 a-z0-9-，中文标题没法直接做网址"""
    s = (slug or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s[:60].strip("-")


def file_exists(path):
    if MOCK:
        return os.path.exists(os.path.join(MOCK_DIR, path))
    try:
        gh("GET", "/repos/%s/contents/%s?ref=%s" % (REPO, urllib.parse.quote(path), BRANCH))
        return True
    except GitHubError as e:
        if e.status == 404:
            return False
        raise


def post_filename(fm, slug):
    date = str(fm.get("published") or "")[:10]
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
        date = time.strftime("%Y-%m-%d")
    base = "%s-%s" % (date, normalize_slug(slug) or ("post-" + secrets.token_hex(3)))
    name = base + ".md"
    for i in range(2, 50):
        if not file_exists(POSTS_DIR + "/" + name):
            return name
        name = "%s-%d.md" % (base, i)
    return "%s-%s.md" % (base, secrets.token_hex(2))


# --------------------------------------------------------------------------
# 会话
# --------------------------------------------------------------------------

def sign_session(exp):
    msg = ("%d" % exp).encode()
    sig = hmac.new(secret_key(), msg, hashlib.sha256).hexdigest()
    return "v1.%d.%s" % (exp, sig)


def verify_session(cookie):
    if not cookie:
        return False
    parts = cookie.split(".")
    if len(parts) != 3 or parts[0] != "v1":
        return False
    try:
        exp = int(parts[1])
    except ValueError:
        return False
    if exp < time.time():
        return False
    expected = hmac.new(secret_key(), parts[1].encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts[2])


LOGIN_FAILS = {}
LOGIN_LOCK = threading.Lock()


def login_allowed(ip):
    now = time.time()
    with LOGIN_LOCK:
        bucket = [t for t in LOGIN_FAILS.get(ip, []) if now - t < 600]
        LOGIN_FAILS[ip] = bucket
        return len(bucket) < 10


def record_fail(ip):
    with LOGIN_LOCK:
        LOGIN_FAILS.setdefault(ip, []).append(time.time())


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server_version = "BlogAdmin/1.0"
    protocol_version = "HTTP/1.1"

    # ---------- 基础 ----------
    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def send_json(self, obj, status=200, headers=None):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def error(self, msg, status=400):
        self.send_json({"error": msg}, status)

    def body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ValueError("请求太大")
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8") or "{}")

    def cookie(self, name):
        raw = self.headers.get("Cookie") or ""
        for part in raw.split(";"):
            if "=" in part:
                k, v = part.strip().split("=", 1)
                if k == name:
                    return v
        return None

    def authed(self):
        return verify_session(self.cookie("admin_session"))

    def require_auth(self):
        if not self.authed():
            self.error("未登录", 401)
            return False
        if self.command in ("POST", "PUT", "DELETE"):
            if self.headers.get("X-Requested-With") != "blog-admin":
                self.error("非法请求来源", 403)
                return False
        return True

    # ---------- 路由 ----------
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        try:
            if path.startswith("/api/"):
                return self.api_get(path)
            return self.serve_static(path)
        except GitHubError as e:
            self.error(e.message, e.status or 502)
        except Exception as e:  # noqa: BLE001
            self.error("服务器错误：%s" % e, 500)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        try:
            return self.api_post(path)
        except GitHubError as e:
            self.error(e.message, e.status or 502)
        except Exception as e:  # noqa: BLE001
            self.error("服务器错误：%s" % e, 500)

    def do_PUT(self):
        path = urllib.parse.urlparse(self.path).path
        try:
            return self.api_put(path)
        except GitHubError as e:
            self.error(e.message, e.status or 502)
        except Exception as e:  # noqa: BLE001
            self.error("服务器错误：%s" % e, 500)

    def do_DELETE(self):
        path = urllib.parse.urlparse(self.path).path
        try:
            return self.api_delete(path)
        except GitHubError as e:
            self.error(e.message, e.status or 502)
        except Exception as e:  # noqa: BLE001
            self.error("服务器错误：%s" % e, 500)

    # ---------- 静态 ----------
    def serve_static(self, path):
        if path in ("/", "/index.html"):
            rel = "index.html"
        elif path.startswith("/static/"):
            rel = path[len("/static/"):]
        else:
            return self.error("页面不存在", 404)
        full = os.path.normpath(os.path.join(STATIC, rel))
        if not full.startswith(STATIC) or not os.path.isfile(full):
            return self.error("页面不存在", 404)
        ext = os.path.splitext(full)[1].lower()
        with open(full, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if ext in (".html", ".js", ".css"):
            self.send_header("Cache-Control", "no-cache, must-revalidate")
        else:
            self.send_header("Cache-Control", "public, max-age=300")
        self.end_headers()
        self.wfile.write(data)

    # ---------- API: GET ----------
    def api_get(self, path):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        if path == "/api/me":
            return self.send_json({
                "authed": self.authed(),
                "token_set": bool(get_token()) or MOCK,
                "token_write": token_can_write() if self.authed() else False,
                "repo": REPO,
                "branch": BRANCH,
                "mock": MOCK,
                "site": SITE_URL,
            })
        if path == "/api/posts":
            if not self.require_auth():
                return
            return self.send_json({"posts": self.list_posts()})
        if path == "/api/post":
            if not self.require_auth():
                return
            name = (q.get("name") or [""])[0]
            return self.send_json(self.load_post(name))
        if path == "/api/settings":
            if not self.require_auth():
                return
            text, sha = gh_get_file(SETTINGS_PATH)
            try:
                data = json.loads(text)
            except Exception:
                data = {}
            return self.send_json({"settings": data, "sha": sha})
        if path == "/api/deploy":
            if not self.require_auth():
                return
            return self.send_json(self.deploy_info())
        return self.error("接口不存在", 404)

    # ---------- API: POST ----------
    def api_post(self, path):
        if path == "/api/login":
            return self.login()
        if path == "/api/logout":
            return self.send_json({"ok": True}, headers={
                "Set-Cookie": "admin_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"})
        if path == "/api/token":
            if not self.require_auth():
                return
            return self.save_token()
        if not self.require_auth():
            return
        if path == "/api/post":
            return self.create_post()
        if path == "/api/upload":
            return self.upload()
        return self.error("接口不存在", 404)

    # ---------- API: PUT ----------
    def api_put(self, path):
        if not self.require_auth():
            return
        if path == "/api/post":
            return self.update_post()
        if path == "/api/settings":
            return self.save_settings()
        return self.error("接口不存在", 404)

    # ---------- API: DELETE ----------
    def api_delete(self, path):
        if not self.require_auth():
            return
        if path == "/api/post":
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            name = (q.get("name") or [""])[0]
            if not name:
                return self.error("缺少文件名")
            _, sha = gh_get_file(POSTS_DIR + "/" + name)
            gh_delete_file(POSTS_DIR + "/" + name, sha, "删除文章：" + name)
            return self.send_json({"ok": True})
        return self.error("接口不存在", 404)

    # ---------- 具体处理 ----------
    def login(self):
        ip = self.client_address[0]
        if not login_allowed(ip):
            return self.error("尝试次数过多，请 10 分钟后再试", 429)
        data = self.body()
        pwd = str(data.get("password") or "")
        if not PASSWORD:
            return self.error("服务端未设置 ADMIN_PASSWORD", 500)
        if not hmac.compare_digest(pwd, PASSWORD):
            record_fail(ip)
            return self.error("密钥错误", 401)
        exp = int(time.time()) + SESSION_TTL
        cookie = "admin_session=%s; Path=/; Max-Age=%d; HttpOnly; SameSite=Lax" % (
            sign_session(exp), SESSION_TTL)
        return self.send_json({"ok": True}, headers={"Set-Cookie": cookie})

    def save_token(self):
        data = self.body()
        token = str(data.get("token") or "").strip()
        if not token:
            return self.error("令牌为空")
        try:
            info = gh_request("GET", "/repos/" + REPO, token=token)
        except GitHubError as e:
            return self.error("令牌无效：%s" % e.message, 400)
        if not (info.get("permissions") or {}).get("push"):
            return self.error("该令牌没有这个仓库的写入权限", 400)
        # permissions 里 push 为 true 也可能只是 Administration 权限，真正的写入要看 Contents，
        # 用一个不落库的 blob 探一下（不产生提交、不引用任何文件）
        try:
            gh_request("POST", "/repos/%s/git/blobs" % REPO,
                       {"content": "blog-admin probe", "encoding": "utf-8"}, token=token)
        except GitHubError as e:
            if e.status == 403:
                return self.error("这个令牌还不能写文章：%s" % e.message, 400)
            if e.status == 404:
                return self.error("这个令牌没有勾选这个仓库，或者 Contents 没给写权限", 400)
            raise
        write_file(token_path(), token)
        return self.send_json({"ok": True, "repo": info.get("full_name")})

    def list_posts(self):
        files = [f for f in gh_list_files(POSTS_DIR)
                 if f["name"].endswith(".md") and f.get("type", "file") == "file"]
        posts = []
        for f in files:
            try:
                text, sha = gh_get_file(f["path"])
            except GitHubError:
                continue
            fm, _ = split_frontmatter(text)
            posts.append({
                "name": f["name"],
                "sha": sha,
                "title": str(fm.get("title") or f["name"]),
                "description": str(fm.get("description") or ""),
                "published": str(fm.get("published") or ""),
                "category": str(fm.get("category") or ""),
                "tags": fm.get("tags") if isinstance(fm.get("tags"), list) else [],
                "draft": bool(fm.get("draft")),
                "image": str(fm.get("image") or ""),
            })
        posts.sort(key=lambda p: (p["published"], p["title"]), reverse=True)
        return posts

    def load_post(self, name):
        if not name:
            raise GitHubError(400, "缺少文件名")
        text, sha = gh_get_file(POSTS_DIR + "/" + name)
        fm, body = split_frontmatter(text)
        fm.setdefault("tags", [])
        return {"name": name, "sha": sha, "frontmatter": fm, "body": body.lstrip("\n")}

    def create_post(self):
        data = self.body()
        fm = data.get("frontmatter") or {}
        body = data.get("body") or ""
        name = post_filename(fm, data.get("slug"))
        path = POSTS_DIR + "/" + name
        text = dump_frontmatter(fm) + "\n\n" + body.strip() + "\n"
        gh_put_file(path, text, None, "新建文章：%s" % (fm.get("title") or name))
        return self.send_json({"ok": True, "name": name})

    def update_post(self):
        data = self.body()
        name = str(data.get("name") or "")
        if not name:
            return self.error("缺少文件名")
        fm = data.get("frontmatter") or {}
        body = data.get("body") or ""
        path = POSTS_DIR + "/" + name
        sha = data.get("sha")
        if not sha:
            _, sha = gh_get_file(path)
        text = dump_frontmatter(fm) + "\n\n" + body.strip() + "\n"
        gh_put_file(path, text, sha, "更新文章：%s" % (fm.get("title") or name))
        _, new_sha = gh_get_file(path)
        return self.send_json({"ok": True, "name": name, "sha": new_sha})

    def upload(self):
        data = self.body()
        raw = str(data.get("data") or "")
        filename = str(data.get("filename") or "").strip()
        if "," in raw and raw.startswith("data:"):
            raw = raw.split(",", 1)[1]
        if not raw or not filename:
            return self.error("缺少文件内容")
        ext = os.path.splitext(filename)[1].lower()
        if ext not in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"):
            return self.error("只支持图片格式")
        stem = re.sub(r"[^a-zA-Z0-9_-]+", "-", os.path.splitext(filename)[0]).strip("-").lower()
        if not stem or stem == "image":
            stem = "img"
        safe = "%s-%s%s" % (stem[:40], time.strftime("%Y%m%d-%H%M%S"), ext)
        path = IMAGES_DIR + "/" + safe
        gh_put_file(path, raw, None, "上传图片：" + safe, encoding="base64")
        return self.send_json({"ok": True, "url": "/images/" + safe})

    def save_settings(self):
        data = self.body()
        settings = data.get("settings") or {}
        text, sha = gh_get_file(SETTINGS_PATH)
        new = json.dumps(settings, ensure_ascii=False, indent=2) + "\n"
        gh_put_file(SETTINGS_PATH, new, sha, "更新站点设置")
        return self.send_json({"ok": True})

    def deploy_info(self):
        if MOCK:
            return {"deploy": "", "time": ""}
        try:
            r = gh("GET", "/repos/%s/commits/%s" % (REPO, BRANCH))
            commit = r.get("commit", {})
            return {
                "commit": r.get("sha", "")[:7],
                "time": commit.get("committer", {}).get("date", ""),
                "message": commit.get("message", "").splitlines()[0] if commit.get("message") else "",
            }
        except GitHubError:
            return {"commit": "", "time": "", "message": ""}


def main():
    ensure_data()
    if not PASSWORD:
        sys.stderr.write("[warn] 未设置 ADMIN_PASSWORD，登录会失败\n")
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    srv.daemon_threads = True
    sys.stderr.write("blog-admin listening on 0.0.0.0:%d (mock=%s, repo=%s)\n" % (PORT, MOCK, REPO))
    srv.serve_forever()


if __name__ == "__main__":
    main()
