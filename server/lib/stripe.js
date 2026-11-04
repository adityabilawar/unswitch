/**
 * Stripe test-mode client.
 *
 * GO LIVE: this file refuses live secret keys and live object ids.
 * Do not delete those checks until you mean to charge real cards.
 * See the README section "Going live".
 */

const crypto = require("node:crypto");

const STRIPE_API = "https://api.stripe.com";
const STRIPE_VERSION = "2024-06-20";

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function assertStripeTestKey(key) {
  if (typeof key !== "string" || !key.startsWith("sk_test_")) {
    throw httpError(
      "This build only accepts a Stripe test secret key (sk_test_...). Live charges are disabled.",
      400
    );
  }
}

function assertTestId(id, prefix) {
  if (typeof id !== "string" || !id.startsWith(`${prefix}_test_`)) {
    throw httpError(`This build only accepts Stripe test ids starting with ${prefix}_test_.`, 400);
  }
}

function encodeForm(params) {
  return Object.entries(params || {})
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

async function stripeRequest(env, { method, path, params, stripeImpl }) {
  assertStripeTestKey(env.STRIPE_SECRET_KEY);
  if (typeof stripeImpl === "function") return stripeImpl({ method, path, params, env });

  const headers = {
    Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    "Stripe-Version": STRIPE_VERSION,
  };
  let body;
  let url = `${STRIPE_API}${path}`;
  if (method === "GET") {
    const query = encodeForm(params);
    if (query) url += `${url.includes("?") ? "&" : "?"}${query}`;
  } else {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = encodeForm(params);
  }
  const response = await fetch(url, { method, headers, body });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw httpError(json?.error?.message || "Stripe request failed", response.status || 502);
  }
  return json;
}

function verifyStripeSignature(secret, payload, header, now = Date.now(), toleranceSec = 300) {
  if (!secret || !header || typeof payload !== "string") return false;
  let timestamp = "";
  const signatures = [];
  for (const part of String(header).split(",")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t") timestamp = value;
    if (key === "v1") signatures.push(value);
  }
  if (!timestamp || !signatures.length) return false;
  const age = Math.abs(Math.floor(now / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const expectedBuf = Buffer.from(expected);
  return signatures.some((signature) => {
    const actual = Buffer.from(signature);
    return actual.length === expectedBuf.length && crypto.timingSafeEqual(actual, expectedBuf);
  });
}

module.exports = {
  assertStripeTestKey,
  assertTestId,
  encodeForm,
  stripeRequest,
  verifyStripeSignature,
  httpError,
};
