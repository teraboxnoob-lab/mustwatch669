import { isAuthorized, jsonResponse, unauthorizedResponse } from "./_shared/auth.js";
import { contentStore, resolveTarget, ValidationError } from "./_shared/store.js";

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

    const store = contentStore();
    const { postId, overridesKey, deletedKey, overrides, deleted, current } = await resolveTarget(
      request, store, isUnnumbered, rawPostId
    );
    if (!current) throw new ValidationError(`POST ${rawPostId} was not found.`);

    // Only blob-media (uploaded live) can be removed from storage here -
    // static archive media isn't reachable from a function.
    for (const m of current.media || []) {
      if (m.path.startsWith("blob-media/")) {
        await store.delete("media/" + m.path.slice("blob-media/".length));
      }
    }

    if (Object.prototype.hasOwnProperty.call(overrides, String(postId))) {
      delete overrides[String(postId)];
      await store.setJSON(overridesKey, overrides);
    }

    if (!deleted.includes(postId)) {
      await store.setJSON(deletedKey, [...deleted, postId]);
    }

    return jsonResponse(200, { success: true, post_id: postId });
  } catch (err) {
    if (err instanceof ValidationError) {
      return jsonResponse(400, { success: false, error: err.message });
    }
    return jsonResponse(500, { success: false, error: `Server error: ${err.message}` });
  }
};

export const config = { path: "/api/delete-post" };
