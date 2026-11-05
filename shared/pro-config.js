/**
 * Prices and license timing shared by the extension and the license server.
 * Change a price here, then reload the extension and redeploy the server.
 * The extension never reads Stripe secret keys.
 */
(function (factory) {
  const api = factory();
  const root = typeof globalThis !== "undefined" ? globalThis : this;
  root.TabLockProConfig = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(function () {
  const PLANS = {
    monthly: {
      id: "monthly",
      label: "Monthly",
      amountCents: 299,
      currency: "usd",
      mode: "subscription",
      interval: "month",
      trialDays: 0,
    },
    yearly: {
      id: "yearly",
      label: "Yearly",
      amountCents: 1999,
      currency: "usd",
      mode: "subscription",
      interval: "year",
      trialDays: 7,
    },
    lifetime: {
      id: "lifetime",
      label: "Lifetime",
      amountCents: 2999,
      currency: "usd",
      mode: "payment",
      trialDays: 0,
    },
  };

  /** Set this to the deployed license server origin before publishing the extension. */
  const API_BASE = "";

  const REVALIDATE_MS = 6 * 60 * 60 * 1000;
  const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
  const PASSWORD_ITERATIONS = 20000;

  function formatMoney(cents) {
    const amount = Number(cents) || 0;
    const dollars = Math.floor(amount / 100);
    const remainder = String(Math.abs(amount) % 100).padStart(2, "0");
    return `$${dollars}.${remainder}`;
  }

  function planSummary(plan) {
    if (!plan) return "";
    if (plan.mode === "payment") return `${formatMoney(plan.amountCents)} once`;
    const period = plan.interval === "year" ? "year" : "month";
    const trial = plan.trialDays ? `, ${plan.trialDays}-day trial` : "";
    return `${formatMoney(plan.amountCents)}/${period}${trial}`;
  }

  function listPlans() {
    return ["monthly", "yearly", "lifetime"].map((id) => {
      const plan = PLANS[id];
      return { ...plan, summary: planSummary(plan) };
    });
  }

  function getPlan(id) {
    return PLANS[id] || null;
  }

  return {
    PLANS,
    API_BASE,
    REVALIDATE_MS,
    OFFLINE_GRACE_MS,
    PASSWORD_ITERATIONS,
    formatMoney,
    planSummary,
    listPlans,
    getPlan,
  };
});
