import { getStore } from "@netlify/blobs";

const STORE_NAME = "mustwatch";

// Strong consistency: an add/edit/delete must be immediately visible to the
// very next posts-feed read (default eventual consistency can lag up to 60s,
// which would make the "appears immediately, no redeploy" behavior flaky).
export function contentStore() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

export async function readJSON(store, key, fallback) {
  const value = await store.get(key, { type: "json" });
  return value ?? fallback;
}

export function extractLinks(text) {
  const matches = text.match(/https?:\/\/\S+/g) || [];
  const seen = new Set();
  const out = [];
  for (let u of matches) {
    u = u.replace(/[).,!?'’”]+$/, "");
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}

export function mediaType(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  return ["mp4", "mov", "webm", "mkv"].includes(ext) ? "video" : "image";
}

export function safeFileName(name) {
  return name.replace(/[^A-Za-z0-9._-]/g, "_");
}

export async function fetchBase(request, path) {
  const res = await fetch(new URL(path, request.url));
  if (!res.ok) return [];
  return res.json();
}

// Thrown for bad input; handlers catch this and respond 400 with .message,
// mirroring local_server.py's ValueError -> 400 pattern.
export class ValidationError extends Error {}

// Merges the static base array with the Blobs overrides/deleted delta and
// resolves one target post by id, for edit/delete. Returns undefined
// `current` if the post doesn't exist (or was deleted) anywhere.
export async function resolveTarget(request, store, isUnnumbered, rawPostId) {
  const overridesKey = isUnnumbered ? "content/unnumbered-overrides" : "content/numbered-overrides";
  const deletedKey = isUnnumbered ? "content/unnumbered-deleted" : "content/numbered-deleted";
  const basePath = isUnnumbered ? "/data/website-posts-unnumbered.json" : "/data/website-posts.json";

  let postId;
  if (isUnnumbered) {
    postId = (rawPostId || "").trim();
    if (!postId) throw new ValidationError("Post id is required.");
  } else {
    if (!/^\d+$/.test((rawPostId || "").trim())) {
      throw new ValidationError("Post number must be a positive integer.");
    }
    postId = parseInt(rawPostId, 10);
  }

  const [overrides, deleted, basePosts] = await Promise.all([
    readJSON(store, overridesKey, {}),
    readJSON(store, deletedKey, []),
    fetchBase(request, basePath),
  ]);

  const isDeleted = deleted.includes(postId);
  const overrideEntry = overrides[String(postId)];
  const baseEntry = basePosts.find((p) => p.post_id === postId);
  const current = isDeleted ? undefined : overrideEntry || baseEntry;

  return { postId, overridesKey, deletedKey, basePath, overrides, deleted, current };
}
