/**
 * Deadline hold used by the Pomodoro lifeline.
 * Completion is based on the clock, so a delayed interval cannot miss a release
 * that already lasted the full duration.
 */
function createHoldTimer({ durationMs, now, schedule, cancelSchedule, onTick, onFire }) {
  let token = 0;
  let timerId = null;
  let deadline = 0;

  function disarm() {
    if (timerId != null) cancelSchedule(timerId);
    timerId = null;
  }

  function fire(myToken) {
    if (myToken !== token || timerId == null) return false;
    disarm();
    token += 1;
    onFire();
    return true;
  }

  return {
    isActive() {
      return timerId != null;
    },
    start() {
      if (timerId != null) return false;
      token += 1;
      const myToken = token;
      deadline = now() + durationMs;
      const tick = () => {
        if (myToken !== token || timerId == null) return;
        const remaining = deadline - now();
        if (remaining <= 0) {
          fire(myToken);
          return;
        }
        onTick(remaining);
      };
      onTick(durationMs);
      timerId = schedule(tick);
      return true;
    },
    release() {
      if (timerId == null) return "idle";
      if (now() >= deadline) {
        const myToken = token;
        return fire(myToken) ? "fired" : "idle";
      }
      disarm();
      token += 1;
      return "cancelled";
    },
    cancel() {
      if (timerId == null) return "idle";
      disarm();
      token += 1;
      return "cancelled";
    },
  };
}
