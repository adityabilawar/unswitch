(function () {
  if (window.__unswitchBlockerLoaded) return;
  window.__unswitchBlockerLoaded = true;

  const BLOCKER_ID = "unswitch-blocker";
  const STORAGE_KEY = "unswitch-state";
  let stateRequest = 0;

  function refreshBlockState() {
    const request = ++stateRequest;
    try {
      if (typeof chrome.runtime?.sendMessage !== "function") {
        setBlocked(false);
        return;
      }
      chrome.runtime.sendMessage({ action: "getTabBlockState" }, (response) => {
        if (request !== stateRequest) return;
        if (!chrome.runtime || chrome.runtime.lastError) {
          setBlocked(false);
          return;
        }
        if (typeof response?.blocked === "boolean") setBlocked(response.blocked);
      });
    } catch (_) {
      // Reloading/updating an extension invalidates scripts in already-open pages.
      setBlocked(false);
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function ensureBlocker() {
    let blocker = document.getElementById(BLOCKER_ID);
    if (blocker) return blocker;

    blocker = document.createElement("div");
    blocker.id = BLOCKER_ID;
    blocker.setAttribute("role", "dialog");
    blocker.setAttribute("aria-modal", "true");
    blocker.setAttribute("aria-labelledby", "unswitch-blocker-title");
    blocker.innerHTML = `
      <div class="unswitch-blocker-shell">
        <div class="unswitch-blocker-orb" aria-hidden="true"></div>
        <div class="unswitch-blocker-card">
          <span class="unswitch-blocker-icon">Locked</span>
          <h1 class="unswitch-blocker-title" id="unswitch-blocker-title">Tab Locked</h1>
          <p class="unswitch-blocker-message">
            Return to your focus tab or unlock Tab Lock to keep browsing.
          </p>
          <p class="unswitch-blocker-task" hidden></p>
        </div>
      </div>
    `;

    if (document.documentElement) {
      document.documentElement.appendChild(blocker);
    } else {
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          if (!document.getElementById(BLOCKER_ID) && document.documentElement) {
            document.documentElement.appendChild(blocker);
          }
        },
        { once: true }
      );
    }

    return blocker;
  }

  async function refreshBlockerContent() {
    const blocker = ensureBlocker();
    if (!blocker) return;

    const taskEl = blocker.querySelector(".unswitch-blocker-task");
    if (!taskEl) return;

    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const taskText = (result[STORAGE_KEY]?.taskText || "").trim();
      if (taskText) {
        taskEl.hidden = false;
        taskEl.innerHTML = `Focus: ${escapeHtml(taskText)}`;
      } else {
        taskEl.hidden = true;
        taskEl.textContent = "";
      }
    } catch (_) {
      taskEl.hidden = true;
      taskEl.textContent = "";
    }
  }

  function setBlocked(isBlocked) {
    const existing = document.getElementById(BLOCKER_ID);
    if (!isBlocked) {
      existing?.remove();
      document.documentElement?.classList.remove("unswitch-blocked");
      document.body?.classList.remove("unswitch-blocked");
      return;
    }

    const blocker = existing || ensureBlocker();
    if (!blocker) return;

    blocker.classList.toggle("unswitch-blocker-active", Boolean(isBlocked));
    document.documentElement?.classList.toggle("unswitch-blocked", Boolean(isBlocked));
    document.body?.classList.toggle("unswitch-blocked", Boolean(isBlocked));

    if (isBlocked) {
      refreshBlockerContent();
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.action === "unswitch-set-block-state") {
      // A delayed message from a previous session must not re-lock this page.
      refreshBlockState();
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[STORAGE_KEY]) return;
    const next = changes[STORAGE_KEY].newValue;
    const active = next?.mode === "locked" ||
      (next?.mode === "pomodoro" && next?.pomodoroState === "focus");
    if (!active) {
      ++stateRequest;
      setBlocked(false);
    } else {
      refreshBlockState();
    }
  });
  window.addEventListener("pageshow", refreshBlockState);
  window.addEventListener("focus", refreshBlockState);
  refreshBlockState();
})();
