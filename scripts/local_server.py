#!/usr/bin/env python3
"""
Local-only server for mustwatch-web.

Serves the site exactly like `python3 -m http.server`, PLUS a small
POST /api/add-post endpoint used by add-post.html to save a new post you
manually paste in from the Telegram group: it writes the post into
data/website-posts.json (or data/website-posts-unnumbered.json) and saves
any uploaded media into media/added/<post_id>/.

Deliberately binds to 127.0.0.1 only (not 0.0.0.0) — it can write files
based on incoming requests, so it must never be reachable from the network,
only from this machine.
"""
import base64
import hmac
import json
import os
import re
import sys
import threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

# Guards read-modify-write of the JSON data files: ThreadingHTTPServer runs
# each request on its own thread, so two saves arriving at the same instant
# could otherwise race and clobber each other.
DATA_LOCK = threading.Lock()

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
URL_RE = re.compile(r"https?://\S+")

# Only the Add Post page/API is gated — browsing the archive itself stays open.
AUTH_EMAIL = "teraboxnoob@gmail.com"
AUTH_PASSWORD = "msuwatch@4666"
AUTH_REALM = "mustwatch-add-post"
# add-post.html itself loads openly now — the page shows its own "log in
# first" gate client-side (assets/js/add-post.js + auth.js). Only the
# session-check and the actual write actions require the Authorization
# header, and since those are all fetch()-initiated (never a real page
# navigation), the browser never shows its native login popup for them.
PROTECTED_GET_PATHS = ("/api/whoami",)
PROTECTED_POST_PATHS = ("/api/add-post", "/api/edit-post", "/api/delete-post")


def extract_links(text):
    if not text:
        return []
    raw = URL_RE.findall(text)
    cleaned, seen = [], set()
    for u in raw:
        u = u.rstrip(").,!?’”")
        if u not in seen:
            seen.add(u)
            cleaned.append(u)
    return cleaned


def media_type(filename):
    ext = os.path.splitext(filename)[1].lower()
    return "video" if ext in (".mp4", ".mov", ".webm", ".mkv") else "image"


def load_json(path, default):
    if not os.path.isfile(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def parse_multipart(body, boundary):
    """Minimal multipart/form-data parser (no 'cgi' module on Python 3.13+).
    Returns (fields: {name: str}, files: [{name, filename, content_type, data}])."""
    fields, files = {}, []
    delimiter = b"--" + boundary
    parts = body.split(delimiter)
    for part in parts:
        part = part.strip(b"\r\n")
        if not part or part == b"--":
            continue
        if b"\r\n\r\n" not in part:
            continue
        header_blob, content = part.split(b"\r\n\r\n", 1)
        content = content[:-2] if content.endswith(b"\r\n") else content  # trailing CRLF before next boundary
        headers = {}
        for line in header_blob.split(b"\r\n"):
            if b":" in line:
                k, v = line.split(b":", 1)
                headers[k.strip().lower()] = v.strip()
        disposition = headers.get(b"content-disposition", b"").decode("utf-8", "replace")
        name_match = re.search(r'name="([^"]*)"', disposition)
        filename_match = re.search(r'filename="([^"]*)"', disposition)
        if not name_match:
            continue
        field_name = name_match.group(1)
        if filename_match and filename_match.group(1):
            content_type = headers.get(b"content-type", b"application/octet-stream").decode("utf-8", "replace")
            files.append({
                "name": field_name,
                "filename": filename_match.group(1),
                "content_type": content_type,
                "data": content,
            })
        else:
            fields[field_name] = content.decode("utf-8", "replace")
    return fields, files


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PROJECT_ROOT, **kwargs)

    def log_message(self, fmt, *args):
        sys.stderr.write(f"[local_server] {fmt % args}\n")

    def end_headers(self):
        # The two data files change every time a post is added/edited/
        # deleted, but nothing here sets explicit caching headers, so
        # browsers can apply their own heuristic freshness lifetime and
        # silently serve a stale copy (no request even reaches the server).
        # Force revalidation on exactly these two files; static assets and
        # media keep normal caching since they don't change post-to-post.
        path = self.path.split("?", 1)[0]
        if (path.startswith("/data/") and path.endswith(".json")) or path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _is_authorized(self):
        header = self.headers.get("Authorization", "")
        if not header.startswith("Basic "):
            return False
        try:
            decoded = base64.b64decode(header[6:]).decode("utf-8")
            email, _, password = decoded.partition(":")
        except Exception:
            return False
        return hmac.compare_digest(email, AUTH_EMAIL) and hmac.compare_digest(password, AUTH_PASSWORD)

    def _require_auth(self):
        # Deliberately a 200 with {"success": false}, not an HTTP 401.
        # This project never relies on the browser's native Basic-Auth
        # popup (login only ever happens through the explicit Access
        # button/form in auth.js) — and a bare 401 status on a
        # fetch()-initiated request was observed to hang indefinitely in
        # Chrome (confirmed against curl and Node's fetch, both of which
        # handle the exact same 401 response instantly, so it's specific
        # to Chrome's own handling of 401, not a malformed response).
        # Encoding "not authorized" in the JSON body instead sidesteps
        # that entirely.
        self._send_json(200, {"success": False, "authenticated": False, "error": "Not authorized."})

    def _is_source_path(self, path):
        # Never serve the server's own source (it holds the login credentials)
        # or any other project script over HTTP.
        return path.startswith("/scripts/") or path.endswith(".py")

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if self._is_source_path(path):
            self.send_error(403, "Forbidden")
            return
        if path in PROTECTED_GET_PATHS:
            if not self._is_authorized():
                self._require_auth()
                return
            if path == "/api/whoami":
                self._send_json(200, {"success": True, "authenticated": True})
                return
        super().do_GET()

    def do_POST(self):
        if self.path not in PROTECTED_POST_PATHS:
            self._send_json(404, {"success": False, "error": "Unknown endpoint"})
            return
        if not self._is_authorized():
            self._require_auth()
            return

        content_type = self.headers.get("Content-Type", "")
        boundary_match = re.search(r'boundary=(.+)', content_type)
        if "multipart/form-data" not in content_type or not boundary_match:
            self._send_json(400, {"success": False, "error": "Expected multipart/form-data"})
            return
        boundary = boundary_match.group(1).strip('"').encode("utf-8")

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        fields, files = parse_multipart(body, boundary)

        try:
            with DATA_LOCK:
                if self.path == "/api/add-post":
                    result = self._handle_add_post(fields, files)
                elif self.path == "/api/edit-post":
                    result = self._handle_edit_post(fields, files)
                else:
                    result = self._handle_delete_post(fields)
            self._send_json(200, {"success": True, **result})
        except ValueError as e:
            self._send_json(400, {"success": False, "error": str(e)})
        except Exception as e:
            self._send_json(500, {"success": False, "error": f"Server error: {e}"})

    def _handle_add_post(self, fields, files):
        is_unnumbered = fields.get("unnumbered") == "true"
        text = fields.get("text", "").strip()
        date = fields.get("date", "").strip()
        overwrite = fields.get("overwrite") == "true"

        if not text:
            raise ValueError("Post text is required.")
        if not date:
            raise ValueError("Date is required.")

        data_dir = os.path.join(PROJECT_ROOT, "data")
        main_path = os.path.join(data_dir, "website-posts.json")
        unnumbered_path = os.path.join(data_dir, "website-posts-unnumbered.json")

        links = extract_links(text)
        media_files = [f for f in files if f["name"] == "media" and f["filename"]]

        if is_unnumbered:
            posts = load_json(unnumbered_path, [])
            existing_ids = {p["post_id"] for p in posts}
            n = 1
            while f"u{n}" in existing_ids:
                n += 1
            post_id = f"u{n}"
            media_dir = os.path.join(PROJECT_ROOT, "media", "added", post_id)
        else:
            post_id_raw = fields.get("post_id", "").strip()
            if not post_id_raw.isdigit():
                raise ValueError("Post number must be a positive integer.")
            post_id = int(post_id_raw)

            posts = load_json(main_path, [])
            existing_index = next((i for i, p in enumerate(posts) if p["post_id"] == post_id), None)
            if existing_index is not None and not overwrite:
                raise ValueError(f"POST {post_id} already exists. Check 'overwrite' to replace it.")
            media_dir = os.path.join(PROJECT_ROOT, "media", "added", str(post_id))

        os.makedirs(media_dir, exist_ok=True)
        media_entries = []
        for f in media_files:
            safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", f["filename"])
            dest = os.path.join(media_dir, safe_name)
            with open(dest, "wb") as out:
                out.write(f["data"])
            rel_path = os.path.relpath(dest, PROJECT_ROOT).replace(os.sep, "/")
            media_entries.append({"path": rel_path, "type": media_type(safe_name)})

        post = {
            "post_id": post_id,
            "date": date,
            "text": text,
            "media": media_entries,
            "links": links,
        }

        if is_unnumbered:
            posts.append(post)
            save_json(unnumbered_path, posts)
        else:
            if existing_index is not None:
                posts[existing_index] = post
            else:
                posts.append(post)
            posts.sort(key=lambda p: p["post_id"])
            save_json(main_path, posts)

        return {"post_id": post_id, "media_saved": len(media_entries), "links_found": len(links)}

    def _resolve_target(self, fields):
        """Returns (posts_list, path_to_save, index_of_post, is_unnumbered)."""
        is_unnumbered = fields.get("unnumbered") == "true"
        data_dir = os.path.join(PROJECT_ROOT, "data")
        if is_unnumbered:
            path = os.path.join(data_dir, "website-posts-unnumbered.json")
            post_id = fields.get("post_id", "").strip()
        else:
            path = os.path.join(data_dir, "website-posts.json")
            post_id_raw = fields.get("post_id", "").strip()
            if not post_id_raw.isdigit():
                raise ValueError("Post number must be a positive integer.")
            post_id = int(post_id_raw)

        posts = load_json(path, [])
        index = next((i for i, p in enumerate(posts) if p["post_id"] == post_id), None)
        if index is None:
            raise ValueError(f"POST {post_id} was not found.")
        return posts, path, index, is_unnumbered, post_id

    def _handle_edit_post(self, fields, files):
        posts, path, index, is_unnumbered, post_id = self._resolve_target(fields)
        text = fields.get("text", "").strip()
        date = fields.get("date", "").strip()
        if not text:
            raise ValueError("Post text is required.")
        if not date:
            raise ValueError("Date is required.")

        existing_media = posts[index].get("media", [])
        remove_paths = set()
        remove_raw = fields.get("remove_media", "").strip()
        if remove_raw:
            try:
                remove_paths = set(json.loads(remove_raw))
            except Exception:
                pass
        kept_media = [m for m in existing_media if m["path"] not in remove_paths]

        # Actually delete files we removed, but only ones we own (media/added/);
        # original archive media is never touched even if unlinked from a post.
        added_prefix = "media/added/"
        for m in existing_media:
            if m["path"] in remove_paths and m["path"].startswith(added_prefix):
                abs_path = os.path.join(PROJECT_ROOT, m["path"])
                if os.path.isfile(abs_path):
                    os.remove(abs_path)

        media_dir = os.path.join(PROJECT_ROOT, "media", "added", str(post_id))
        new_files = [f for f in files if f["name"] == "media" and f["filename"]]
        if new_files:
            os.makedirs(media_dir, exist_ok=True)
        for f in new_files:
            safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", f["filename"])
            dest = os.path.join(media_dir, safe_name)
            with open(dest, "wb") as out:
                out.write(f["data"])
            rel_path = os.path.relpath(dest, PROJECT_ROOT).replace(os.sep, "/")
            kept_media.append({"path": rel_path, "type": media_type(safe_name)})

        links = extract_links(text)
        posts[index] = {"post_id": post_id, "date": date, "text": text, "media": kept_media, "links": links}
        save_json(path, posts)
        return {"post_id": post_id, "media_count": len(kept_media), "links_found": len(links)}

    def _handle_delete_post(self, fields):
        posts, path, index, is_unnumbered, post_id = self._resolve_target(fields)
        removed = posts.pop(index)
        save_json(path, posts)

        added_prefix = "media/added/"
        for m in removed.get("media", []):
            if m["path"].startswith(added_prefix):
                abs_path = os.path.join(PROJECT_ROOT, m["path"])
                if os.path.isfile(abs_path):
                    os.remove(abs_path)
        post_media_dir = os.path.join(PROJECT_ROOT, "media", "added", str(post_id))
        if os.path.isdir(post_media_dir) and not os.listdir(post_media_dir):
            os.rmdir(post_media_dir)

        return {"post_id": post_id}


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"mustwatch-web local server (static + add-post API)")
    print(f"  http://127.0.0.1:{PORT}/            — the site (open, no login)")
    print(f"  http://127.0.0.1:{PORT}/add-post.html — add a new post (login required)")
    print(f"  bound to 127.0.0.1 only (not reachable from your network)")
    server.serve_forever()


if __name__ == "__main__":
    main()
