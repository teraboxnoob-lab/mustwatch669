import { getStore } from "@netlify/blobs";
import { jsonResponse } from "./_shared/auth.js";

const ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;

// UTC calendar day - simple, unambiguous "today" boundary shared by every
// visitor regardless of their own timezone.
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// Public, no auth - only ever reveals an aggregate count, never any
// per-visitor identity. One marker per (day, visitorId) makes this a count
// of *unique* visitors today, not raw page-load hits: reloading the same
// day doesn't inflate the number.
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
  const today = todayKey();
  const todayPrefix = `visits/${today}/`;
  const key = todayPrefix + visitorId;

  const alreadyMarked = (await store.get(key)) !== null;
  if (!alreadyMarked) {
    await store.set(key, "1");
  }

  // Prune markers from previous days so the store doesn't grow forever -
  // this keeps it down to roughly one day's worth of unique-visitor keys.
  const { blobs } = await store.list({ prefix: "visits/" });
  let visits = 0;
  await Promise.all(
    blobs.map(async (b) => {
      if (b.key.startsWith(todayPrefix)) {
        visits++;
      } else {
        await store.delete(b.key);
      }
    })
  );

  return jsonResponse(200, { success: true, date: today, visits });
};

export const config = { path: "/api/visits" };
