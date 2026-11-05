/**
 * Validation for Pro settings. Invalid values fall back to safe defaults.
 * Password verifiers are PBKDF2 hashes; the password itself is never stored.
 */
(function (factory) {
  const api = factory();
  const root = typeof globalThis !== "undefined" ? globalThis : this;
  root.TabLockProSettings = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(function () {
  const SOUNDS = new Set(["none", "chime", "bell", "ding"]);
  const SOUND_PRESETS = {
    chime: [523.25, 659.25, 783.99],
    bell: [880, 1174.66],
    ding: [1046.5],
  };
  const BREATHING = new Set(["classic", "box", "478"]);
  const HOST_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const SCHEDULE_WINDOW_MS = 5 * 60 * 1000;

  function config() {
    if (typeof TabLockProConfig !== "undefined" && TabLockProConfig.PASSWORD_ITERATIONS) return TabLockProConfig;
    if (typeof require === "function") return require("./pro-config");
    return { PASSWORD_ITERATIONS: 20000 };
  }

  function defaultSettings() {
    return {
      pomodoro: {
        useCustom: false,
        cycle: [
          { focus: 25, break: 5 },
          { focus: 25, break: 5 },
          { focus: 25, break: 15 },
        ],
        sound: "none",
      },
      strict: {
        mode: "off",
        durationMinutes: 50,
        phrase: "",
      },
      schedule: {
        enabled: false,
        days: [1, 2, 3, 4, 5],
        start: "09:00",
        end: "",
        unlockAtEnd: false,
      },
      focusSets: [],
      blockedScreen: {
        quote: "",
        imageUrl: "",
        redirectUrl: "",
        breathingStyle: "classic",
      },
      protection: {
        enabled: false,
        salt: "",
        hash: "",
        iterations: 0,
      },
      syncEnabled: true,
    };
  }

  function clampInteger(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isInteger(number)) return fallback;
    if (number < min || number > max) return fallback;
    return number;
  }

  function httpsUrl(value) {
    const raw = String(value || "").trim();
    if (!raw || raw.length > 500) return "";
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:") return "";
      if (url.username || url.password) return "";
      return url.toString();
    } catch (_) {
      return "";
    }
  }

  function hostFromUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "";
      return url.hostname.replace(/^www\./i, "").toLowerCase();
    } catch (_) {
      return "";
    }
  }

  function cleanHost(value) {
    const host = String(value || "").trim().toLowerCase().replace(/^www\./, "");
    if (!HOST_PATTERN.test(host)) return "";
    return host;
  }

  function cleanCycle(input, fallback) {
    if (!Array.isArray(input) || input.length < 1 || input.length > 12) return fallback;
    const cycle = [];
    for (const phase of input) {
      const focus = clampInteger(phase?.focus, 1, 180, NaN);
      const breakMinutes = clampInteger(phase?.break, 1, 60, NaN);
      if (!Number.isInteger(focus) || !Number.isInteger(breakMinutes)) return fallback;
      cycle.push({ focus, break: breakMinutes });
    }
    return cycle;
  }

  function cleanDays(input, fallback) {
    if (!Array.isArray(input)) return fallback.slice();
    const days = [];
    for (const day of input) {
      const number = Number(day);
      if (!Number.isInteger(number) || number < 0 || number > 6 || days.includes(number)) continue;
      days.push(number);
    }
    return days;
  }

  function cleanTime(value, fallback) {
    const text = String(value || "");
    return TIME_PATTERN.test(text) ? text : fallback;
  }

  function cleanPhrase(value) {
    return String(value || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 80);
  }

  function cleanFocusSets(input) {
    if (!Array.isArray(input)) return [];
    const sets = [];
    for (const item of input.slice(0, 30)) {
      const name = String(item?.name || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 40);
      const id = String(item?.id || "").replace(/[^\w-]/g, "").slice(0, 80);
      if (!name || !id) continue;
      const hosts = [];
      const source = Array.isArray(item.hosts) ? item.hosts : [];
      for (const host of source) {
        const clean = cleanHost(host);
        if (clean && !hosts.includes(clean)) hosts.push(clean);
        if (hosts.length >= 50) break;
      }
      if (!hosts.length) continue;
      sets.push({
        id,
        name,
        hosts,
        createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
      });
    }
    return sets;
  }

  function sanitize(input) {
    const defaults = defaultSettings();
    const source = input && typeof input === "object" ? input : {};
    const pomodoro = source.pomodoro && typeof source.pomodoro === "object" ? source.pomodoro : {};
    const strict = source.strict && typeof source.strict === "object" ? source.strict : {};
    const schedule = source.schedule && typeof source.schedule === "object" ? source.schedule : {};
    const screen = source.blockedScreen && typeof source.blockedScreen === "object" ? source.blockedScreen : {};
    const protection = source.protection && typeof source.protection === "object" ? source.protection : {};
    const cycle = cleanCycle(pomodoro.cycle, defaults.pomodoro.cycle);
    let strictMode = strict.mode === "timed" || strict.mode === "phrase" ? strict.mode : "off";
    const phrase = cleanPhrase(strict.phrase);
    if (strictMode === "phrase" && phrase.length < 3) strictMode = "off";
    const end = schedule.end ? cleanTime(schedule.end, "") : "";
    return {
      pomodoro: {
        useCustom: Boolean(pomodoro.useCustom) && cycle !== defaults.pomodoro.cycle,
        cycle,
        sound: SOUNDS.has(pomodoro.sound) ? pomodoro.sound : "none",
      },
      strict: {
        mode: strictMode,
        durationMinutes: clampInteger(strict.durationMinutes, 1, 240, defaults.strict.durationMinutes),
        phrase: strictMode === "phrase" ? phrase : phrase,
      },
      schedule: {
        enabled: Boolean(schedule.enabled),
        days: cleanDays(schedule.days, defaults.schedule.days),
        start: cleanTime(schedule.start, defaults.schedule.start),
        end,
        unlockAtEnd: Boolean(schedule.unlockAtEnd) && Boolean(end),
      },
      focusSets: cleanFocusSets(source.focusSets),
      blockedScreen: {
        quote: String(screen.quote || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 240),
        imageUrl: httpsUrl(screen.imageUrl),
        redirectUrl: httpsUrl(screen.redirectUrl),
        breathingStyle: BREATHING.has(screen.breathingStyle) ? screen.breathingStyle : "classic",
      },
      protection: {
        enabled: Boolean(protection.enabled) && Boolean(protection.hash) && Boolean(protection.salt),
        salt: /^[0-9a-f]{16,128}$/i.test(protection.salt || "") ? protection.salt : "",
        hash: /^[0-9a-f]{64}$/i.test(protection.hash || "") ? protection.hash : "",
        iterations: clampInteger(protection.iterations, 1000, 200000, 0),
      },
      syncEnabled: source.syncEnabled !== false,
    };
  }

  function mergeSettings(current, patch) {
    const base = sanitize(current);
    const incoming = patch && typeof patch === "object" ? patch : {};
    return sanitize({
      ...base,
      ...incoming,
      pomodoro: { ...base.pomodoro, ...(incoming.pomodoro || {}) },
      strict: { ...base.strict, ...(incoming.strict || {}) },
      schedule: { ...base.schedule, ...(incoming.schedule || {}) },
      blockedScreen: { ...base.blockedScreen, ...(incoming.blockedScreen || {}) },
      focusSets: base.focusSets,
      protection: base.protection,
      syncEnabled: incoming.syncEnabled != null ? incoming.syncEnabled : base.syncEnabled,
    });
  }

  function wholeNumber(value) {
    const number = Number(value);
    return Number.isInteger(number) ? number : NaN;
  }

  function explainSettings(patch) {
    if (!patch || typeof patch !== "object") return "";
    if (patch.pomodoro && patch.pomodoro.useCustom) {
      const cycle = patch.pomodoro.cycle;
      if (!Array.isArray(cycle) || cycle.length < 1 || cycle.length > 12) {
        return "Use 1 to 12 Pomodoro phases.";
      }
      for (const phase of cycle) {
        const focus = wholeNumber(phase?.focus);
        const breakMinutes = wholeNumber(phase?.break);
        if (focus < 1 || focus > 180) return "Focus length must be a whole number from 1 to 180 minutes.";
        if (breakMinutes < 1 || breakMinutes > 60) return "Break length must be a whole number from 1 to 60 minutes.";
      }
    }
    if (patch.pomodoro?.sound && !SOUNDS.has(patch.pomodoro.sound)) return "Choose a listed sound.";
    if (patch.strict?.mode === "phrase" && cleanPhrase(patch.strict.phrase).length < 3) {
      return "Challenge phrase must be at least 3 characters.";
    }
    if (patch.strict?.durationMinutes != null) {
      const minutes = wholeNumber(patch.strict.durationMinutes);
      if (minutes < 1 || minutes > 240) return "Strict mode duration must be 1 to 240 minutes.";
    }
    if (patch.blockedScreen?.imageUrl && !httpsUrl(patch.blockedScreen.imageUrl)) {
      return "Image URL must be an https link.";
    }
    if (patch.blockedScreen?.redirectUrl && !httpsUrl(patch.blockedScreen.redirectUrl)) {
      return "Redirect URL must be an https link.";
    }
    if (patch.schedule?.start && !TIME_PATTERN.test(patch.schedule.start)) return "Start time must be HH:MM.";
    if (patch.schedule?.end && !TIME_PATTERN.test(patch.schedule.end)) return "End time must be HH:MM.";
    return "";
  }

  function publicSettings(settings) {
    const clean = sanitize(settings);
    return {
      ...clean,
      protection: {
        enabled: clean.protection.enabled,
        configured: Boolean(clean.protection.hash),
      },
    };
  }

  function publicDisplay(settings) {
    const screen = sanitize(settings).blockedScreen;
    if (!screen.quote && !screen.imageUrl && !screen.redirectUrl && screen.breathingStyle === "classic") {
      return null;
    }
    return screen;
  }

  function sessionEndDenial({ settings, strictUntil, entitled, now, challenge, passwordOk }) {
    if (!entitled) return null;
    const strict = sanitize(settings).strict;
    if (strict.mode === "timed" && typeof strictUntil === "number" && strictUntil > now) {
      const minutes = Math.max(1, Math.ceil((strictUntil - now) / 60000));
      return { error: `Strict mode is on for about ${minutes} more min.`, code: "strict" };
    }
    if (strict.mode === "phrase" && cleanPhrase(challenge) !== strict.phrase) {
      return { error: "Type your challenge phrase to end this session.", code: "strict" };
    }
    if (settings?.protection?.enabled && !passwordOk) {
      return { error: "Enter your protection password to unlock.", code: "protection" };
    }
    return null;
  }

  function timeOnDate(date, hhmm) {
    const match = TIME_PATTERN.exec(hhmm || "");
    if (!match) return null;
    const next = new Date(date.getTime());
    next.setHours(Number(match[1]), Number(match[2]), 0, 0);
    return next.getTime();
  }

  function dateKey(now) {
    if (typeof TabLockStats !== "undefined") return TabLockStats.dateKey(now);
    const date = new Date(now);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function scheduleDecision(schedule, now, cursor) {
    const clean = sanitize({ schedule }).schedule;
    if (!clean.enabled || !clean.days.length) return null;
    const date = new Date(now);
    if (!clean.days.includes(date.getDay())) return null;
    const key = dateKey(now);
    const startMs = timeOnDate(date, clean.start);
    const startKey = `${key}T${clean.start}`;
    if (startMs != null && cursor !== startKey && now >= startMs && now - startMs < SCHEDULE_WINDOW_MS) {
      return { action: "lock", key: startKey };
    }
    if (clean.unlockAtEnd && clean.end) {
      const endMs = timeOnDate(date, clean.end);
      const endKey = `${key}T${clean.end}:end`;
      if (endMs != null && cursor !== endKey && now >= endMs && now - endMs < SCHEDULE_WINDOW_MS) {
        return { action: "unlock", key: endKey };
      }
    }
    return null;
  }

  function bytesToHex(buffer) {
    return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = parseInt(hex.substr(index * 2, 2), 16);
    }
    return bytes;
  }

  function equalHex(left, right) {
    if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
    let diff = 0;
    for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
    return diff === 0;
  }

  async function derivePassword(password, saltHex, iterations) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", encoder.encode(String(password)), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: hexToBytes(saltHex), iterations, hash: "SHA-256" },
      key,
      256
    );
    return bytesToHex(bits);
  }

  async function createProtection(password, iterations) {
    const rounds = iterations || config().PASSWORD_ITERATIONS;
    const saltBytes = new Uint8Array(16);
    crypto.getRandomValues(saltBytes);
    const salt = bytesToHex(saltBytes);
    const hash = await derivePassword(password, salt, rounds);
    return { enabled: true, salt, hash, iterations: rounds };
  }

  async function verifyPassword(password, protection) {
    if (!protection?.enabled || !protection.hash || !protection.salt) return false;
    const iterations = protection.iterations || config().PASSWORD_ITERATIONS;
    const hash = await derivePassword(String(password || ""), protection.salt, iterations);
    return equalHex(hash, protection.hash);
  }

  function normalizeApiBase(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
      const url = new URL(raw);
      const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      if (url.protocol === "https:" || (url.protocol === "http:" && local)) return url.origin;
    } catch (_) {}
    return "";
  }

  return {
    SOUND_PRESETS,
    SCHEDULE_WINDOW_MS,
    defaultSettings,
    sanitize,
    mergeSettings,
    explainSettings,
    publicSettings,
    publicDisplay,
    sessionEndDenial,
    scheduleDecision,
    hostFromUrl,
    cleanHost,
    httpsUrl,
    createProtection,
    verifyPassword,
    normalizeApiBase,
  };
});
