# Changelog

## 1.2.4

- Immediate return no longer waits for content-script synchronization on the distracting tab.
- Retained stale-overlay cleanup from 1.2.3; added regression tests for unresponsive pages, allowed tabs, and unlock.
- Breathing feedback checks that the tab is still blocked after asynchronous synchronization.

## 1.2.3

- Unlock ends the session in one click with an idempotent command.
- Page blockers clear directly on saved unlock and Pomodoro-break transitions.
- Delayed responses and lock notifications cannot overwrite newer unlocked page state.
- Popup refreshes discard out-of-order results and react to saved state changes.
- Page focus and restoration refresh the authoritative block state.
- Unlock clears Pomodoro fields; session transitions clean up reminder and breathing UI.
- Added regression coverage for stale overlays, late responses, repeated unlock, and switching after unlock.
- Verification: 14 automated tests pass. Live Chrome verification and demonstration video remain pending.

## 1.2.2

- Fixed the popup getting stuck on **Loading…** when an open or restricted tab did not answer a content-script synchronization message.
- Kept tab synchronization outside the serialized state-command queue so **Lock Tab**, **Start Pomodoro**, and popup state requests remain responsive.
- Added bounded content-script messaging and a visible recovery message instead of allowing the popup to wait forever.

## 1.2.0

- Fixed Pomodoro breaks running in the wrong order. The sequence is now 5, 10, then 20 minutes as advertised.
- Fixed Pomodoro alarms after the Manifest V3 service worker has been suspended and restarted.
- Fixed stale sessions when the primary focus tab closes during a break.
- Fixed **Manage Locked Tabs** during Pomodoro breaks.
- Preserved focus sessions when Chrome replaces a tab during prerendering or moves it to another window.
- Made task text genuinely optional, matching the store listing.
- Made immediate return the calmer default; the 10-second breathing ritual remains optional.
- Made cross-site link confirmations opt-in instead of surprising every user.
- Clarified the popup state and end-session action during Pomodoro breaks.
- Prevented the blocker from adding hidden DOM to every page while Tab Lock is off.
- Reduced repeated script/CSS injection and cleaned up reminder/overlay event listeners.
- Improved keyboard and screen-reader access.
