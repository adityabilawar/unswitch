const crypto = require("node:crypto");
const { getPlan } = require("../../shared/pro-config");
const { assertTestId, stripeRequest, httpError } = require("./stripe");

function publicBase(env) {
  const raw = String(env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    throw httpError("Set PUBLIC_BASE_URL to your deployed license server.", 500);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "https:" || (url.protocol === "http:" && local)) return url.origin;
  throw httpError("PUBLIC_BASE_URL must be https, or http://127.0.0.1 for local development.", 500);
}

function isInstallId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");
}

function signingSecret(env) {
  const secret = env.LICENSE_SIGNING_SECRET;
  if (!secret || String(secret).length < 16) {
    throw httpError("Set LICENSE_SIGNING_SECRET to a random string of at least 16 characters.", 500);
  }
  return String(secret);
}

function signLicense(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function readLicense(token, secret) {
  const [body, signature, extra] = String(token || "").split(".");
  if (!body || !signature || extra) return null;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(actualBuf, expectedBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload?.v !== 1) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function priceIdFor(env, planId) {
  const names = {
    monthly: env.STRIPE_PRICE_MONTHLY,
    yearly: env.STRIPE_PRICE_YEARLY,
    lifetime: env.STRIPE_PRICE_LIFETIME,
  };
  const price = String(names[planId] || "").trim();
  if (!price) return "";
  assertTestId(price, "price");
  return price;
}

function buildCheckoutParams({ planId, installId, base, env }) {
  const plan = getPlan(planId);
  if (!plan) throw httpError("Unknown plan.", 400);
  if (!isInstallId(installId)) throw httpError("A valid install id is required.", 400);
  const params = {
    mode: plan.mode,
    success_url: `${base}/api/activate?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/api/activate?canceled=1`,
    client_reference_id: installId,
    "metadata[installId]": installId,
    "metadata[plan]": plan.id,
    "line_items[0][quantity]": 1,
  };
  const priceId = priceIdFor(env, plan.id);
  if (priceId) {
    params["line_items[0][price]"] = priceId;
  } else {
    params["line_items[0][price_data][currency]"] = plan.currency;
    params["line_items[0][price_data][unit_amount]"] = plan.amountCents;
    params["line_items[0][price_data][product_data][name]"] = `Tab Lock Pro (${plan.label})`;
    if (plan.mode === "subscription") {
      params["line_items[0][price_data][recurring][interval]"] = plan.interval;
    }
  }
  if (plan.mode === "subscription") {
    params["subscription_data[metadata][installId]"] = installId;
    params["subscription_data[metadata][plan]"] = plan.id;
    if (plan.trialDays > 0) params["subscription_data[trial_period_days]"] = plan.trialDays;
  } else {
    params.customer_creation = "always";
  }
  return params;
}

function entitlementFromStripe({ plan, subscription, metadata }) {
  const resolvedPlan = plan || metadata?.plan || "";
  if (resolvedPlan === "lifetime") {
    const status = metadata?.licenseStatus || "";
    const pro = status === "active" || status === "paid";
    return { pro, plan: "lifetime", status: pro ? "active" : status || "inactive", currentPeriodEnd: null };
  }
  if (!subscription) {
    return { pro: false, plan: resolvedPlan || null, status: "inactive", currentPeriodEnd: null };
  }
  const endSeconds = subscription.current_period_end || subscription.trial_end || null;
  const currentPeriodEnd = endSeconds ? Number(endSeconds) * 1000 : null;
  const open = typeof currentPeriodEnd === "number" && currentPeriodEnd > Date.now();
  const status = subscription.status || "inactive";
  const pro = open && (status === "active" || status === "trialing" || status === "canceled");
  return { pro, plan: resolvedPlan || null, status, currentPeriodEnd };
}

async function updateCustomerMetadata(env, customerId, metadata, deps) {
  assertTestId(customerId, "cus");
  const params = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value == null || value === "") continue;
    params[`metadata[${key}]`] = String(value);
  }
  return stripeRequest(env, {
    method: "POST",
    path: `/v1/customers/${customerId}`,
    params,
    stripeImpl: deps.stripeImpl,
  });
}

async function retrieveSubscription(env, subscriptionId, deps) {
  if (!subscriptionId) return null;
  assertTestId(subscriptionId, "sub");
  return stripeRequest(env, {
    method: "GET",
    path: `/v1/subscriptions/${subscriptionId}`,
    stripeImpl: deps.stripeImpl,
  });
}

async function grantCheckoutSession(env, session, deps) {
  assertTestId(session.id, "cs");
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const plan = session.metadata?.plan || "";
  const installId = session.metadata?.installId || session.client_reference_id || "";
  if (!isInstallId(installId)) throw httpError("Checkout session is missing a valid install id.", 400);
  if (session.status !== "complete" && session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
    throw httpError("Checkout is not complete.", 402);
  }
  let subscriptionId = "";
  if (session.subscription) {
    subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
  }
  const subscription = subscriptionId ? await retrieveSubscription(env, subscriptionId, deps) : null;
  const decision = entitlementFromStripe({
    plan,
    subscription,
    metadata: { plan, licenseStatus: plan === "lifetime" ? "active" : subscription?.status },
  });
  if (!decision.pro && plan !== "lifetime") {
    // A trial or active subscription should already be pro. Keep the metadata current either way.
  }
  if (plan === "lifetime" && !decision.pro) {
    decision.pro = true;
    decision.status = "active";
    decision.plan = "lifetime";
  }
  await updateCustomerMetadata(
    env,
    customerId,
    {
      installId,
      plan,
      licenseStatus: decision.status,
      subscriptionId,
      currentPeriodEnd: decision.currentPeriodEnd || "",
    },
    deps
  );
  return { customerId, subscriptionId, installId, decision };
}

async function findCustomer(env, installId, deps) {
  const result = await stripeRequest(env, {
    method: "GET",
    path: "/v1/customers/search",
    params: { query: `metadata['installId']:'${installId}'` },
    stripeImpl: deps.stripeImpl,
  });
  return result?.data?.[0] || null;
}

async function decisionForCustomer(env, customer, deps) {
  if (!customer) return { pro: false, plan: null, status: "inactive", currentPeriodEnd: null };
  const metadata = customer.metadata || {};
  const plan = metadata.plan || "";
  if (plan === "lifetime") return entitlementFromStripe({ plan, metadata, subscription: null });
  const subscription = metadata.subscriptionId
    ? await retrieveSubscription(env, metadata.subscriptionId, deps)
    : null;
  return entitlementFromStripe({ plan, metadata, subscription });
}

function issueToken(env, { installId, customerId, subscriptionId, decision }) {
  return signLicense(
    {
      v: 1,
      installId,
      customerId,
      subscriptionId: subscriptionId || "",
      plan: decision.plan,
      iat: Date.now(),
    },
    signingSecret(env)
  );
}

module.exports = {
  publicBase,
  isInstallId,
  signLicense,
  readLicense,
  buildCheckoutParams,
  entitlementFromStripe,
  grantCheckoutSession,
  findCustomer,
  decisionForCustomer,
  issueToken,
  signingSecret,
};
