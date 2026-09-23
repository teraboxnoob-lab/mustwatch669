(() => {
  const form = document.getElementById("add-post-form");
  const pageHeading = document.getElementById("page-heading");
  const unnumberedToggle = document.getElementById("unnumbered-toggle");
  const unnumberedToggleLabel = document.getElementById("unnumbered-toggle-label");
  const postNumberField = document.getElementById("post-number-field");
  const postIdInput = document.getElementById("post-id");
  const postDateInput = document.getElementById("post-date");
  const postTextInput = document.getElementById("post-text");
  const linkPreview = document.getElementById("link-preview");
  const existingMediaField = document.getElementById("existing-media-field");
  const existingMediaEl = document.getElementById("existing-media");
  const mediaInput = document.getElementById("post-media");
  const mediaPreview = document.getElementById("media-preview");
  const overwriteToggle = document.getElementById("overwrite-toggle");
  const overwriteToggleLabel = document.getElementById("overwrite-toggle-label");
  const submitBtn = document.getElementById("submit-btn");
  const cancelEditBtn = document.getElementById("cancel-edit-btn");
  const formStatus = document.getElementById("form-status");

  const URL_RE = /https?:\/\/\S+/g;

  let editMode = null; // null = add mode, or { postId, isUnnumbered }
  let selectedFiles = []; // array of File objects staged for upload

  function extractLinks(text) {
    const matches = text.match(URL_RE) || [];
    const seen = new Set();
    const cleaned = [];
    matches.forEach((u) => {
      u = u.replace(/[).,!?’”]+$/, "");
      if (!seen.has(u)) {
        seen.add(u);
        cleaned.push(u);
      }
    });
    return cleaned;
  }

  function toLocalDatetimeValue(date) {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  postDateInput.value = toLocalDatetimeValue(new Date());

  unnumberedToggle.addEventListener("change", () => {
    postNumberField.style.display = unnumberedToggle.checked ? "none" : "block";
    postIdInput.required = !unnumberedToggle.checked;
  });

  postTextInput.addEventListener("input", () => {
    const links = extractLinks(postTextInput.value);
    linkPreview.innerHTML = links.length
      ? `<strong>${links.length} link${links.length === 1 ? "" : "s"} detected:</strong> ` +
        links.map((l) => `<span class="link-chip">${Archive.escapeHtml(l)}</span>`).join(" ")
      : `<span class="hint">No links detected yet — links are pulled from "LINK - https://..." style text automatically.</span>`;
  });
  postTextInput.dispatchEvent(new Event("input"));

  function renderStagedMedia() {
    mediaPreview.innerHTML = "";
    if (selectedFiles.length === 0) return;
    
    const grid = document.createElement("div");
    grid.className = "staged-media-grid";
    
    selectedFiles.forEach((file, index) => {
      const item = document.createElement("div");
      item.className = "staged-media-item";
      
      const objectUrl = URL.createObjectURL(file);
      if (file.type.startsWith("video/")) {
        item.innerHTML = `<video src="${objectUrl}" muted></video>`;
      } else {
        item.innerHTML = `<img src="${objectUrl}" alt="Preview" />`;
      }
      
      const removeBtn = document.createElement("button");
      removeBtn.className = "staged-media-remove";
      removeBtn.innerHTML = "✕";
      removeBtn.type = "button";
      removeBtn.onclick = () => {
        selectedFiles.splice(index, 1);
        renderStagedMedia();
      };
      
      item.appendChild(removeBtn);
      grid.appendChild(item);
    });
    
    mediaPreview.appendChild(grid);
  }

  mediaInput.addEventListener("change", () => {
    const files = Array.from(mediaInput.files || []);
    if (files.length > 0) {
      selectedFiles.push(...files);
      mediaInput.value = ""; // Clear input so same file can be selected again
      renderStagedMedia();
    }
  });

  function renderExistingMedia(media) {
    if (!media || media.length === 0) {
      existingMediaField.style.display = "none";
      existingMediaEl.innerHTML = "";
      return;
    }
    existingMediaField.style.display = "block";
    existingMediaEl.innerHTML = media.map((m) => `
      <label class="link-chip" style="cursor:pointer">
        <input type="checkbox" class="existing-media-check" data-path="${Archive.escapeHtml(m.path)}" checked style="margin-right:6px" />
        ${Archive.escapeHtml(m.path.split("/").pop())}
      </label>
    `).join(" ");
  }

  function getRemovedMediaPaths() {
    return Array.from(existingMediaEl.querySelectorAll(".existing-media-check"))
      .filter((cb) => !cb.checked)
      .map((cb) => cb.dataset.path);
  }

  async function loadEditTarget(postIdParam, isUnnumbered) {
    const post = isUnnumbered
      ? await Archive.getUnnumberedById(postIdParam)
      : await Archive.getById(parseInt(postIdParam, 10));

    if (!post) {
      formStatus.textContent = `Couldn't find ${isUnnumbered ? "that unnumbered post" : "POST " + postIdParam} to edit.`;
      formStatus.classList.add("error");
      form.style.display = "none";
      return;
    }

    editMode = { postId: post.post_id, isUnnumbered };
    pageHeading.textContent = isUnnumbered ? "Edit Unnumbered Post" : `Edit POST #${post.post_id}`;
    submitBtn.textContent = "Update Post";
    cancelEditBtn.style.display = "block";
    cancelEditBtn.addEventListener("click", () => {
      window.location.href = isUnnumbered ? `post.html?uid=${encodeURIComponent(post.post_id)}` : `post.html?id=${post.post_id}`;
    });

    // Identity (numbered vs unnumbered, and the post number itself) can't
    // change via edit — delete and re-add if you need that.
    unnumberedToggleLabel.style.display = "none";
    unnumberedToggle.checked = isUnnumbered;
    postNumberField.style.display = isUnnumbered ? "none" : "block";
    postIdInput.value = isUnnumbered ? "" : post.post_id;
    postIdInput.disabled = true;
    overwriteToggleLabel.style.display = "none";

    postDateInput.value = toLocalDatetimeValue(post.date);
    postTextInput.value = post.text;
    postTextInput.dispatchEvent(new Event("input"));
    renderExistingMedia(post.media);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    formStatus.textContent = "";
    formStatus.className = "form-status";

    const isUnnumbered = editMode ? editMode.isUnnumbered : unnumberedToggle.checked;
    if (!editMode && !isUnnumbered && !postIdInput.value) {
      formStatus.textContent = "Enter a post number, or mark this as unnumbered.";
      formStatus.classList.add("error");
      return;
    }
    if (!postTextInput.value.trim()) {
      formStatus.textContent = "Paste the post text/caption.";
      formStatus.classList.add("error");
      return;
    }

    const fd = new FormData();
    fd.append("unnumbered", isUnnumbered ? "true" : "false");
    fd.append("post_id", editMode ? String(editMode.postId) : postIdInput.value);
    fd.append("date", postDateInput.value ? new Date(postDateInput.value).toISOString() : new Date().toISOString());
    fd.append("text", postTextInput.value);
    selectedFiles.forEach((f) => fd.append("media", f, f.name));

    const endpoint = editMode ? "/api/edit-post" : "/api/add-post";
    if (editMode) {
      fd.append("remove_media", JSON.stringify(getRemovedMediaPaths()));
    } else {
      fd.append("overwrite", overwriteToggle.checked ? "true" : "false");
    }

    submitBtn.disabled = true;
    submitBtn.textContent = editMode ? "Updating…" : "Saving…";

    try {
      const res = await Auth.authFetch(endpoint, { method: "POST", body: fd });
      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || "Unknown error");
      }
      if (editMode) {
        formStatus.textContent = `Updated POST ${result.post_id}. Redirecting…`;
        formStatus.classList.add("success");
        const dest = isUnnumbered ? `post.html?uid=${encodeURIComponent(result.post_id)}` : `post.html?id=${result.post_id}`;
        setTimeout(() => { window.location.href = dest; }, 700);
      } else {
        formStatus.textContent = `Saved POST ${result.post_id} — ${result.media_saved} media file(s), ${result.links_found} link(s). Refresh the home page to see it.`;
        formStatus.classList.add("success");
        form.reset();
        postDateInput.value = toLocalDatetimeValue(new Date());
        postTextInput.dispatchEvent(new Event("input"));
        selectedFiles = [];
        renderStagedMedia();
      }
    } catch (err) {
      const isNetworkError = err instanceof TypeError;
      formStatus.textContent = isNetworkError
        ? "Couldn't reach the local server. Make sure you started it with: python3 scripts/local_server.py"
        : err.message;
      formStatus.classList.add("error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = editMode ? "Update Post" : "Save Post";
    }
  });

  async function init() {
    if (!Auth.isLoggedIn()) {
      form.style.display = "none";
      document.getElementById("logged-out-gate").style.display = "block";
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const editParam = params.get("edit");
    if (editParam !== null) {
      const isUnnumbered = params.get("unnumbered") === "true";
      await loadEditTarget(editParam, isUnnumbered);
    }
  }
  init();
})();
