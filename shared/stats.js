/**
 * Local focus stats. The dashboard is a Pro feature; the math does not talk to Chrome.
 */
(function (factory) {
  const api = factory();
  const root = typeof globalThis !== "undefined" ? globalThis : this;
  root.TabLockStats = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(function () {
  const STORAGE_KEY = "unswitch-stats";
  const MAX_OPEN_MS = 12 * 60 * 60 * 1000;
  const MAX_DAYS = 400;

  function emptyStats() {
    return {
      lockedMs: 0,
      sessions: 0,
      switchAttempts: 0,
      streak: 0,
      bestStreak: 0,
      lastFocusDate: "",
      focusStartedAt: null,
      counting: false,
      days: {},
    };
  }

  function dateKey(now) {
    const date = new Date(now);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function previousDateKey(key) {
    const [year, month, day] = String(key).split("-").map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() - 1);
    return dateKey(date.getTime());
  }

  function cloneDay(day) {
    return {
      lockedMs: Number(day?.lockedMs) || 0,
      sessions: Number(day?.sessions) || 0,
      switchAttempts: Number(day?.switchAttempts) || 0,
    };
  }

  function normalize(stats) {
    const source = stats && typeof stats === "object" ? stats : {};
    const days = {};
    const rawDays = source.days && typeof source.days === "object" ? source.days : {};
    for (const key of Object.keys(rawDays).sort()) days[key] = cloneDay(rawDays[key]);
    return {
      lockedMs: Number(source.lockedMs) || 0,
      sessions: Number(source.sessions) || 0,
      switchAttempts: Number(source.switchAttempts) || 0,
      streak: Number(source.streak) || 0,
      bestStreak: Number(source.bestStreak) || 0,
      lastFocusDate: typeof source.lastFocusDate === "string" ? source.lastFocusDate : "",
      focusStartedAt: typeof source.focusStartedAt === "number" ? source.focusStartedAt : null,
      counting: Boolean(source.counting),
      days,
    };
  }

  function bucket(stats, key) {
    if (!stats.days[key]) stats.days[key] = { lockedMs: 0, sessions: 0, switchAttempts: 0 };
    return stats.days[key];
  }

  function trimDays(stats) {
    const keys = Object.keys(stats.days).sort();
    while (keys.length > MAX_DAYS) delete stats.days[keys.shift()];
  }

  function noteFocusStart(stats, now, newSession) {
    const next = normalize(stats);
    if (next.counting) return next;
    const key = dateKey(now);
    if (newSession) {
      next.sessions += 1;
      bucket(next, key).sessions += 1;
      if (!next.lastFocusDate) next.streak = 1;
      else if (next.lastFocusDate === key) next.streak = Math.max(next.streak, 1);
      else if (previousDateKey(key) === next.lastFocusDate) next.streak += 1;
      else next.streak = 1;
      next.lastFocusDate = key;
      next.bestStreak = Math.max(next.bestStreak, next.streak);
    }
    next.counting = true;
    next.focusStartedAt = now;
    trimDays(next);
    return next;
  }

  function noteFocusPause(stats, now) {
    const next = normalize(stats);
    if (!next.counting || typeof next.focusStartedAt !== "number") {
      next.counting = false;
      next.focusStartedAt = null;
      return next;
    }
    const delta = Math.max(0, Math.min(now - next.focusStartedAt, MAX_OPEN_MS));
    next.lockedMs += delta;
    bucket(next, dateKey(now)).lockedMs += delta;
    next.counting = false;
    next.focusStartedAt = null;
    trimDays(next);
    return next;
  }

  function noteSwitch(stats, now) {
    const next = normalize(stats);
    next.switchAttempts += 1;
    bucket(next, dateKey(now)).switchAttempts += 1;
    trimDays(next);
    return next;
  }

  function present(stats, now) {
    const next = normalize(stats);
    if (!next.counting || typeof next.focusStartedAt !== "number") return next;
    const delta = Math.max(0, Math.min(now - next.focusStartedAt, MAX_OPEN_MS));
    const key = dateKey(now);
    const day = bucket(next, key);
    day.lockedMs += delta;
    next.lockedMs += delta;
    next.openMs = delta;
    return next;
  }

  function toCsv(stats) {
    const rows = ["date,sessions,locked_minutes,switch_attempts"];
    for (const key of Object.keys(stats.days || {}).sort()) {
      const day = stats.days[key];
      rows.push(
        [key, day.sessions || 0, Math.round((day.lockedMs || 0) / 60000), day.switchAttempts || 0].join(",")
      );
    }
    return rows.join("\n");
  }

  return {
    STORAGE_KEY,
    emptyStats,
    dateKey,
    previousDateKey,
    normalize,
    noteFocusStart,
    noteFocusPause,
    noteSwitch,
    present,
    toCsv,
  };
});
