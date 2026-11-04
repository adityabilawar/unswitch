const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const holdSource = fs.readFileSync(path.join(__dirname, "../popup/hold.js"), "utf8");
const popupSource = fs.readFileSync(path.join(__dirname, "../popup/popup.js"), "utf8");

function loadHold() {
  const context = { Date, Math };
  vm.runInNewContext(holdSource, context);
  return context.createHoldTimer;
}

function fakeHold(durationMs = 5000) {
  let now = 0;
  let fired = 0;
  let ticks = [];
  let scheduled = null;
  const createHoldTimer = loadHold();
  const hold = createHoldTimer({
    durationMs,
    now: () => now,
    schedule(tick) {
      scheduled = tick;
      return 1;
    },
    cancelSchedule() {
      scheduled = null;
    },
    onTick(remaining) {
      ticks.push(remaining);
    },
    onFire() {
      fired += 1;
    },
  });
  return {
    hold,
    fireCount: () => fired,
    tick: () => scheduled && scheduled(),
    advance(ms) {
      now += ms;
    },
    ticks: () => ticks,
  };
}

test("releasing before the deadline cancels the lifeline", () => {
  const h = fakeHold();
  assert.equal(h.hold.start(), true);
  assert.equal(h.hold.start(), false);
  h.advance(4999);
  assert.equal(h.hold.release(), "cancelled");
  h.tick();
  assert.equal(h.fireCount(), 0);
  assert.equal(h.hold.release(), "idle");
});

test("releasing at the deadline ends the session once", () => {
  const h = fakeHold();
  h.hold.start();
  h.advance(5000);
  assert.equal(h.hold.release(), "fired");
  assert.equal(h.hold.release(), "idle");
  h.tick();
  assert.equal(h.fireCount(), 1);
});

test("a late interval still ends the hold once", () => {
  const h = fakeHold();
  h.hold.start();
  h.advance(5400);
  h.tick();
  h.tick();
  assert.equal(h.fireCount(), 1);
});

test("lifeline does not cancel just because the pointer leaves the button", () => {
  assert.equal(popupSource.includes("mouseleave"), false);
  assert.equal(popupSource.includes("setPointerCapture"), true);
});
