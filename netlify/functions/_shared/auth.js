import { timingSafeEqual } from "node:crypto";

function safeEqual(a, b) {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function isAuthorized(request) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Basic ")) return false;

  let decoded;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf-8");
  } catch {
    return false;
  }

  const sep = decoded.indexOf(":");
  if (sep === -1) return false;
  const email = decoded.slice(0, sep);
  const password = decoded.slice(sep + 1);

  const expectedEmail = process.env.AUTH_EMAIL || "";
  const expectedPassword = process.env.AUTH_PASSWORD || "";
  if (!expectedEmail || !expectedPassword) return false;

  return safeEqual(email, expectedEmail) && safeEqual(password, expectedPassword);
}

// Deliberately a 200 with {"success": false}, not an HTTP 401 — mirrors
// scripts/local_server.py's _require_auth. A bare 401 on a fetch()-initiated
// request was observed to hang indefinitely in Chrome even though curl and
// Node's fetch handle the same response instantly, so "not authorized" is
// encoded in the JSON body instead of the status code.
export function unauthorizedResponse() {
  return jsonResponse(200, { success: false, authenticated: false, error: "Not authorized." });
}

export function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
