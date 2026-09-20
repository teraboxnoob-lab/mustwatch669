import { isAuthorized, jsonResponse, unauthorizedResponse } from "./_shared/auth.js";
import {
  contentStore,
  extractLinks,
  mediaType,
  resolveTarget,
  safeFileName,
  ValidationError,
} from "./_shared/store.js";

const MAX_MEDIA_BYTES = 4 * 1024 * 1024;
const BLOB_MEDIA_PREFIX = "blob-media/";

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
    const rawPostId = (form.get("post_id") || "").toString();
    const text = (form.get("text") || "").toString().trim();
    const date = (form.get("date") || "").toString().trim();

    if (!text) throw new ValidationError("Post text is required.");
    if (!date) throw new ValidationError("Date is required.");

    const store = contentStore();
    const { postId, overridesKey, overrides, current } = await resolveTarget(
      request, store, isUnnumbered, rawPostId
    );
    if (!current) throw new ValidationError(`POST ${rawPostId} was not found.`);

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

    let removePaths = new Set();
    const removeRaw = (form.get("remove_media") || "").toString().trim();
    if (removeRaw) {
      try {
        removePaths = new Set(JSON.parse(removeRaw));
      } catch {
        // ignored, same as local_server.py's best-effort parse
      }
    }

    const existingMedia = current.media || [];
    const keptMedia = existingMedia.filter((m) => !removePaths.has(m.path));

    // Only blob-media (uploaded live) can actually be deleted here - static
    // archive media isn't reachable from a function, same restriction as
    // local_server.py limits deletion to media/added/.
    for (const m of existingMedia) {
      if (removePaths.has(m.path) && m.path.startsWith(BLOB_MEDIA_PREFIX)) {
        const key = "media/" + m.path.slice(BLOB_MEDIA_PREFIX.length);
        await store.delete(key);
      }
    }

    for (const f of mediaFiles) {
      const safeName = safeFileName(f.name);
      const key = `media/${postId}/${safeName}`;
      await store.set(key, await f.arrayBuffer(), {
        metadata: { contentType: f.type || "application/octet-stream" },
      });
      keptMedia.push({ path: `blob-media/${postId}/${safeName}`, type: mediaType(safeName) });
    }

    const links = extractLinks(text);
    overrides[String(postId)] = { post_id: postId, date, text, media: keptMedia, links };
    await store.setJSON(overridesKey, overrides);

    return jsonResponse(200, {
      success: true,
      post_id: postId,
      media_count: keptMedia.length,
      links_found: links.length,
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return jsonResponse(400, { success: false, error: err.message });
    }
    return jsonResponse(500, { success: false, error: `Server error: ${err.message}` });
  }
};

export const config = { path: "/api/edit-post" };
