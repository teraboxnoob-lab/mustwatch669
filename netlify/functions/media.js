import { getStore } from "@netlify/blobs";

// Public, same visibility as the static media/ directory it complements —
// media uploaded live through Add Post is just as public as the rest of
// the archive.
export default async (request) => {
  const url = new URL(request.url);
  const suffix = decodeURIComponent(url.pathname.replace(/^\/api\/media\//, ""));
  if (!suffix) return new Response("Not found", { status: 404 });
  // add-post/edit-post store blobs under "media/<postId>/<filename>"; the
  // client's mediaUrl() strips the "blob-media/" path prefix down to
  // "<postId>/<filename>" for the URL, so re-add "media/" here to get back
  // to the actual storage key.
  const key = `media/${suffix}`;

  const store = getStore({ name: "mustwatch", consistency: "strong" });
  const blob = await store.getWithMetadata(key, { type: "arrayBuffer" });
  if (!blob) return new Response("Not found", { status: 404 });

  return new Response(blob.data, {
    headers: {
      "content-type": blob.metadata?.contentType || "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
};

export const config = { path: "/api/media/*" };
