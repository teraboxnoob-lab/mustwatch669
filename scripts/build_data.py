#!/usr/bin/env python3
"""
Builds the normalized website data + copies referenced media for mustwatch-web.

Reads (read-only, never modified):
  <SOURCE_ROOT>/posts-1-1788.json
  <SOURCE_ROOT>/posts-unnumbered.json
  <SOURCE_ROOT>/telegram-media-complete/
  <SOURCE_ROOT>/telegram-media-discord-checking/

Writes:
  data/website-posts.json             (main numbered archive, POST 1 -> POST 1788, missing skipped)
  data/website-posts-unnumbered.json  (unnumbered posts, separate section)
  media/telegram-media-complete/...          (copied, only files actually referenced)
  media/telegram-media-discord-checking/...  (copied, only files actually referenced)
"""
import json
import os
import re
import shutil
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
SOURCE_ROOT = os.path.expanduser("~/telegram-discord-bridge")

URL_RE = re.compile(r"https?://\S+")


def extract_links(text):
    if not text:
        return []
    raw = URL_RE.findall(text)
    cleaned = []
    seen = set()
    for u in raw:
        u = u.rstrip(").,!?’”")
        if u not in seen:
            seen.add(u)
            cleaned.append(u)
    return cleaned


def media_type(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in (".mp4", ".mov", ".webm", ".mkv"):
        return "video"
    return "image"


def normalize_media(raw_paths, missing_report, copied_set):
    """Resolve source-relative media paths, skip ones that don't exist on disk,
    copy them into the project's media/ dir, and return normalized entries."""
    out = []
    for rel in raw_paths or []:
        src_path = os.path.join(SOURCE_ROOT, rel)
        if not os.path.isfile(src_path):
            missing_report.append(rel)
            continue
        dest_path = os.path.join(PROJECT_ROOT, "media", rel)
        if rel not in copied_set:
            os.makedirs(os.path.dirname(dest_path), exist_ok=True)
            shutil.copy2(src_path, dest_path)
            copied_set.add(rel)
        out.append({"path": f"media/{rel}", "type": media_type(rel)})
    return out


def build_main_archive(copied_set, missing_report):
    src_file = os.path.join(SOURCE_ROOT, "posts-1-1788.json")
    with open(src_file, encoding="utf-8") as f:
        records = json.load(f)

    posts = []
    for rec in records:
        raw_media = rec.get("media") or rec.get("media_files") or []
        media = normalize_media(raw_media, missing_report, copied_set)
        text = rec.get("text") or ""
        posts.append({
            "post_id": rec["post_id"],
            "date": rec.get("date"),
            "text": text,
            "media": media,
            "links": extract_links(text),
        })

    posts.sort(key=lambda p: p["post_id"])
    return posts


def build_unnumbered(copied_set, missing_report):
    src_file = os.path.join(SOURCE_ROOT, "posts-unnumbered.json")
    with open(src_file, encoding="utf-8") as f:
        records = json.load(f)

    posts = []
    for i, rec in enumerate(records):
        data = rec.get("data", {})
        raw_media = data.get("media") or data.get("media_files") or []
        media = normalize_media(raw_media, missing_report, copied_set)
        text = data.get("text") or ""
        message_ids = data.get("message_ids") or []
        uid = f"u{i+1}"
        posts.append({
            "post_id": uid,
            "source_file": rec.get("source_file"),
            "message_ids": message_ids,
            "date": data.get("date"),
            "text": text,
            "media": media,
            "links": extract_links(text),
        })
    return posts


def main():
    if not os.path.isdir(SOURCE_ROOT):
        sys.exit(f"Source project not found at {SOURCE_ROOT}")

    copied_set = set()
    missing_report = []

    main_posts = build_main_archive(copied_set, missing_report)
    unnumbered_posts = build_unnumbered(copied_set, missing_report)

    data_dir = os.path.join(PROJECT_ROOT, "data")
    os.makedirs(data_dir, exist_ok=True)

    with open(os.path.join(data_dir, "website-posts.json"), "w", encoding="utf-8") as f:
        json.dump(main_posts, f, ensure_ascii=False, separators=(",", ":"))

    with open(os.path.join(data_dir, "website-posts-unnumbered.json"), "w", encoding="utf-8") as f:
        json.dump(unnumbered_posts, f, ensure_ascii=False, separators=(",", ":"))

    all_ids = [p["post_id"] for p in main_posts]
    missing_numbers = sorted(set(range(1, 1789)) - set(all_ids))

    print(f"Main archive: {len(main_posts)} posts (range 1-1788)")
    print(f"Missing post numbers: {len(missing_numbers)}")
    print(f"Unnumbered posts: {len(unnumbered_posts)}")
    print(f"Media files copied: {len(copied_set)}")
    if missing_report:
        print(f"Referenced media files not found on disk (skipped): {len(missing_report)}")
        for m in missing_report[:20]:
            print(f"  - {m}")

    meta = {
        "total_posts": len(main_posts),
        "post_range": [1, 1788],
        "missing_post_numbers": missing_numbers,
        "unnumbered_count": len(unnumbered_posts),
        "media_files_copied": len(copied_set),
        "media_files_missing": len(missing_report),
    }
    with open(os.path.join(data_dir, "build-meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
