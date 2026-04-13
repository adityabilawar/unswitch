/**
 * Unswitch - Guided breathing ritual shown before the locked tab screen.
 */

(async function () {
  if (document.getElementById("unswitch-overlay")) return;

  const BREATH_DURATION_MS = 10000;
  const LOCKED_MESSAGE_DELAY_MS = 900;
  const result = await chrome.storage.local.get("unswitch-state");
  const state = result["unswitch-state"] || {};
  const taskText = (state.taskText || "").trim();
  const escapeHtml = (value) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const overlay = document.createElement("div");
  overlay.id = "unswitch-overlay";
  overlay.className = "unswitch-overlay-breathe-in";
  overlay.innerHTML = `
    <div class="unswitch-overlay-content unswitch-overlay-ritual">
      <div class="unswitch-breath-visual" aria-hidden="true">
        <div class="unswitch-breath-ring"></div>
        <div class="unswitch-breath-core"></div>
      </div>
      <span class="unswitch-overlay-kicker">Pause</span>
      <span class="unswitch-overlay-text unswitch-overlay-phase">Breathe in</span>
      <span class="unswitch-overlay-countdown">10s</span>
      ${taskText ? `<span class="unswitch-overlay-task">${escapeHtml(taskText)}</span>` : ""}
      <span class="unswitch-overlay-subtext">Stay with the animation for 10 seconds.</span>
    </div>
    <div class="unswitch-overlay-content unswitch-overlay-locked-screen" hidden>
      <span class="unswitch-overlay-icon">Locked</span>
      <span class="unswitch-overlay-text">Tab Locked</span>
      ${taskText ? `<span class="unswitch-overlay-task">${escapeHtml(taskText)}</span>` : ""}
      <span class="unswitch-overlay-subtext">Return to your focus tab when you're ready.</span>
    </div>
  `;

  (document.body || document.documentElement)?.appendChild(overlay);

  const ritualScreen = overlay.querySelector(".unswitch-overlay-ritual");
  const lockedScreen = overlay.querySelector(".unswitch-overlay-locked-screen");
  const phaseEl = overlay.querySelector(".unswitch-overlay-phase");
  const countdownEl = overlay.querySelector(".unswitch-overlay-countdown");
  const timers = [];

  function clearTimers() {
    while (timers.length) {
      const timerId = timers.pop();
      clearTimeout(timerId);
      clearInterval(timerId);
    }
  }

  function teardownOverlay() {
    clearTimers();
    chrome.runtime.onMessage.removeListener(handleMessage);
    overlay.remove();
  }

  function updateBreathUi() {
    const elapsed = Date.now() - startTime;
    const remainingMs = Math.max(0, BREATH_DURATION_MS - elapsed);
    const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
    const isExhale = elapsed >= BREATH_DURATION_MS / 2;

    overlay.classList.toggle("unswitch-overlay-breathe-in", !isExhale);
    overlay.classList.toggle("unswitch-overlay-breathe-out", isExhale);

    if (phaseEl) {
      phaseEl.textContent = isExhale ? "Breathe out" : "Breathe in";
    }

    if (countdownEl) {
      countdownEl.textContent = `${remainingSeconds}s`;
    }
  }

  function handleMessage(message) {
    if (message?.action === "unswitch-set-block-state" && !message.blocked) {
      teardownOverlay();
    }
  }

  chrome.runtime.onMessage.addListener(handleMessage);

  const startTime = Date.now();
  updateBreathUi();

  const intervalId = window.setInterval(() => {
    updateBreathUi();
    if (Date.now() - startTime >= BREATH_DURATION_MS) {
      window.clearInterval(intervalId);
    }
  }, 200);
  timers.push(intervalId);

  timers.push(
    window.setTimeout(() => {
      overlay.classList.remove("unswitch-overlay-breathe-in", "unswitch-overlay-breathe-out");
      overlay.classList.add("unswitch-overlay-show-locked");
      if (ritualScreen) ritualScreen.hidden = true;
      if (lockedScreen) lockedScreen.hidden = false;

      timers.push(window.setTimeout(teardownOverlay, LOCKED_MESSAGE_DELAY_MS));
    }, BREATH_DURATION_MS)
  );
})();
