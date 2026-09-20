(() => {
  const BATCH_SIZE = 20;
  const MEDIA_PREVIEW_LIMIT = 4;

  const feed = document.getElementById("feed");
  const searchInput = document.getElementById("search-input");
  const searchMeta = document.getElementById("search-meta");
  const searchResults = document.getElementById("search-results");
  const totalStat = document.getElementById("stat-total");
  const rangeStat = document.getElementById("stat-range");
  const missingStat = document.getElementById("stat-missing");
  const loaderRow = document.getElementById("loader-row");
  const sectionToggle = document.getElementById("section-toggle");
  const scrollIndicator = document.getElementById("scroll-indicator");
  const fastScroller = document.getElementById("fast-scroller");
  const fastScrollerTrack = document.getElementById("fast-scroller-track");
  const fastScrollerThumb = document.getElementById("fast-scroller-thumb");
  const fastScrollerTooltip = document.getElementById("fast-scroller-tooltip");
  const rangeTicks = document.getElementById("range-ticks");
  const RANGE_BUCKET_SIZE = 100;
  const RANGE_MAX_NUMBER = 1788;

  const SUGGESTION_LIMIT = 8;
  const DEFAULT_HINT = "Type a post number (e.g. 392) to jump straight to it, or type text to see matching posts.";

  let allPosts = [];
  let unnumberedPosts = [];
  let currentList = [];
  let renderedCount = 0;
  let currentSection = "numbered";
  let observer = null;
  let activeSuggestions = [];
  let activeIndex = -1;

  let currentIndex = 0;
  let indicatorObserver = null;
  let isDragging = false;
  let indicatorHideTimer = null;

  function permalink(post) {
    return typeof post.post_id === "number"
      ? `post.html?id=${post.post_id}`
      : `post.html?uid=${encodeURIComponent(post.post_id)}`;
  }

  function mediaHtml(post) {
    const media = post.media || [];
    if (media.length === 0) {
      return `<div class="no-media">No media for this post</div>`;
    }

    if (media.length === 1) {
      const m = media[0];
      const tag = m.type === "video"
        ? `<img data-src="${m.path}" alt="" class="lazy-thumb"><span class="badge-video">▶ Video</span>`
        : `<img data-src="${m.path}" alt="" class="lazy-thumb">`;
      return `<a href="${permalink(post)}">${tag}</a>`;
    }

    const shown = media.slice(0, MEDIA_PREVIEW_LIMIT);
    const extra = media.length - shown.length;
    const items = shown.map((m, i) => {
      const isLast = i === shown.length - 1 && extra > 0;
      const videoBadge = m.type === "video" ? `<span class="badge-video">▶</span>` : "";
      return `<div style="position:relative">
        <img data-src="${m.path}" alt="" class="lazy-thumb">
        ${videoBadge}
        ${isLast ? `<div class="extra-count">+${extra}</div>` : ""}
      </div>`;
    }).join("");
    return `<a href="${permalink(post)}"><div class="feed-media-grid">${items}</div></a>`;
  }

  function linksHtml(links) {
    if (!links || links.length === 0) return "";
    if (links.length === 1) {
      return `<div class="feed-links single">
        <a class="link-btn" href="${links[0]}" target="_blank" rel="noopener noreferrer">▶ Watch / Open</a>
      </div>`;
    }
    const chips = links.map((l, i) =>
      `<a class="link-btn" href="${l}" target="_blank" rel="noopener noreferrer">Link ${i + 1}</a>`
    ).join("");
    return `<div class="feed-links">${chips}</div>`;
  }

  function postHtml(post, index) {
    const date = Archive.formatDate(post.date);
    const plainLabel = typeof post.post_id === "number" ? `POST #${post.post_id}` : "Unnumbered";
    const idLabel = typeof post.post_id === "number"
      ? `<span class="hash">#</span>${post.post_id}`
      : `Unnumbered`;

    return `
      <article class="feed-post" id="feed-post-${index}" data-index="${index}" data-label="${Archive.escapeHtml(plainLabel)}">
        <div class="feed-head">
          <span class="feed-post-id">${idLabel}</span>
          <span class="feed-date">${date}</span>
        </div>
        <div class="feed-media">${mediaHtml(post)}</div>
        <div class="feed-body">
          <div class="feed-text">${Archive.escapeHtml(post.text)}</div>
          ${linksHtml(post.links)}
          <div class="feed-foot">
            <a class="feed-view" href="${permalink(post)}">View post →</a>
          </div>
        </div>
      </article>`;
  }

  function lazyLoadObserver() {
    if (observer) observer.disconnect();
    observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset.src) {
            img.src = img.dataset.src;
            img.removeAttribute("data-src");
          }
          observer.unobserve(img);
        }
      });
    }, { rootMargin: "300px 0px" });
    document.querySelectorAll(".lazy-thumb[data-src]").forEach((img) => observer.observe(img));
  }

  // Renders every not-yet-rendered post up to (and including) targetIndex in
  // one DOM insert. Used both by normal infinite scroll (small increments)
  // and by the fast-scroller (which can jump straight to index ~1600).
  function renderUpTo(targetIndex) {
    const upto = Math.min(currentList.length, targetIndex + 1);
    if (upto <= renderedCount) return;
    const slice = currentList.slice(renderedCount, upto);
    const html = slice.map((post, i) => postHtml(post, renderedCount + i)).join("");
    feed.insertAdjacentHTML("beforeend", html);
    const startIndex = renderedCount;
    renderedCount = upto;
    lazyLoadObserver();
    observeIndicator(startIndex);
    loaderRow.style.display = renderedCount < currentList.length ? "flex" : "none";
  }

  function renderNextBatch() {
    renderUpTo(renderedCount + BATCH_SIZE - 1);
  }

  function resetFeed(list) {
    currentList = list;
    renderedCount = 0;
    currentIndex = 0;
    feed.innerHTML = "";
    resetScroller(list.length);
    if (list.length === 0) {
      feed.innerHTML = `<div class="empty-state">No posts match your search.</div>`;
      loaderRow.style.display = "none";
      return;
    }
    renderNextBatch();
  }

  // --- Current-post indicator + fast scroller ---
  // A single IntersectionObserver tracks which post's header is at the top
  // of the viewport as the user scrolls normally. That same "currentIndex"
  // drives both the floating "POST #N" pill and the thumb position on the
  // right-edge scrollbar. Dragging the thumb does the reverse: it picks an
  // index from the drag position, renders every post up to it (posts render
  // as flat HTML with lazy-loaded images, so jumping ahead by hundreds of
  // posts is cheap), then scrolls there.

  function observeIndicator(fromIndex) {
    if (!indicatorObserver) return;
    for (let i = fromIndex; i < renderedCount; i++) {
      const el = document.getElementById(`feed-post-${i}`);
      if (el) indicatorObserver.observe(el);
    }
  }

  function setupIndicatorObserver() {
    const headerHeight = document.querySelector(".site-header").offsetHeight;
    indicatorObserver = new IntersectionObserver((entries) => {
      if (isDragging) return;
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const idx = parseInt(entry.target.dataset.index, 10);
          if (!isNaN(idx)) updateCurrentIndex(idx, false);
        }
      });
    }, { rootMargin: `-${headerHeight + 4}px 0px -75% 0px`, threshold: 0 });
  }

  function showIndicator() {
    scrollIndicator.classList.add("visible");
    clearTimeout(indicatorHideTimer);
    indicatorHideTimer = setTimeout(() => scrollIndicator.classList.remove("visible"), 1500);
  }

  function updateCurrentIndex(index, fromDrag) {
    currentIndex = Math.max(0, Math.min(index, currentList.length - 1));
    const post = currentList[currentIndex];
    if (!post) return;
    const label = typeof post.post_id === "number" ? `POST #${post.post_id}` : "Unnumbered";
    scrollIndicator.textContent = label;
    showIndicator();
    if (!fromDrag) updateThumbPosition(currentIndex);
  }

  function trackRect() {
    return fastScroller.getBoundingClientRect();
  }

  // A smooth-scroll animation fires many intermediate 'scroll' events, and
  // the indicator IntersectionObserver would otherwise treat each one as a
  // real user scroll and overwrite the jump target with whatever post is
  // passing by mid-animation. Reuse the drag guard (isDragging) to mute the
  // observer for the animation's duration, and release it only once actual
  // scroll events stop firing (the animation has settled) rather than
  // guessing a fixed delay.
  let scrollSettleTimer = null;
  let scrollSettleListener = null;
  function suppressObserverUntilScrollSettles() {
    isDragging = true;
    clearTimeout(scrollSettleTimer);
    if (scrollSettleListener) window.removeEventListener("scroll", scrollSettleListener);
    scrollSettleListener = () => {
      clearTimeout(scrollSettleTimer);
      scrollSettleTimer = setTimeout(release, 150);
    };
    function release() {
      window.removeEventListener("scroll", scrollSettleListener);
      isDragging = false;
    }
    window.addEventListener("scroll", scrollSettleListener, { passive: true });
    scrollSettleTimer = setTimeout(release, 150);
  }

  function updateThumbPosition(index) {
    if (currentList.length <= 1) return;
    const rect = trackRect();
    const usable = rect.height - fastScrollerThumb.offsetHeight;
    const fraction = index / (currentList.length - 1);
    fastScrollerThumb.style.top = `${Math.max(0, Math.min(usable, fraction * usable))}px`;
  }

  function resetScroller(totalCount) {
    fastScroller.classList.toggle("visible", totalCount > BATCH_SIZE);
    fastScrollerThumb.style.top = "0px";
    fastScrollerTooltip.classList.remove("visible");
    scrollIndicator.classList.remove("visible");
    buildRangeTicks(totalCount);
  }

  // "1-100 / 101-200 / ..." one-tap stops next to the drag thumb, for
  // coarse jumps without needing to drag precisely.
  function buildRangeTicks(totalCount) {
    if (currentSection !== "numbered" || totalCount <= BATCH_SIZE) {
      rangeTicks.classList.remove("visible");
      rangeTicks.innerHTML = "";
      return;
    }
    let html = "";
    for (let start = 1; start <= RANGE_MAX_NUMBER; start += RANGE_BUCKET_SIZE) {
      const end = Math.min(start + RANGE_BUCKET_SIZE - 1, RANGE_MAX_NUMBER);
      html += `<div class="range-tick" data-start="${start}" title="POST ${start}–${end}"><span class="dot"></span></div>`;
    }
    rangeTicks.innerHTML = html;
    rangeTicks.classList.add("visible");
  }

  function jumpToIndex(targetIndex, { showTooltip = false, smooth = false } = {}) {
    renderUpTo(targetIndex);
    const el = document.getElementById(`feed-post-${targetIndex}`);
    if (el) {
      const headerOffset = document.querySelector(".site-header").offsetHeight + 8;
      const top = el.getBoundingClientRect().top + window.scrollY - headerOffset;
      if (smooth) suppressObserverUntilScrollSettles();
      window.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
    }
    updateCurrentIndex(targetIndex, true);

    const fraction = currentList.length > 1 ? targetIndex / (currentList.length - 1) : 0;
    const thumbTop = fraction * (trackRect().height - fastScrollerThumb.offsetHeight);
    fastScrollerThumb.style.top = `${thumbTop}px`;

    if (showTooltip) {
      const post = currentList[targetIndex];
      const label = post
        ? (typeof post.post_id === "number" ? `POST #${post.post_id}` : "Unnumbered")
        : "";
      const date = post ? Archive.formatDate(post.date) : "";
      fastScrollerTooltip.textContent = date ? `${label} · ${date}` : label;
      fastScrollerTooltip.style.top = `${thumbTop + fastScrollerThumb.offsetHeight / 2}px`;
      fastScrollerTooltip.classList.add("visible");
    }
    return targetIndex;
  }

  function jumpToFraction(fraction, showTooltip) {
    const clamped = Math.max(0, Math.min(1, fraction));
    const targetIndex = Math.round(clamped * (currentList.length - 1));
    jumpToIndex(targetIndex, { showTooltip, smooth: false });
  }

  // Jumps to the first existing post whose number is >= startNum (used by
  // the "1-100 / 101-200 / ..." range ticks). Falls back to the nearest
  // post below startNum if nothing at/after it exists in this section.
  function jumpToPostNumber(startNum) {
    if (currentSection !== "numbered") return;
    let idx = currentList.findIndex((p) => typeof p.post_id === "number" && p.post_id >= startNum);
    if (idx === -1) idx = currentList.length - 1;
    jumpToIndex(idx, { showTooltip: true, smooth: true });
    setTimeout(() => fastScrollerTooltip.classList.remove("visible"), 900);
  }

  function setupFastScroller() {
    function fractionFromClientY(clientY) {
      const rect = trackRect();
      const y = Math.min(Math.max(clientY, rect.top), rect.bottom);
      return (y - rect.top) / rect.height;
    }

    function onPointerDown(e) {
      if (currentList.length === 0) return;
      isDragging = true;
      fastScrollerThumb.classList.add("dragging");
      try { fastScrollerThumb.setPointerCapture(e.pointerId); } catch (_) {}
      jumpToFraction(fractionFromClientY(e.clientY), true);
    }

    function onPointerMove(e) {
      if (!isDragging) return;
      jumpToFraction(fractionFromClientY(e.clientY), true);
    }

    function onPointerUp(e) {
      if (!isDragging) return;
      isDragging = false;
      fastScrollerThumb.classList.remove("dragging");
      try { fastScrollerThumb.releasePointerCapture(e.pointerId); } catch (_) {}
      fastScrollerTooltip.classList.remove("visible");
      showIndicator();
    }

    fastScrollerThumb.addEventListener("pointerdown", onPointerDown);
    fastScrollerThumb.addEventListener("pointermove", onPointerMove);
    fastScrollerThumb.addEventListener("pointerup", onPointerUp);
    fastScrollerThumb.addEventListener("pointercancel", onPointerUp);

    // Clicking/tapping anywhere on the rail (not just the thumb) jumps there
    // too — the thumb itself is only 18-22px wide, the whole rail is the
    // real touch target.
    fastScroller.addEventListener("pointerdown", (e) => {
      if (e.target === fastScrollerThumb) return;
      jumpToFraction(fractionFromClientY(e.clientY), true);
      setTimeout(() => fastScrollerTooltip.classList.remove("visible"), 500);
    });
  }

  function setupRangeTicks() {
    rangeTicks.addEventListener("click", (e) => {
      const tick = e.target.closest(".range-tick");
      if (!tick) return;
      const start = parseInt(tick.dataset.start, 10);
      rangeTicks.querySelectorAll(".range-tick").forEach((el) => el.classList.remove("active"));
      tick.classList.add("active");
      jumpToPostNumber(start);
    });
  }

  // --- Search: number jumps straight to the post, text shows a
  // click-to-open suggestions dropdown. The main feed underneath is never
  // filtered — search is purely a "find & go to a post" tool. ---

  function highlightSnippet(text, query, len = 90) {
    const clean = (text || "").replace(/\s+/g, " ").trim();
    const idx = clean.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return Archive.escapeHtml(Archive.textPreview(clean, len));
    const start = Math.max(0, idx - 25);
    const end = Math.min(clean.length, idx + query.length + 45);
    let snippet = clean.slice(start, end);
    if (start > 0) snippet = "…" + snippet;
    if (end < clean.length) snippet += "…";
    return Archive.escapeHtml(snippet).replace(
      new RegExp(Archive.escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"),
      (m) => `<mark>${m}</mark>`
    );
  }

  function buildSuggestions(rawQuery) {
    const base = currentSection === "numbered" ? allPosts : unnumberedPosts;
    const query = rawQuery.trim();
    if (!query) return { suggestions: [], exactJump: null };

    if (/^\d+$/.test(query)) {
      const num = parseInt(query, 10);
      const exact = base.find((p) => p.post_id === num) || null;
      const partial = base
        .filter((p) => typeof p.post_id === "number" && p.post_id !== num && String(p.post_id).includes(query))
        .slice(0, SUGGESTION_LIMIT - (exact ? 1 : 0));
      const suggestions = exact ? [exact, ...partial] : partial;
      return { suggestions, exactJump: exact, isNumeric: true, query };
    }

    const q = query.toLowerCase();
    const suggestions = base
      .filter((p) => (p.text || "").toLowerCase().includes(q))
      .slice(0, SUGGESTION_LIMIT);
    return { suggestions, exactJump: null, isNumeric: false, query };
  }

  function suggestionRowHtml(post, index, { isNumeric, query, exactJump }) {
    const media = post.media && post.media[0];
    const thumb = media
      ? `<img src="${media.path}" alt="" loading="lazy">`
      : `<span>No img</span>`;
    const isJump = exactJump && post.post_id === exactJump.post_id;
    const idLabel = typeof post.post_id === "number" ? `#${post.post_id}` : "Unnumbered";
    const snippet = isNumeric
      ? Archive.escapeHtml(Archive.textPreview(post.text, 90))
      : highlightSnippet(post.text, query);

    return `
      <div class="search-result-item${isJump ? " jump-item" : ""}" data-index="${index}">
        <div class="search-result-thumb">${thumb}</div>
        <div class="search-result-body">
          <div class="search-result-id${isJump ? " jump" : ""}">${isJump ? `↵ Go to POST ${idLabel}` : `POST ${idLabel}`}</div>
          <div class="search-result-text">${snippet}</div>
        </div>
      </div>`;
  }

  function renderDropdown(query) {
    // The dropdown sits under the sticky header, in the same screen region
    // as the floating "current post" pill — hide the pill while it's open
    // so they never overlap.
    clearTimeout(indicatorHideTimer);
    scrollIndicator.classList.remove("visible");

    if (!query.trim()) {
      closeDropdown();
      searchMeta.textContent = DEFAULT_HINT;
      searchMeta.classList.remove("hint-jump");
      return;
    }

    const result = buildSuggestions(query);
    activeSuggestions = result.suggestions;
    activeIndex = -1;

    if (result.suggestions.length === 0) {
      searchResults.innerHTML = `<div class="search-result-empty">${
        result.isNumeric ? `No POST ${Archive.escapeHtml(query)} in this section.` : "No posts match that text."
      }</div>`;
      searchResults.classList.add("open");
      searchMeta.textContent = "";
      searchMeta.classList.remove("hint-jump");
      return;
    }

    searchResults.innerHTML = result.suggestions
      .map((post, i) => suggestionRowHtml(post, i, result))
      .join("");
    searchResults.classList.add("open");

    if (result.exactJump) {
      searchMeta.textContent = `Press Enter to jump straight to POST ${result.exactJump.post_id}`;
      searchMeta.classList.add("hint-jump");
    } else {
      searchMeta.textContent = `${result.suggestions.length} suggestion${result.suggestions.length === 1 ? "" : "s"} — click one to open it`;
      searchMeta.classList.remove("hint-jump");
    }
  }

  function closeDropdown() {
    searchResults.classList.remove("open");
    searchResults.innerHTML = "";
    activeSuggestions = [];
    activeIndex = -1;
  }

  function navigateTo(post) {
    if (!post) return;
    window.location.href = permalink(post);
  }

  function updateActiveHighlight() {
    searchResults.querySelectorAll(".search-result-item").forEach((el, i) => {
      el.classList.toggle("active", i === activeIndex);
    });
  }

  function setupInfiniteScroll() {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) renderNextBatch();
      });
    }, { rootMargin: "500px 0px" });
    io.observe(loaderRow);
  }

  function switchSection(section) {
    currentSection = section;
    document.querySelectorAll(".toggle-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.section === section);
    });
    searchInput.value = "";
    closeDropdown();
    searchMeta.textContent = DEFAULT_HINT;
    searchMeta.classList.remove("hint-jump");
    resetFeed(section === "numbered" ? allPosts : unnumberedPosts);
  }

  async function init() {
    const [main, unnumbered] = await Promise.all([
      Archive.loadMain(),
      Archive.loadUnnumbered(),
    ]);
    allPosts = main;
    unnumberedPosts = unnumbered;

    const missingCount = 1788 - main.length;
    totalStat.textContent = main.length;
    rangeStat.textContent = "1 – 1788";
    missingStat.textContent = missingCount;

    setupInfiniteScroll();
    setupIndicatorObserver();
    setupFastScroller();
    setupRangeTicks();
    resetFeed(allPosts);

    searchInput.addEventListener("input", () => renderDropdown(searchInput.value));

    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeDropdown();
        searchInput.blur();
        return;
      }
      if (e.key === "ArrowDown") {
        if (activeSuggestions.length === 0) return;
        e.preventDefault();
        activeIndex = (activeIndex + 1) % activeSuggestions.length;
        updateActiveHighlight();
        return;
      }
      if (e.key === "ArrowUp") {
        if (activeSuggestions.length === 0) return;
        e.preventDefault();
        activeIndex = (activeIndex - 1 + activeSuggestions.length) % activeSuggestions.length;
        updateActiveHighlight();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (activeIndex >= 0 && activeSuggestions[activeIndex]) {
          navigateTo(activeSuggestions[activeIndex]);
        } else if (activeSuggestions.length > 0) {
          navigateTo(activeSuggestions[0]);
        }
      }
    });

    searchResults.addEventListener("click", (e) => {
      const row = e.target.closest(".search-result-item");
      if (!row) return;
      const idx = parseInt(row.dataset.index, 10);
      navigateTo(activeSuggestions[idx]);
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".search-wrap")) closeDropdown();
    });

    if (sectionToggle) {
      sectionToggle.addEventListener("click", (e) => {
        const btn = e.target.closest(".toggle-btn");
        if (!btn) return;
        switchSection(btn.dataset.section);
      });
    }
  }

  init().catch((err) => {
    feed.innerHTML = `<div class="empty-state">Failed to load archive data.<br>${Archive.escapeHtml(err.message)}</div>`;
    loaderRow.style.display = "none";
  });
})();
