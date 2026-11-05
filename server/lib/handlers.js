const { listPlans } = require("../../shared/pro-config");
const { stripeRequest, verifyStripeSignature, assertTestId, httpError } = require("./stripe");
const {
  publicBase,
  isInstallId,
  buildCheckoutParams,
  readLicense,
  grantCheckoutSession,
  findCustomer,
  decisionForCustomer,
  issueToken,
  signingSecret,
} = require("./license");

function json(status, body) {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

function html(status, body) {
  return {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    body,
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseJson(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch (_) {
    throw httpError("Expected a JSON body.", 400);
  }
}

function envOf(deps) {
  return deps.env || process.env;
}

async function checkoutHandler(request, deps = {}) {
  if (request.method !== "POST") return json(405, { error: "Use POST." });
  try {
    const env = envOf(deps);
    const body = parseJson(request.rawBody || request.body);
    const base = publicBase(env);
    const params = buildCheckoutParams({
      planId: body.plan,
      installId: body.installId,
      base,
      env,
    });
    const session = await stripeRequest(env, {
      method: "POST",
      path: "/v1/checkout/sessions",
      params,
      stripeImpl: deps.stripeImpl,
    });
    if (!session?.url || !String(session.id || "").startsWith("cs_test_")) {
      return json(502, { error: "Stripe did not return a test checkout session." });
    }
    return json(200, { id: session.id, url: session.url });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.message || "Checkout failed." });
  }
}

async function webhookHandler(request, deps = {}) {
  if (request.method !== "POST") return json(405, { error: "Use POST." });
  const env = envOf(deps);
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json(500, { error: "Set STRIPE_WEBHOOK_SECRET." });
  const payload = typeof request.rawBody === "string" ? request.rawBody : request.body;
  if (typeof payload !== "string") return json(400, { error: "Webhook body must be the raw payload." });
  const header = request.headers?.["stripe-signature"] || request.headers?.["Stripe-Signature"];
  if (!verifyStripeSignature(secret, payload, header, deps.now || Date.now())) {
    return json(400, { error: "Invalid Stripe signature." });
  }
  let event;
  try {
    event = JSON.parse(payload);
  } catch (_) {
    return json(400, { error: "Invalid webhook JSON." });
  }
  try {
    if (event.type === "checkout.session.completed") {
      await grantCheckoutSession(env, event.data.object, deps);
    } else if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const subscription = event.data.object;
      const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
      assertTestId(customerId, "cus");
      if (subscription.id) assertTestId(subscription.id, "sub");
      await stripeRequest(env, {
        method: "POST",
        path: `/v1/customers/${customerId}`,
        params: {
          "metadata[licenseStatus]": subscription.status || "canceled",
          "metadata[subscriptionId]": subscription.id || "",
          "metadata[currentPeriodEnd]": subscription.current_period_end
            ? String(subscription.current_period_end * 1000)
            : "",
          "metadata[plan]": subscription.metadata?.plan || "",
        },
        stripeImpl: deps.stripeImpl,
      });
    }
    return json(200, { received: true });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.message || "Webhook failed." });
  }
}

async function resolveLicense(env, { token, installId }, deps) {
  let customer = null;
  let customerId = "";
  let subscriptionId = "";
  let knownInstall = installId;
  if (token) {
    const payload = readLicense(token, signingSecret(env));
    if (!payload) throw httpError("That license key is not valid.", 400);
    customerId = payload.customerId;
    subscriptionId = payload.subscriptionId || "";
    knownInstall = payload.installId || knownInstall;
    if (customerId) {
      customer = await stripeRequest(env, {
        method: "GET",
        path: `/v1/customers/${customerId}`,
        stripeImpl: deps.stripeImpl,
      });
    }
  }
  if (!customer && knownInstall) {
    if (!isInstallId(knownInstall)) throw httpError("Install id is not valid.", 400);
    customer = await findCustomer(env, knownInstall, deps);
    customerId = customer?.id || "";
    subscriptionId = customer?.metadata?.subscriptionId || subscriptionId;
  }
  const decision = await decisionForCustomer(env, customer, deps);
  let nextToken = "";
  if (decision.pro && customerId && knownInstall) {
    nextToken = issueToken(env, {
      installId: knownInstall,
      customerId,
      subscriptionId: customer?.metadata?.subscriptionId || subscriptionId,
      decision,
    });
  }
  return {
    pro: Boolean(decision.pro),
    plan: decision.plan,
    status: decision.status,
    currentPeriodEnd: decision.currentPeriodEnd,
    token: nextToken,
  };
}

async function licenseHandler(request, deps = {}) {
  if (request.method !== "GET" && request.method !== "POST") return json(405, { error: "Use GET." });
  try {
    const env = envOf(deps);
    const url = new URL(request.url, "http://license.local");
    const body = request.method === "POST" ? parseJson(request.rawBody || request.body) : {};
    const result = await resolveLicense(
      env,
      {
        token: url.searchParams.get("token") || body.token || "",
        installId: url.searchParams.get("installId") || body.installId || "",
      },
      deps
    );
    return json(200, result);
  } catch (error) {
    return json(error.statusCode || 500, { error: error.message || "License check failed." });
  }
}

function pageShell(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #08080c; color: #ececf1; }
    main { max-width: 560px; margin: 0 auto; padding: 48px 20px; }
    h1 { font-size: 28px; letter-spacing: -0.03em; }
    p, li { color: #a1a1b0; line-height: 1.5; }
    code, input { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    input { width: 100%; box-sizing: border-box; margin: 12px 0; padding: 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,.12); background: #12121a; color: #fff; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    ${body}
  </main>
</body>
</html>`;
}

async function activateHandler(request, deps = {}) {
  if (request.method !== "GET") return json(405, { error: "Use GET." });
  const url = new URL(request.url, "http://license.local");
  if (url.searchParams.get("canceled")) {
    return html(200, pageShell("Checkout canceled", "<p>No charge was made. You can return to Tab Lock and choose a plan again. Test mode never charges a live card.</p>"));
  }
  const sessionId = url.searchParams.get("session_id") || "";
  if (!sessionId) {
    return html(400, pageShell("Missing checkout", "<p>Stripe did not include a checkout session id.</p>"));
  }
  try {
    const env = envOf(deps);
    const session = await stripeRequest(env, {
      method: "GET",
      path: `/v1/checkout/sessions/${sessionId}`,
      stripeImpl: deps.stripeImpl,
    });
    const granted = await grantCheckoutSession(env, session, deps);
    const token = issueToken(env, {
      installId: granted.installId,
      customerId: granted.customerId,
      subscriptionId: granted.subscriptionId,
      decision: granted.decision,
    });
    const summary = granted.decision.plan === "lifetime"
      ? "Lifetime Pro is active on this install."
      : `Pro is active (${escapeHtml(granted.decision.status)}).`;
    return html(
      200,
      pageShell(
        "Tab Lock Pro is ready",
        `<p>${summary} Copy this license key into the Tab Lock popup, or click Refresh license there. The key is a pointer to your Stripe test customer. It does not contain a card number.</p>
         <input readonly value="${escapeHtml(token)}" aria-label="License key">
         <p>Webhook events keep renewals and cancellations up to date. You can close this tab.</p>`
      )
    );
  } catch (error) {
    return html(error.statusCode || 500, pageShell("License not activated", `<p>${escapeHtml(error.message || "Activation failed.")}</p>`));
  }
}

function uninstallHandler(request) {
  const url = new URL(request.url, "http://license.local");
  const installId = url.searchParams.get("installId") || "";
  const safeId = isInstallId(installId) ? installId : "";
  return html(
    200,
    pageShell(
      "Tab Lock was removed",
      `<p>Chrome does not let an extension block uninstall. If a protected focus session was still running, it has ended.</p>
       <p>This page does not record the visit. Reinstall Tab Lock and activate the same license key to restore Pro on this browser.</p>
       ${safeId ? `<p>Install id<br><code>${escapeHtml(safeId)}</code></p>` : ""}`
    )
  );
}

function healthHandler() {
  return json(200, {
    ok: true,
    mode: "test",
    plans: listPlans().map((plan) => ({
      id: plan.id,
      label: plan.label,
      amountCents: plan.amountCents,
      currency: plan.currency,
      mode: plan.mode,
      interval: plan.interval || null,
      trialDays: plan.trialDays,
      summary: plan.summary,
    })),
  });
}

async function route(request, deps = {}) {
  const url = new URL(request.url, "http://license.local");
  if (url.pathname === "/api/checkout") return checkoutHandler(request, deps);
  if (url.pathname === "/api/webhook") return webhookHandler(request, deps);
  if (url.pathname === "/api/license") return licenseHandler(request, deps);
  if (url.pathname === "/api/activate") return activateHandler(request, deps);
  if (url.pathname === "/api/uninstall") return uninstallHandler(request);
  if (url.pathname === "/api/health") return healthHandler();
  return json(404, { error: "Not found." });
}

function sendResult(res, result) {
  res.statusCode = result.status;
  for (const [key, value] of Object.entries(result.headers || {})) res.setHeader(key, value);
  res.end(result.body);
}

async function readNodeRequest(req) {
  if (typeof req.rawBody === "string") {
    return { method: req.method, url: req.url, headers: req.headers, rawBody: req.rawBody };
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return {
    method: req.method,
    url: req.url,
    headers: req.headers,
    rawBody: Buffer.concat(chunks).toString("utf8"),
  };
}

module.exports = {
  checkoutHandler,
  webhookHandler,
  licenseHandler,
  activateHandler,
  uninstallHandler,
  healthHandler,
  route,
  sendResult,
  readNodeRequest,
  escapeHtml,
};
