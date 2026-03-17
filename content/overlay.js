/**
 * Unswitch - Black screen overlay injected into non-locked tabs
 * Shown briefly when user tries to switch away from locked tab
 */

(function () {
  if (document.getElementById("unswitch-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "unswitch-overlay";
  overlay.innerHTML = `
    <div class="unswitch-overlay-content">
      <span class="unswitch-overlay-icon">🔒</span>
      <span class="unswitch-overlay-text">Tab Locked</span>
      <span class="unswitch-overlay-subtext">Returning to your focus tab...</span>
    </div>
  `;

  document.body.appendChild(overlay);

  setTimeout(() => {
    overlay.remove();
  }, 2000);
})();
