const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const config = require("../shared/pro-config");
const entitlement = require("../shared/entitlement");
const settings = require("../shared/pro-settings");
const stats = require("../shared/stats");
const rituals = require("../shared/rituals");

const root = path.join(__dirname, "..");

test("prices stay config-driven at the approved amounts", () => {
  assert.equal(config.getPlan("monthly").amountCents, 299);
  assert.equal(config.getPlan("monthly").trialDays, 0);
  assert.equal(config.getPlan("monthly").mode, "subscription");
  assert.equal(config.getPlan("yearly").amountCents, 1999);
  assert.equal(config.getPlan("yearly").trialDays, 7);
  assert.equal(config.getPlan("yearly").interval, "year");
  assert.equal(config.getPlan("lifetime").amountCents, 2999);
  assert.equal(config.getPlan("lifetime").mode, "payment");
  assert.deepEqual(
    config.listPlans().map((plan) => plan.summary),
    ["$2.99/month", "$19.99/year, 7-day trial", "$29.99 once"]
  );
});

test("entitlement allows trials, lifetime, and canceled periods that are still paid", () => {
  const now = Date.UTC(2026, 10, 4, 12);
  assert.equal(entitlement.isEntitled(null, now).pro, false);
  assert.equal(
    entitlement.isEntitled({ plan: "yearly", status: "trialing", currentPeriodEnd: now + 1000 }, now).pro,
    true
  );
  assert.equal(
    entitlement.isEntitled({ plan: "lifetime", status: "active", currentPeriodEnd: null }, now).pro,
    true
  );
  assert.equal(
    entitlement.isEntitled({ plan: "monthly", status: "canceled", currentPeriodEnd: now + 1000 }, now).pro,
    true
  );
  assert.equal(
    entitlement.isEntitled({ plan: "monthly", status: "canceled", currentPeriodEnd: now - 1 }, now).pro,
    false
  );
  assert.equal(
    entitlement.isEntitled({ plan: "monthly", status: "past_due", currentPeriodEnd: now + 1000 }, now).pro,
    false
  );
});

test("cached Pro expires after the offline grace window", () => {
  const now = 1_000_000;
  const record = {
    plan: "yearly",
    status: "active",
    currentPeriodEnd: now + 10 * 86400000,
    checkedAt: now - config.OFFLINE_GRACE_MS - 1,
  };
  assert.equal(
    entitlement.hasCachedAccess(record, now, config.REVALIDATE_MS, config.OFFLINE_GRACE_MS).pro,
    false
  );
  record.checkedAt = now - config.REVALIDATE_MS - 1;
  const stale = entitlement.hasCachedAccess(record, now, config.REVALIDATE_MS, config.OFFLINE_GRACE_MS);
  assert.equal(stale.pro, true);
  assert.equal(stale.stale, true);
});

test("settings reject unsafe urls and keep free defaults intact", () => {
  const clean = settings.sanitize({
    pomodoro: { useCustom: true, cycle: [{ focus: 25, break: 5 }], sound: "nope" },
    blockedScreen: {
      quote: "  Stay here  ",
      imageUrl: "http://example.com/a.png",
      redirectUrl: "javascript:alert(1)",
      breathingStyle: "box",
    },
    strict: { mode: "phrase", phrase: "no" },
  });
  assert.equal(clean.pomodoro.sound, "none");
  assert.equal(clean.pomodoro.useCustom, true);
  assert.equal(clean.blockedScreen.imageUrl, "");
  assert.equal(clean.blockedScreen.redirectUrl, "");
  assert.equal(clean.blockedScreen.quote, "Stay here");
  assert.equal(clean.strict.mode, "off");
  assert.equal(settings.explainSettings({ blockedScreen: { redirectUrl: "http://example.com" } }), "Redirect URL must be an https link.");
  assert.equal(settings.publicDisplay(settings.defaultSettings()), null);
});

test("hosts ignore www and non-web urls", () => {
  assert.equal(settings.hostFromUrl("https://www.Example.com/path"), "example.com");
  assert.equal(settings.hostFromUrl("chrome://settings"), "");
  assert.equal(settings.normalizeApiBase("http://evil.example"), "");
  assert.equal(settings.normalizeApiBase("http://127.0.0.1:8787/api"), "http://127.0.0.1:8787");
});

test("strict mode blocks an early exit and a schedule fires once inside its window", () => {
  const now = new Date(2026, 5, 15, 9, 1, 0).getTime();
  const denial = settings.sessionEndDenial({
    settings: settings.sanitize({ strict: { mode: "timed", durationMinutes: 50 } }),
    strictUntil: now + 10 * 60 * 1000,
    entitled: true,
    now,
    challenge: "",
    passwordOk: true,
  });
  assert.equal(denial.code, "strict");
  assert.equal(
    settings.sessionEndDenial({
      settings: settings.defaultSettings(),
      strictUntil: now + 1000,
      entitled: false,
      now,
      challenge: "",
      passwordOk: false,
    }),
    null
  );

  const schedule = {
    enabled: true,
    days: [new Date(now).getDay()],
    start: "09:00",
    end: "10:00",
    unlockAtEnd: true,
  };
  assert.equal(settings.scheduleDecision(schedule, now, "").action, "lock");
  assert.equal(settings.scheduleDecision(schedule, now, `${stats.dateKey(now)}T09:00`), null);
  const end = new Date(2026, 5, 15, 10, 1, 0).getTime();
  assert.equal(settings.scheduleDecision(schedule, end, `${stats.dateKey(now)}T09:00`).action, "unlock");
  const wrongDay = new Date(2026, 5, 16, 9, 1, 0).getTime();
  const otherDays = { ...schedule, days: [new Date(wrongDay).getDay() === 0 ? 1 : 0] };
  assert.equal(settings.scheduleDecision({ ...schedule, days: [(new Date(now).getDay() + 1) % 7] }, now, ""), null);
  assert.equal(otherDays.days.length, 1);
});

test("stats track streaks, locked time, and csv export", () => {
  const monday = new Date(2026, 5, 15, 12).getTime();
  const tuesday = new Date(2026, 5, 16, 12).getTime();
  const thursday = new Date(2026, 5, 18, 12).getTime();
  let record = stats.noteFocusStart(null, monday, true);
  record = stats.noteFocusPause(record, monday + 5 * 60 * 1000);
  record = stats.noteFocusStart(record, monday + 60000, true);
  assert.equal(record.sessions, 2);
  assert.equal(record.streak, 1);
  record = stats.noteFocusPause(record, monday + 10 * 60 * 1000);
  record = stats.noteFocusStart(record, tuesday, true);
  assert.equal(record.streak, 2);
  assert.equal(record.bestStreak, 2);
  record = stats.noteFocusPause(record, tuesday);
  record = stats.noteFocusStart(record, thursday, true);
  assert.equal(record.streak, 1);
  record = stats.noteSwitch(record, thursday);
  const csv = stats.toCsv(stats.present(record, thursday));
  assert.match(csv, /^date,sessions,locked_minutes,switch_attempts/);
  assert.match(csv, /2026-06-15,2,14,0/);
  assert.match(csv, /2026-06-18,1,0,1/);
});

test("password verifiers do not store the password", async () => {
  const protection = await settings.createProtection("correct horse", 1000);
  assert.equal(protection.enabled, true);
  assert.equal(JSON.stringify(protection).includes("correct horse"), false);
  assert.equal(await settings.verifyPassword("correct horse", protection), true);
  assert.equal(await settings.verifyPassword("wrong", protection), false);
});

test("pro breathing rituals keep the free 10 second pause as the default", () => {
  assert.equal(rituals.resolve("classic").duration, 10000);
  assert.equal(rituals.resolve("box").duration, 16000);
  assert.equal(rituals.resolve("478").duration, 19000);
  assert.equal(rituals.resolve("nope").id, "classic");
});

test("the extension runtime does not contain Stripe secrets", () => {
  const files = [
    "manifest.json",
    "background.js",
    "popup/popup.js",
    "popup/popup.html",
    "pro/pro.js",
    "pro/pro.html",
    "shared/pro-config.js",
    "shared/entitlement.js",
    "shared/pro-settings.js",
    "content/blocker.js",
    "content/overlay.js",
  ];
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.permissions.sort(), ["alarms", "scripting", "storage", "tabs"]);
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.equal(/sk_live_|sk_test_|whsec_|rk_live_|rk_test_/.test(source), false, file);
  }
});
