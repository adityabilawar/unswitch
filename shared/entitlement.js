/**
 * Pure license decisions. The extension caches a server result and rechecks it.
 * A canceled subscription stays Pro until the period that was already paid ends.
 */
(function (factory) {
  const api = factory();
  const root = typeof globalThis !== "undefined" ? globalThis : this;
  root.TabLockEntitlement = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(function () {
  const OPEN_STATUSES = new Set(["active", "trialing", "canceled"]);

  function periodOpen(record, now) {
    if (record.currentPeriodEnd == null) return record.plan === "lifetime";
    return typeof record.currentPeriodEnd === "number" && record.currentPeriodEnd > now;
  }

  function isEntitled(record, now) {
    if (!record || typeof record !== "object") return { pro: false, reason: "none" };
    const status = record.status || "";
    const plan = record.plan || "";
    if (plan === "lifetime" && (status === "active" || status === "paid")) {
      return { pro: true, plan, status: "active", currentPeriodEnd: null, reason: "lifetime" };
    }
    if (!OPEN_STATUSES.has(status) || !periodOpen(record, now)) {
      return {
        pro: false,
        plan: plan || null,
        status: status || "inactive",
        currentPeriodEnd: record.currentPeriodEnd ?? null,
        reason: status ? "expired" : "none",
      };
    }
    return {
      pro: true,
      plan,
      status,
      currentPeriodEnd: record.currentPeriodEnd ?? null,
      reason: status,
    };
  }

  /**
   * Cached access lasts through the offline grace window.
   * After that the extension treats the install as Free until the server answers.
   */
  function hasCachedAccess(record, now, revalidateMs, graceMs) {
    const decision = isEntitled(record, now);
    if (!decision.pro) return { ...decision, stale: false };
    if (typeof record.checkedAt !== "number") {
      return { pro: false, plan: decision.plan, status: decision.status, reason: "unchecked", stale: false };
    }
    const age = now - record.checkedAt;
    if (age < 0 || age <= revalidateMs) return { ...decision, stale: false };
    if (age <= graceMs) return { ...decision, stale: true };
    return {
      pro: false,
      plan: decision.plan,
      status: decision.status,
      currentPeriodEnd: decision.currentPeriodEnd,
      reason: "stale",
      stale: true,
    };
  }

  return { isEntitled, hasCachedAccess };
});
