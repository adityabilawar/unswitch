/**
 * Breathing rituals. Classic matches the free 10 second pause.
 * Box and 4-7-8 are Pro options and are injected with the overlay.
 */
(function (factory) {
  const api = factory();
  const root = typeof globalThis !== "undefined" ? globalThis : this;
  root.TabLockRituals = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(function () {
  const RITUALS = {
    classic: {
      id: "classic",
      duration: 10000,
      sub: "Stay with the animation for 10 seconds.",
      phases: [
        { until: 0.5, label: "Breathe in", mode: "in" },
        { until: 1, label: "Breathe out", mode: "out" },
      ],
    },
    box: {
      id: "box",
      duration: 16000,
      sub: "Box breath. Four counts in, hold, out, and hold.",
      phases: [
        { until: 0.25, label: "Breathe in", mode: "in" },
        { until: 0.5, label: "Hold", mode: "hold" },
        { until: 0.75, label: "Breathe out", mode: "out" },
        { until: 1, label: "Hold", mode: "hold" },
      ],
    },
    "478": {
      id: "478",
      duration: 19000,
      sub: "4-7-8 breath. In for four, hold for seven, out for eight.",
      phases: [
        { until: 4 / 19, label: "Breathe in", mode: "in" },
        { until: 11 / 19, label: "Hold", mode: "hold" },
        { until: 1, label: "Breathe out", mode: "out" },
      ],
    },
  };

  function resolve(style) {
    if (style === "box" || style === "478") return RITUALS[style];
    return RITUALS.classic;
  }

  return { RITUALS, resolve };
});
