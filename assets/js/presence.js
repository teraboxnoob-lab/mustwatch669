// Public "N online" badge in the header. Each tab gets a random,
// ephemeral id (sessionStorage - gone when the tab closes, never linked to
// any identity) and pings /api/presence every 20s; the response carries
// back the current aggregate count. Not reachable when just running a
// plain static server (no Netlify Functions) - the badge just stays
// hidden in that case rather than showing a stale number.
(() => {
  const STORAGE_KEY = "mustwatch_visitor_id";
  const HEARTBEAT_MS = 20000;

  function getVisitorId() {
    try {
      let id = sessionStorage.getItem(STORAGE_KEY);
      if (!id) {
        id = randomId();
        sessionStorage.setItem(STORAGE_KEY, id);
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

  async function sendHeartbeat(badge) {
    try {
      const res = await fetch("/api/presence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: getVisitorId() }),
      });
      if (!res.ok) throw new Error("presence unavailable");
      const data = await res.json();
      if (data && data.success) {
        badge.textContent = `🟢 ${data.online} online`;
        badge.classList.add("visible");
      }
    } catch {
      badge.classList.remove("visible");
    }
  }

  function init() {
    const badge = document.getElementById("online-badge");
    if (!badge) return;
    sendHeartbeat(badge);
    setInterval(() => sendHeartbeat(badge), HEARTBEAT_MS);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
