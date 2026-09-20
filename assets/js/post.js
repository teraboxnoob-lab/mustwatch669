(() => {
  const content = document.getElementById("post-content");

  function getParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function galleryHtml(media) {
    if (!media || media.length === 0) {
      return `<div class="no-media-block">No media available for this post.</div>`;
    }
    const countClass = media.length === 1 ? "count-1" : media.length === 2 ? "count-2" : "count-multi";
    const items = media.map((m) => {
      if (m.type === "video") {
        return `<div class="gallery-item">
          <video controls preload="metadata" playsinline>
            <source src="${Archive.mediaUrl(m.path)}" />
          </video>
        </div>`;
      }
      return `<div class="gallery-item"><img src="${Archive.mediaUrl(m.path)}" alt="" loading="lazy" /></div>`;
    }).join("");
    return `<div class="gallery ${countClass}">${items}</div>`;
  }

  function linksHtml(links) {
    if (!links || links.length === 0) return "";
    if (links.length === 1) {
      return `<a class="btn btn-primary" href="${links[0]}" target="_blank" rel="noopener noreferrer">▶ Watch / Open Link</a>`;
    }
    // Some posts carry many links (up to 16) — compact wrapping chips instead
    // of a wall of full-width buttons.
    const chips = links.map((l, i) =>
      `<a class="link-btn" href="${l}" target="_blank" rel="noopener noreferrer">▶ Link ${i + 1}</a>`
    ).join("");
    return `<div class="feed-links" style="margin-bottom:22px">${chips}</div>`;
  }

  function navButton(post, label, dir) {
    if (!post) {
      return `<span class="nav-btn disabled">${label}</span>`;
    }
    const href = typeof post.post_id === "number" ? `post.html?id=${post.post_id}` : `post.html?uid=${encodeURIComponent(post.post_id)}`;
    return `<a class="nav-btn" href="${href}">${label}</a>`;
  }

  function ownerControlsHtml(post, isUnnumbered) {
    const editHref = isUnnumbered
      ? `add-post.html?edit=${encodeURIComponent(post.post_id)}&unnumbered=true`
      : `add-post.html?edit=${post.post_id}`;
    return `
      <div class="owner-controls">
        <a class="nav-btn" href="${editHref}">✎ Edit</a>
        <button type="button" class="nav-btn danger" id="delete-post-btn">🗑 Delete</button>
      </div>`;
  }

  function render(post, { prev, next, isUnnumbered, loggedIn }) {
    const idLabel = isUnnumbered ? `UNNUMBERED POST` : `POST NO ${post.post_id}`;
    const date = Archive.formatDate(post.date);

    content.innerHTML = `
      <a class="back-link" href="index.html">← Back to archive</a>
      <div class="post-title">${idLabel}</div>
      <div class="post-date">${date || "Date unavailable"}</div>
      ${galleryHtml(post.media)}
      <div class="post-text">${Archive.escapeHtml(Archive.stripLinkLines(post.text))}</div>
      ${linksHtml(post.links)}
      ${loggedIn ? ownerControlsHtml(post, isUnnumbered) : ""}
      <div class="nav-row">
        ${navButton(prev, "← Previous", "prev")}
        ${navButton(next, "Next →", "next")}
      </div>
    `;

    if (loggedIn) {
      document.getElementById("delete-post-btn").addEventListener("click", () => deletePost(post, isUnnumbered));
    }
  }

  async function deletePost(post, isUnnumbered) {
    const label = isUnnumbered ? "this unnumbered post" : `POST ${post.post_id}`;
    if (!confirm(`Delete ${label}? This removes it from the site and deletes any media you uploaded for it. This can't be undone.`)) {
      return;
    }
    const fd = new FormData();
    fd.append("unnumbered", isUnnumbered ? "true" : "false");
    fd.append("post_id", String(post.post_id));
    try {
      const res = await Auth.authFetch("/api/delete-post", { method: "POST", body: fd });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.error || "Delete failed");
      window.location.href = "index.html";
    } catch (err) {
      alert("Couldn't delete: " + err.message);
    }
  }

  async function init() {
    const idParam = getParam("id");
    const uidParam = getParam("uid");
    const loggedIn = Auth.isLoggedIn();

    if (idParam !== null) {
      const postId = parseInt(idParam, 10);
      const post = await Archive.getById(postId);
      if (!post) {
        content.innerHTML = `<div class="empty-state">POST ${Archive.escapeHtml(idParam)} does not exist in the archive.<br><a class="back-link" href="index.html">← Back to archive</a></div>`;
        document.title = "Post not found — MustWatch Archive";
        return;
      }
      const { prev, next } = await Archive.neighbors(postId);
      document.title = `POST ${postId} — MustWatch Archive`;
      render(post, { prev, next, isUnnumbered: false, loggedIn });
      return;
    }

    if (uidParam !== null) {
      const unnumbered = await Archive.loadUnnumbered();
      const idx = unnumbered.findIndex((p) => p.post_id === uidParam);
      if (idx === -1) {
        content.innerHTML = `<div class="empty-state">Post not found.<br><a class="back-link" href="index.html">← Back to archive</a></div>`;
        return;
      }
      const post = unnumbered[idx];
      const prev = idx > 0 ? unnumbered[idx - 1] : null;
      const next = idx < unnumbered.length - 1 ? unnumbered[idx + 1] : null;
      document.title = `Unnumbered Post — MustWatch Archive`;
      render(post, { prev, next, isUnnumbered: true, loggedIn });
      return;
    }

    content.innerHTML = `<div class="empty-state">No post specified.<br><a class="back-link" href="index.html">← Back to archive</a></div>`;
  }

  init().catch((err) => {
    content.innerHTML = `<div class="empty-state">Failed to load post.<br>${Archive.escapeHtml(err.message)}</div>`;
  });
})();
