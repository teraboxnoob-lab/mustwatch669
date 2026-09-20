// Login is fully manual and explicit: nothing on the site ever triggers a
// login prompt on its own. An "Access" button (shown whenever you're not
// logged in) opens a small custom form; only submitting that form checks
// credentials. Successful login is remembered in sessionStorage (cleared
// when the tab closes) and manually attached to protected requests —
// deliberately NOT using the browser's native Basic Auth popup, which is
// what used to fire unprompted just from visiting add-post.html.
const Auth = (() => {
  const STORAGE_KEY = "mustwatch_auth_header";

  function getHeader() {
    try { return sessionStorage.getItem(STORAGE_KEY); } catch (_) { return null; }
  }

  function isLoggedIn() {
    return !!getHeader();
  }

  async function login(email, password) {
    const header = "Basic " + btoa(`${email}:${password}`);
    try {
      const res = await fetch("/api/whoami", { headers: { Authorization: header } });
      const result = await res.json();
      if (!result.authenticated) return false;
      sessionStorage.setItem(STORAGE_KEY, header);
      return true;
    } catch (_) {
      return false;
    }
  }

  function logout() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (_) {}
  }

  async function authFetch(url, options = {}) {
    const header = getHeader();
    const headers = Object.assign({}, options.headers || {}, header ? { Authorization: header } : {});
    return fetch(url, Object.assign({}, options, { headers }));
  }

  function ensureModal() {
    if (document.getElementById("auth-modal")) return;
    const wrap = document.createElement("div");
    wrap.id = "auth-modal";
    wrap.className = "auth-modal-overlay";
    wrap.innerHTML = `
      <div class="auth-modal">
        <div class="auth-modal-title">Access</div>
        <form id="auth-modal-form">
          <input type="email" id="auth-email" class="text-field" placeholder="Email" autocomplete="username" required />
          <input type="password" id="auth-password" class="text-field" placeholder="Password" autocomplete="current-password" required style="margin-top:10px" />
          <div class="form-status error" id="auth-error"></div>
          <div class="auth-modal-actions">
            <button type="button" class="nav-btn" id="auth-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary" id="auth-submit" style="margin:0">Log In</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(wrap);

    document.getElementById("auth-cancel").addEventListener("click", closeModal);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) closeModal(); });
    document.getElementById("auth-modal-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("auth-email").value.trim();
      const password = document.getElementById("auth-password").value;
      const errorEl = document.getElementById("auth-error");
      const submitBtn = document.getElementById("auth-submit");
      errorEl.textContent = "";
      submitBtn.disabled = true;
      submitBtn.textContent = "Checking…";
      const ok = await login(email, password);
      submitBtn.disabled = false;
      submitBtn.textContent = "Log In";
      if (ok) {
        window.location.reload();
      } else {
        errorEl.textContent = "Incorrect email or password.";
      }
    });
  }

  function openModal() {
    ensureModal();
    document.getElementById("auth-modal").classList.add("open");
    document.getElementById("auth-email").focus();
  }

  function closeModal() {
    const modal = document.getElementById("auth-modal");
    if (modal) modal.classList.remove("open");
  }

  function renderNavState() {
    document.querySelectorAll(".nav-add-post").forEach((el) => { el.style.display = isLoggedIn() ? "" : "none"; });
    document.querySelectorAll(".nav-access-btn").forEach((el) => { el.style.display = isLoggedIn() ? "none" : ""; });
    document.querySelectorAll(".nav-logout-btn").forEach((el) => { el.style.display = isLoggedIn() ? "" : "none"; });
  }

  function initNav() {
    renderNavState();
    document.querySelectorAll(".nav-access-btn").forEach((btn) => btn.addEventListener("click", openModal));
    document.querySelectorAll(".nav-logout-btn").forEach((btn) => btn.addEventListener("click", () => {
      logout();
      window.location.href = "index.html";
    }));
  }

  document.addEventListener("DOMContentLoaded", initNav);

  return { isLoggedIn, login, logout, authFetch, openModal };
})();
