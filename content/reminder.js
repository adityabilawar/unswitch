/**
 * Unswitch - Draggable task reminder banner (injected into locked tab)
 */

(async function () {
  const existingBanner = document.getElementById("unswitch-reminder");
  if (existingBanner) existingBanner.remove();

  const { "unswitch-state": state, "unswitch-reminder-position": savedPos } =
    await chrome.storage.local.get(["unswitch-state", "unswitch-reminder-position"]);
  const taskText = (state?.taskText || "").trim();
  if (!taskText) return;

  const escaped = taskText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const banner = document.createElement("div");
  banner.id = "unswitch-reminder";
  banner.innerHTML = `
    <div class="unswitch-reminder-label">Current task · drag to move</div>
    <div class="unswitch-reminder-text">${escaped}</div>
  `;

  if (savedPos && typeof savedPos.top === "number" && typeof savedPos.left === "number") {
    banner.style.top = savedPos.top + "px";
    banner.style.left = savedPos.left + "px";
    banner.style.transform = "none";
  }

  let activePointerId = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let elStartX = 0;
  let elStartY = 0;

  function clampPosition(left, top) {
    const maxLeft = Math.max(0, window.innerWidth - banner.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - banner.offsetHeight);
    return {
      left: Math.max(0, Math.min(maxLeft, left)),
      top: Math.max(0, Math.min(maxTop, top)),
    };
  }

  function applyPosition(left, top) {
    const next = clampPosition(left, top);
    banner.style.left = next.left + "px";
    banner.style.top = next.top + "px";
    banner.style.transform = "none";
  }

  function saveCurrentPosition() {
    const rect = banner.getBoundingClientRect();
    chrome.storage.local.set({
      "unswitch-reminder-position": { top: rect.top, left: rect.left },
    });
  }

  function onPointerDown(e) {
    if (!e.isPrimary) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;

    e.preventDefault();
    const rect = banner.getBoundingClientRect();
    activePointerId = e.pointerId;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    elStartX = rect.left;
    elStartY = rect.top;
    banner.classList.add("unswitch-reminder-dragging");
    banner.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (e.pointerId !== activePointerId) return;

    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    applyPosition(elStartX + dx, elStartY + dy);
  }

  function endDrag(e) {
    if (e.pointerId !== activePointerId) return;

    activePointerId = null;
    banner.classList.remove("unswitch-reminder-dragging");
    saveCurrentPosition();
  }

  function onDoubleClick() {
    chrome.storage.local.remove("unswitch-reminder-position");
    banner.style.top = "";
    banner.style.left = "";
    banner.style.transform = "";
  }

  function handleResize() {
    if (!banner.style.left || !banner.style.top || banner.style.transform !== "none") return;
    const rect = banner.getBoundingClientRect();
    applyPosition(rect.left, rect.top);
    saveCurrentPosition();
  }

  banner.addEventListener("pointerdown", onPointerDown);
  banner.addEventListener("pointermove", onPointerMove);
  banner.addEventListener("pointerup", endDrag);
  banner.addEventListener("pointercancel", endDrag);
  banner.addEventListener("lostpointercapture", endDrag);
  banner.addEventListener("dblclick", onDoubleClick);
  window.addEventListener("resize", handleResize);
  document.body.appendChild(banner);
})();
