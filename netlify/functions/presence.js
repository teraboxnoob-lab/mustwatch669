import { getStore } from "@netlify/blobs";
import { jsonResponse } from "./_shared/auth.js";

// A visitor counts as "online" if their last heartbeat was within this
// window. Client pings every 20s, so 45s comfortably survives one missed
// beat (a slow network hiccup) without flickering the count.
const WINDOW_MS = 45 * 1000;
// Prune heartbeat records once they're well past the window, so the store
// doesn't grow unbounded with visitors who closed the tab.
const PRUNE_AFTER_MS = WINDOW_MS * 4;
const PREFIX = "presence/";
const ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;

// Public, no auth - this only ever reveals an aggregate count, never any
// per-visitor identity.
export default async (request) => {
  let visitorId = "";
  try {
    const body = await request.json();
    visitorId = (body && body.id || "").toString();
  } catch {
    // fall through to the validation error below
  }
  if (!ID_RE.test(visitorId)) {
    return jsonResponse(400, { success: false, error: "Invalid id." });
  }

  const store = getStore({ name: "mustwatch", consistency: "strong" });
  const now = Date.now();
  await store.setJSON(PREFIX + visitorId, { lastSeen: now });

  const { blobs } = await store.list({ prefix: PREFIX });
  let online = 0;
  await Promise.all(
    blobs.map(async (b) => {
      const entry = await store.get(b.key, { type: "json" });
      if (!entry) return;
      const age = now - entry.lastSeen;
      if (age <= WINDOW_MS) {
        online++;
      } else if (age > PRUNE_AFTER_MS) {
        await store.delete(b.key);
      }
    })
  );

  return jsonResponse(200, { success: true, online });
};

export const config = { path: "/api/presence" };
