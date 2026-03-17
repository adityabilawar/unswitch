/**
 * Unswitch - Black screen overlay injected into non-locked tabs
 * Shown briefly when user tries to switch away from locked tab
 */

(async function () {
  if (document.getElementById("unswitch-overlay")) return;

  const result = await chrome.storage.local.get("unswitch-state");
  const state = result["unswitch-state"] || {};
  const taskText = (state.taskText || "").trim();

  const overlay = document.createElement("div");
  overlay.id = "unswitch-overlay";
  overlay.innerHTML = `
    <div class="unswitch-overlay-content">
      <span class="unswitch-overlay-icon">🔒</span>
      <span class="unswitch-overlay-text">Tab Locked</span>
      ${taskText ? `<span class="unswitch-overlay-task">${taskText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")}</span>` : ""}
      <span class="unswitch-overlay-subtext">Returning to your focus tab...</span>
    </div>
  `;

  document.body.appendChild(overlay);

  setTimeout(() => {
    overlay.remove();
  }, 2000);
})();
