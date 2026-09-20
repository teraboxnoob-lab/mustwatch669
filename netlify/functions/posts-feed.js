import { jsonResponse } from "./_shared/auth.js";
import { contentStore, readJSON } from "./_shared/store.js";

// Public, same visibility as the static JSON it overlays — reading the
// delta of what's been added/edited/deleted live isn't any more sensitive
// than the archive itself, which is already fully public.
export default async () => {
  const store = contentStore();
  const [numberedOverrides, numberedDeleted, unnumberedOverrides, unnumberedDeleted] = await Promise.all([
    readJSON(store, "content/numbered-overrides", {}),
    readJSON(store, "content/numbered-deleted", []),
    readJSON(store, "content/unnumbered-overrides", {}),
    readJSON(store, "content/unnumbered-deleted", []),
  ]);

  return jsonResponse(200, {
    numbered: { overrides: numberedOverrides, deleted: numberedDeleted },
    unnumbered: { overrides: unnumberedOverrides, deleted: unnumberedDeleted },
  });
};

export const config = { path: "/api/posts-feed" };
