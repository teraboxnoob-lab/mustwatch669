import { isAuthorized, jsonResponse, unauthorizedResponse } from "./_shared/auth.js";
import {
  contentStore,
  extractLinks,
  fetchBase,
  mediaType,
  readJSON,
  safeFileName,
  ValidationError,
} from "./_shared/store.js";

// Netlify Functions cap request bodies around 6MB (~4.5MB effective once
// framing overhead is counted) - stay comfortably under that per file.
const MAX_MEDIA_BYTES = 4 * 1024 * 1024;

export default async (request) => {
  if (!isAuthorized(request)) return unauthorizedResponse();

  let form;
  try {
    form = await request.formData();
  } catch {
    return jsonResponse(400, { success: false, error: "Expected multipart/form-data." });
  }

  try {
    const isUnnumbered = form.get("unnumbered") === "true";
    const text = (form.get("text") || "").toString().trim();
    const date = (form.get("date") || "").toString().trim();
    const overwrite = form.get("overwrite") === "true";

    if (!text) throw new ValidationError("Post text is required.");
    if (!date) throw new ValidationError("Date is required.");

    const mediaFiles = form.getAll("media").filter((f) => f instanceof File && f.name);
    for (const f of mediaFiles) {
      if (f.size > MAX_MEDIA_BYTES) {
        throw new ValidationError(
          `"${f.name}" is ${(f.size / 1024 / 1024).toFixed(1)}MB - files over ` +
          `${MAX_MEDIA_BYTES / 1024 / 1024}MB can't be uploaded from the live site ` +
          `(Netlify Functions request-size limit). Add it via local_server.py and redeploy instead.`
        );
      }
    }

    const store = contentStore();
    const links = extractLinks(text);

    const overridesKey = isUnnumbered ? "content/unnumbered-overrides" : "content/numbered-overrides";
    const deletedKey = isUnnumbered ? "content/unnumbered-deleted" : "content/numbered-deleted";
    const basePath = isUnnumbered ? "/data/website-posts-unnumbered.json" : "/data/website-posts.json";

    const [overrides, deleted, basePosts] = await Promise.all([
      readJSON(store, overridesKey, {}),
      readJSON(store, deletedKey, []),
      fetchBase(request, basePath),
    ]);

    let postId;
    if (isUnnumbered) {
      const existingIds = new Set([
        ...basePosts.map((p) => p.post_id),
        ...Object.keys(overrides),
      ]);
      let n = 1;
      while (existingIds.has(`u${n}`)) n++;
      postId = `u${n}`;
    } else {
      const raw = (form.get("post_id") || "").toString().trim();
      if (!/^\d+$/.test(raw)) throw new ValidationError("Post number must be a positive integer.");
      postId = parseInt(raw, 10);

      const isDeleted = deleted.includes(postId);
      const existsInBase = !isDeleted && basePosts.some((p) => p.post_id === postId);
      const existsInOverrides = Object.prototype.hasOwnProperty.call(overrides, String(postId));
      if ((existsInBase || existsInOverrides) && !overwrite) {
        throw new ValidationError(`POST ${postId} already exists. Check "overwrite" to replace it.`);
      }
    }

    const mediaEntries = [];
    for (const f of mediaFiles) {
      const safeName = safeFileName(f.name);
      const key = `media/${postId}/${safeName}`;
      await store.set(key, await f.arrayBuffer(), {
        metadata: { contentType: f.type || "application/octet-stream" },
      });
      mediaEntries.push({ path: `blob-media/${postId}/${safeName}`, type: mediaType(safeName) });
    }

    overrides[String(postId)] = { post_id: postId, date, text, media: mediaEntries, links };
    await store.setJSON(overridesKey, overrides);

    if (!isUnnumbered && deleted.includes(postId)) {
      await store.setJSON(deletedKey, deleted.filter((id) => id !== postId));
    }

    return jsonResponse(200, {
      success: true,
      post_id: postId,
      media_saved: mediaEntries.length,
      links_found: links.length,
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return jsonResponse(400, { success: false, error: err.message });
    }
    return jsonResponse(500, { success: false, error: `Server error: ${err.message}` });
  }
};

export const config = { path: "/api/add-post" };
