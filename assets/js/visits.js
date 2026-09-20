// Public "visits today" stat pill on the home page. Each browser gets a
// random, anonymous id kept in localStorage (never linked to any identity -
// just enough to avoid counting the same browser twice in one day) and
// reports it once per page load to /api/visits, which counts distinct ids
// seen since UTC midnight. Not reachable under scripts/local_server.py -
// the pill just keeps its placeholder text in that case.
(() => {
  const STORAGE_KEY = "mustwatch_device_id";

  function getDeviceId() {
    try {
      let id = localStorage.getItem(STORAGE_KEY);
      if (!id) {
        id = randomId();
        localStorage.setItem(STORAGE_KEY, id);
      }
      return id;
    } catch {
      return randomId();
    }
  }

  function randomId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
    return `${Date.now()}${Math.random().toString(36).slice(2)}`;
  }

  async function reportVisit(el) {
    try {
      const res = await fetch("/api/visits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: getDeviceId() }),
      });
      if (!res.ok) throw new Error("visits unavailable");
      const data = await res.json();
      if (data && data.success) el.textContent = data.visits;
    } catch {
      // Leave the placeholder text as-is rather than showing 0/wrong.
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const el = document.getElementById("stat-visits-today");
    if (el) reportVisit(el);
  });
})();
