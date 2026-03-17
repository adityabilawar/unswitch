(function () {
  if (window.__unswitchBlockerLoaded) return;
  window.__unswitchBlockerLoaded = true;

  const BLOCKER_ID = "unswitch-blocker";

  function ensureBlocker() {
    let blocker = document.getElementById(BLOCKER_ID);
    if (blocker) return blocker;

    blocker = document.createElement("div");
    blocker.id = BLOCKER_ID;
    blocker.setAttribute("aria-hidden", "true");

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

  function setBlocked(isBlocked) {
    const blocker = ensureBlocker();
    if (!blocker) return;

    blocker.classList.toggle("unswitch-blocker-active", Boolean(isBlocked));
    document.documentElement?.classList.toggle("unswitch-blocked", Boolean(isBlocked));
    document.body?.classList.toggle("unswitch-blocked", Boolean(isBlocked));
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.action === "unswitch-set-block-state") {
      setBlocked(message.blocked);
    }
  });

  ensureBlocker();

  chrome.runtime.sendMessage({ action: "getTabBlockState" }, (response) => {
    if (chrome.runtime.lastError) return;
    setBlocked(response?.blocked);
  });
})();
