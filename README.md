# MustWatch Archive

A static, generated web archive of the existing Telegram/Discord post collection
from `~/telegram-discord-bridge`. This is a **standalone project** — it does not
depend on the bridge project at runtime, only its build script reads from it.

No login, no accounts, no database, no backend. Just static HTML/CSS/JS + a
generated JSON data file + copied media files.

## What's in here

```
mustwatch-web/
  index.html              Home page: stats, search, feed, fast-scroller
  post.html                Post detail page (POST NO. view, gallery, prev/next)
  add-post.html            Manual "add a new post" form (needs local_server.py, see below)
  assets/css/style.css     Dark, mobile-first styling
  assets/js/data.js        Shared data loader (fetches the JSON below)
  assets/js/home.js        Home page logic: search + feed + scroller
  assets/js/post.js        Post detail logic: gallery, link button, prev/next
  assets/js/add-post.js    Add-post form logic
  data/website-posts.json             Normalized POST 1 -> POST 1788 archive (missing numbers skipped)
  data/website-posts-unnumbered.json  Normalized posts from posts-unnumbered.json (separate section)
  data/build-meta.json                Build stats (counts, missing post numbers, etc.)
  media/telegram-media-complete/...          Copied media (only files actually referenced by a post)
  media/telegram-media-discord-checking/...
  media/added/<post_id>/...           Media uploaded through add-post.html
  scripts/build_data.py    (Re)generates the initial archive from the source project
  scripts/local_server.py  Static file server + the add-post API endpoint
```

Total: 1659 numbered posts (of the 1-1788 range; 129 numbers are missing and
simply don't appear — no placeholders), plus 32 unnumbered posts shown in a
separate "Unnumbered Posts" section on the home page. These totals grow as
you add posts through add-post.html.

## Running locally

From this directory, run the local server (serves the site AND powers the
Add Post form):

```bash
python3 scripts/local_server.py
```

Then open http://127.0.0.1:8000/ in your browser. It binds to 127.0.0.1 only
— it's never reachable from your network, just this machine — because unlike
a plain static server it can write files (new posts/media) based on requests.

If you only want to browse (no Add Post), plain `python3 -m http.server 8000`
still works fine too — it just can't save new posts.

## Adding new posts manually

This is a deliberately manual, one-post-at-a-time step — nothing scrapes
Telegram automatically and nothing auto-publishes anywhere. When a new post
appears in the group:

1. Open http://127.0.0.1:8000/add-post.html (server must be running, see above)
2. Paste the post number, date, and caption text — links (`LINK - https://...`)
   are extracted automatically, shown live as you type
3. Attach the image/video file(s) from your computer
4. Click **Save Post** — it's written straight into `data/website-posts.json`
   and the media is copied into `media/added/<post_id>/`
5. Refresh the home page — the new post is just there, in chronological order

Posting the same number twice is rejected unless you check "Overwrite if this
post number already exists". Everything stays on your machine; there is no
git, push, or publish step anywhere in this flow.

## Regenerating the data

If the source archive at `~/telegram-discord-bridge` changes (new posts added,
media re-downloaded, etc.), re-run the build script from this directory:

```bash
python3 scripts/build_data.py
```

This is idempotent and safe to re-run — it never modifies the source files
(`posts-1-1788.json`, `posts-unnumbered.json`, or the source media folders),
it only reads from them. It re-writes the `data/*.json` files here and copies
any newly-referenced media into `media/` (already-copied files are skipped).

Only media files that are actually referenced by a post get copied — not the
entire source media directories — to avoid duplicating unused files.

## Notes on data handling

- Older records use a `media` field; newer records use `media_files`. The
  build script normalizes both into a single `media: [{path, type}]` array
  per post, where `type` is `"image"` or `"video"` based on file extension.
- External links (e.g. `LINK - https://...`) are extracted from the post text
  with a regex into a `links` array; the post page renders these as
  "▶ Watch / Open Link" buttons.
- A handful of referenced media files don't exist on disk (e.g. POST 392 is
  missing one of its three images). These are silently skipped rather than
  shown as broken images — see `data/build-meta.json` for the exact count.
- Posts are sorted by `post_id`; Previous/Next navigation on the post page
  walks the sorted list of posts that actually exist, so it correctly skips
  over missing post numbers instead of guessing `id ± 1`.

## Performance

- The home page lazy-loads thumbnails via `IntersectionObserver` and only
  renders posts in batches of 30 as you scroll (infinite scroll), so it never
  loads all 1659+ images/preview thumbnails up front.
- Videos are never autoplayed. On the post page, `<video>` uses
  `preload="metadata"` (shows a first-frame-ish preview without downloading
  the whole file) and native controls; playback is manual.
- Search runs entirely client-side against the already-loaded JSON (no
  network round-trip per keystroke) and matches on post number or text.

## Security

- No secrets are referenced anywhere in this project. `.env`, session files,
  Telegram API credentials, and Discord webhooks from the source project were
  never copied here and are not read by any client-side code.
- Nothing here talks to a network service other than serving the static files
  you're already hosting.

## Deploying to static hosting later

This is a plain static site (HTML/CSS/JS + JSON + images/videos), so it can be
deployed as-is to any static host (Netlify, Vercel, GitHub Pages, Cloudflare
Pages, S3 + CloudFront, etc.) — just upload/push this entire directory. No
build step is required at deploy time (the data is already generated); only
re-run `scripts/build_data.py` and redeploy if the source archive changes.

The `media/` directory is ~490MB. If your host has upload size limits, you
may want to move media to an object storage bucket/CDN and update the `path`
values in `data/website-posts.json` and `data/website-posts-unnumbered.json`
accordingly — everything else in the site is host-agnostic.
