const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const { buildCheckoutParams } = require("../server/lib/license");
const { route } = require("../server/lib/handlers");
const { verifyStripeSignature } = require("../server/lib/stripe");

const INSTALL_ID = "11111111-1111-4111-8111-111111111111";
const env = {
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  LICENSE_SIGNING_SECRET: "test-signing-secret-value",
  PUBLIC_BASE_URL: "https://license.example",
};

function createMemoryStripe() {
  const customers = new Map();
  const sessions = new Map();
  const subscriptions = new Map();
  const calls = [];
  return {
    customers,
    sessions,
    subscriptions,
    calls,
    async impl({ method, path, params }) {
      calls.push({ method, path, params: { ...params } });
      if (method === "POST" && path === "/v1/checkout/sessions") {
        const n = sessions.size + 1;
        const mode = params.mode;
        const id = `cs_test_${n}`;
        const customerId = `cus_test_${n}`;
        const subscriptionId = mode === "subscription" ? `sub_test_${n}` : "";
        const trialDays = Number(params["subscription_data[trial_period_days]"] || 0);
        const session = {
          id,
          url: `https://checkout.stripe.com/c/pay/${id}`,
          mode,
          customer: customerId,
          client_reference_id: params.client_reference_id,
          metadata: {
            installId: params["metadata[installId]"],
            plan: params["metadata[plan]"],
          },
          subscription: subscriptionId || null,
          payment_status: trialDays ? "no_payment_required" : "paid",
          status: "complete",
        };
        sessions.set(id, session);
        customers.set(customerId, { id: customerId, metadata: {} });
        if (subscriptionId) {
          subscriptions.set(subscriptionId, {
            id: subscriptionId,
            customer: customerId,
            status: trialDays ? "trialing" : "active",
            current_period_end: Math.floor(Date.now() / 1000) + (trialDays || 30) * 86400,
            metadata: { plan: params["metadata[plan]"] },
          });
        }
        return session;
      }
      const customerMatch = path.match(/^\/v1\/customers\/(cus_test_[^/]+)$/);
      if (customerMatch && method === "POST") {
        const customer = customers.get(customerMatch[1]) || { id: customerMatch[1], metadata: {} };
        const metadata = { ...(customer.metadata || {}) };
        for (const [key, value] of Object.entries(params || {})) {
          const match = /^metadata\[(.+)\]$/.exec(key);
          if (match) metadata[match[1]] = String(value);
        }
        customer.metadata = metadata;
        customers.set(customer.id, customer);
        return customer;
      }
      if (customerMatch && method === "GET") return customers.get(customerMatch[1]) || null;
      if (method === "GET" && path === "/v1/customers/search") {
        const match = /metadata\['installId'\]:'([^']+)'/.exec(params.query || "");
        const installId = match?.[1];
        return { data: [...customers.values()].filter((customer) => customer.metadata?.installId === installId) };
      }
      const subscriptionMatch = path.match(/^\/v1\/subscriptions\/(sub_test_[^/]+)$/);
      if (subscriptionMatch && method === "GET") return subscriptions.get(subscriptionMatch[1]);
      const sessionMatch = path.match(/^\/v1\/checkout\/sessions\/(cs_test_[^/]+)$/);
      if (sessionMatch && method === "GET") return sessions.get(sessionMatch[1]);
      throw new Error(`Unexpected Stripe call ${method} ${path}`);
    },
  };
}

function sign(payload, timestamp = Math.floor(Date.now() / 1000)) {
  const digest = crypto.createHmac("sha256", env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${payload}`).digest("hex");
  return { header: `t=${timestamp},v1=${digest}`, timestamp };
}

async function postJson(pathname, body, extraEnv = env, stripe) {
  return route(
    { method: "POST", url: pathname, headers: { "content-type": "application/json" }, rawBody: JSON.stringify(body) },
    { env: extraEnv, stripeImpl: stripe?.impl }
  );
}

test("checkout uses config prices and only the yearly plan gets a trial", () => {
  const yearly = buildCheckoutParams({ planId: "yearly", installId: INSTALL_ID, base: "https://license.example", env });
  const monthly = buildCheckoutParams({ planId: "monthly", installId: INSTALL_ID, base: "https://license.example", env });
  const lifetime = buildCheckoutParams({ planId: "lifetime", installId: INSTALL_ID, base: "https://license.example", env });
  assert.equal(yearly["line_items[0][price_data][unit_amount]"], 1999);
  assert.equal(yearly["subscription_data[trial_period_days]"], 7);
  assert.equal(yearly.mode, "subscription");
  assert.equal(monthly["line_items[0][price_data][unit_amount]"], 299);
  assert.equal(monthly["subscription_data[trial_period_days]"], undefined);
  assert.equal(lifetime.mode, "payment");
  assert.equal(lifetime["line_items[0][price_data][unit_amount]"], 2999);
  assert.equal(lifetime.customer_creation, "always");
  assert.equal(yearly.success_url.includes("{CHECKOUT_SESSION_ID}"), true);
});

test("live Stripe keys and live price ids are refused", async () => {
  const stripe = createMemoryStripe();
  const live = await postJson("/api/checkout", { plan: "monthly", installId: INSTALL_ID }, {
    ...env,
    STRIPE_SECRET_KEY: "sk_live_secret",
  }, stripe);
  assert.equal(live.status, 400);
  assert.match(JSON.parse(live.body).error, /test secret key/);
  assert.equal(stripe.calls.length, 0);

  const priced = buildCheckoutParams({
    planId: "yearly",
    installId: INSTALL_ID,
    base: "https://license.example",
    env: { ...env, STRIPE_PRICE_YEARLY: "price_test_year" },
  });
  assert.equal(priced["line_items[0][price]"], "price_test_year");
  assert.equal(priced["line_items[0][price_data][unit_amount]"], undefined);
  assert.throws(() => buildCheckoutParams({
    planId: "yearly",
    installId: INSTALL_ID,
    base: "https://license.example",
    env: { ...env, STRIPE_PRICE_YEARLY: "price_live_year" },
  }), /price_test_/);
});

test("a signed webhook activates a yearly trial and a later cancel can expire", async () => {
  const stripe = createMemoryStripe();
  const checkout = await postJson("/api/checkout", { plan: "yearly", installId: INSTALL_ID }, env, stripe);
  assert.equal(checkout.status, 200);
  const sessionId = JSON.parse(checkout.body).id;
  const payload = JSON.stringify({
    type: "checkout.session.completed",
    data: { object: stripe.sessions.get(sessionId) },
  });
  const signed = sign(payload);
  const bad = await route(
    { method: "POST", url: "/api/webhook", headers: { "stripe-signature": "t=1,v1=nope" }, rawBody: payload },
    { env, stripeImpl: stripe.impl, now: signed.timestamp * 1000 }
  );
  assert.equal(bad.status, 400);
  assert.equal(verifyStripeSignature(env.STRIPE_WEBHOOK_SECRET, payload, signed.header, signed.timestamp * 1000), true);

  const webhook = await route(
    { method: "POST", url: "/api/webhook", headers: { "stripe-signature": signed.header }, rawBody: payload },
    { env, stripeImpl: stripe.impl, now: signed.timestamp * 1000 }
  );
  assert.equal(webhook.status, 200);
  const license = await route(
    { method: "GET", url: `/api/license?installId=${INSTALL_ID}`, headers: {}, rawBody: "" },
    { env, stripeImpl: stripe.impl }
  );
  const body = JSON.parse(license.body);
  assert.equal(body.pro, true);
  assert.equal(body.plan, "yearly");
  assert.equal(body.status, "trialing");
  assert.equal(typeof body.token, "string");

  const subscription = stripe.subscriptions.get("sub_test_1");
  subscription.status = "canceled";
  subscription.current_period_end = Math.floor(Date.now() / 1000) - 60;
  const expired = JSON.parse((await route(
    { method: "GET", url: `/api/license?token=${encodeURIComponent(body.token)}`, headers: {}, rawBody: "" },
    { env, stripeImpl: stripe.impl }
  )).body);
  assert.equal(expired.pro, false);
});

test("lifetime checkout and the success page never reveal the signing secret", async () => {
  const stripe = createMemoryStripe();
  const checkout = await postJson("/api/checkout", { plan: "lifetime", installId: INSTALL_ID }, env, stripe);
  const sessionId = JSON.parse(checkout.body).id;
  const page = await route(
    { method: "GET", url: `/api/activate?session_id=${sessionId}`, headers: {}, rawBody: "" },
    { env, stripeImpl: stripe.impl }
  );
  assert.equal(page.status, 200);
  assert.equal(page.body.includes(env.LICENSE_SIGNING_SECRET), false);
  assert.equal(page.body.includes(env.STRIPE_SECRET_KEY), false);
  assert.match(page.body, /Lifetime Pro is active/);
  const license = JSON.parse((await route(
    { method: "GET", url: `/api/license?installId=${INSTALL_ID}`, headers: {}, rawBody: "" },
    { env, stripeImpl: stripe.impl }
  )).body);
  assert.equal(license.pro, true);
  assert.equal(license.plan, "lifetime");
  assert.equal(license.currentPeriodEnd, null);
});

test("health advertises test mode and the uninstall page stores nothing", async () => {
  const health = await route({ method: "GET", url: "/api/health", headers: {}, rawBody: "" }, { env });
  const body = JSON.parse(health.body);
  assert.equal(body.mode, "test");
  assert.equal(body.plans.find((plan) => plan.id === "yearly").trialDays, 7);
  const page = await route({
    method: "GET",
    url: `/api/uninstall?installId=${INSTALL_ID}`,
    headers: {},
    rawBody: "",
  });
  assert.match(page.body, /does not record the visit/);
  assert.match(page.body, new RegExp(INSTALL_ID));
});
