/**
 * Warn before navigating away from the current site (hostname / subdomain tree).
 * e.g. on docs.langchain.com, clicking a link to google.com shows a confirm dialog.
 * Always active — no opt-in required.
 */
(function () {
  if (window.__unswitchLeaveDomainInit) return;
  window.__unswitchLeaveDomainInit = true;

  let pageHostname = "";
  let clickHandler = null;

  function isSameSiteHost(a, b) {
    if (!a || !b) return true;
    const p = String(a).toLowerCase();
    const t = String(b).toLowerCase();
    if (p === t) return true;
    if (p.endsWith("." + t) || t.endsWith("." + p)) return true;
    return false;
  }

  function findAnchor(el) {
    let n = el;
    for (let i = 0; i < 8 && n; i += 1) {
      if (n.tagName === "A" && n.href) return n;
      n = n.parentElement;
    }
    return null;
  }

  function shouldInterceptNavigation(url) {
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return !isSameSiteHost(pageHostname, url.hostname);
  }

  function messageFor(url) {
    const dest = url.hostname + (url.pathname === "/" ? "" : url.pathname);
    return `You are about to leave ${pageHostname} and open:\n\n${dest}\n\nContinue?`;
  }

  function onLinkClickCapture(e) {
    if (e.button !== 0 && e.button !== 1) return;
    const a = findAnchor(e.target);
    if (!a) return;
    let url;
    try {
      url = new URL(a.href, location.href);
    } catch (_) {
      return;
    }
    if (!shouldInterceptNavigation(url)) return;
    if (!window.confirm(messageFor(url))) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  function attach() {
    if (clickHandler) return;
    pageHostname = location.hostname || "";
    clickHandler = onLinkClickCapture;
    document.addEventListener("click", clickHandler, true);
    document.addEventListener("auxclick", clickHandler, true);
  }

  attach();
})();
