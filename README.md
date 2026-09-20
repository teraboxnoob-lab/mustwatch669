# MustWatch Archive

A static, generated web archive of the existing Telegram/Discord post collection
from `~/telegram-discord-bridge`. This is a **standalone project** — it does not
depend on the bridge project at runtime, only its build script reads from it.

No accounts, no database. Browsing is just static HTML/CSS/JS + a generated
JSON data file + copied media files — the only login is a single shared
email/password gate in front of the Add Post form, checked either by
`scripts/local_server.py` (running on your own machine) or, once deployed,
by the Netlify Functions in `netlify/functions/` (see "Deploying to Netlify"
below).

## What's in here

```
mustwatch-web/
  index.html              Home page: stats, search, feed, fast-scroller
  post.html                Post detail page (POST NO. view, gallery, prev/next)
  add-post.html            Manual "add a new post" form (needs local_server.py, see below)
  assets/css/style.css     Dark, mobile-first styling
  assets/js/data.js        Shared data loader (fetches the JSON below + merges the live overlay)
  assets/js/home.js        Home page logic: search + feed + scroller
  assets/js/post.js        Post detail logic: gallery, link button, prev/next
  assets/js/add-post.js    Add-post form logic
  data/website-posts.json             Normalized POST 1 -> POST 1788 archive (missing numbers skipped)
  data/website-posts-unnumbered.json  Normalized posts from posts-unnumbered.json (separate section)
  data/build-meta.json                Build stats (counts, missing post numbers, etc.)
  media/telegram-media-complete/...          Copied media (only files actually referenced by a post)
  media/telegram-media-discord-checking/...
  media/added/<post_id>/...           Media uploaded locally through add-post.html
  scripts/build_data.py    (Re)generates the initial archive from the source project
  scripts/local_server.py  Static file server + the add-post API endpoint (local use)
  netlify/functions/       Same add-post API, reimplemented for the deployed site
                            (auth, add/edit/delete-post, posts-feed, media) — see
                            "Deploying to Netlify" below
  netlify.toml, package.json   Netlify Functions config + @netlify/blobs dependency
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

- No secrets from the source `telegram-discord-bridge` project are referenced
  anywhere here. `.env`, session files, Telegram API credentials, and Discord
  webhooks were never copied here and are not read by any client-side code.
- The Add Post login is a single shared email/password, not per-user
  accounts. Locally it's read from `AUTH_EMAIL`/`AUTH_PASSWORD` env vars (or
  `scripts/local_server.py`'s hardcoded fallback if unset). On Netlify it's
  read only from the `AUTH_EMAIL`/`AUTH_PASSWORD` environment variables you
  set in the dashboard — there's no fallback there, so an unset value means
  login always fails rather than silently accepting a known default.
- `scripts/local_server.py`'s hardcoded fallback credentials
  (`teraboxnoob@gmail.com` / `msuwatch@4666`) are in this repo's git history.
  Don't reuse them as your live Netlify credentials — pick fresh values when
  setting the env vars.
- Everything client-side talks only to `/api/*` on the same origin (no
  third-party network calls); those routes are served either by
  `local_server.py` or the Netlify Functions, both bound to this project's
  own auth check.

## Deploying to Netlify (with a working Add Post / login)

Browsing the archive is a plain static site and works on any static host with
zero setup. Add Post / login on the *deployed* site additionally needs the
Netlify Functions in `netlify/functions/` (they re-implement
`scripts/local_server.py`'s auth + add/edit/delete-post logic, but backed by
[Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
instead of local files, since a Function can't write back into the static
files that were deployed from git):

1. Push this repo to the git provider Netlify is watching — it auto-detects
   `netlify/functions/` (see `netlify.toml`) and `package.json`
   (`@netlify/blobs`), no manual build command needed.
2. In the Netlify dashboard: **Site settings → Environment variables**, set
   `AUTH_EMAIL` and `AUTH_PASSWORD` to whatever login you want for the live
   site. There is no default — if these aren't set, login always fails.
   (The old hardcoded `teraboxnoob@gmail.com` / `msuwatch@4666` pair in
   `local_server.py` is already in git history; treat those as burned and
   pick fresh values here rather than reusing them.)
3. Trigger a redeploy after setting env vars so the functions pick them up,
   then open `/add-post.html` on the live URL and log in.

**Local and live adds are two separate stores.** `local_server.py` still
writes straight to `data/website-posts.json` + `media/added/` on your disk —
those only reach the live site once you git-commit + push + redeploy. Posts
added through the *live* site are saved to Netlify Blobs and appear
immediately (no redeploy), but they don't exist in your local files unless
you reconcile them back manually. Use whichever fits the moment: bulk/offline
backfilling → `local_server.py`; a quick add from your phone → the live site.

**Live uploads are capped at ~4MB per file** (Netlify Functions' request-size
limit) — you'll get a clear error naming the file if you hit it. Most photos
are well under that; for larger videos, add them locally with
`local_server.py` and redeploy instead.

## Deploying to other static hosting

For a host without a Functions/Blobs equivalent (Vercel, GitHub Pages,
Cloudflare Pages, S3 + CloudFront, etc.), just upload/push this directory —
browsing works identically, but Add Post / login will only work by running
`scripts/local_server.py` on your own machine (see above), not from the
deployed URL.

The `media/` directory is ~490MB. If your host has upload size limits, you
may want to move media to an object storage bucket/CDN and update the `path`
values in `data/website-posts.json` and `data/website-posts-unnumbered.json`
accordingly — everything else in the site is host-agnostic.
