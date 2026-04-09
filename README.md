# Unswitch

A Chrome extension that keeps you on your focus tab. Two modes: instant tab lock and a Pomodoro-style focus timer with escalating breaks.

**Version:** 1.1.0 (see `manifest.json`)

## Features

### Tab Lock (toggle)

- Click the extension icon and choose **Lock Tab** to lock yourself to the current tab.
- Optionally enter a task before locking. It appears as a draggable reminder on every tab in your allowed set (drag to reposition, double-click to reset to top center).
- If you switch to another tab, a full-screen blocker appears on that tab and you are returned to your focus tab shortly after. A short “Tab Locked” overlay may flash on the tab you tried to open.
- Open a link in a new tab from any tab in the locked group (for example documentation with cross-links). That tab is added to the group so you can read it; closing it returns you to the primary locked tab.
- While locked, **Leave-site warning**: on allowed tabs, clicking a link that would take you to a different hostname shows a confirm dialog so you do not drift off-site by accident (same-site and subdomain navigation is not interrupted).
- Click **Unlock Tab** to disable the lock.
- The toolbar icon switches between locked and unlocked artwork; the badge shows **ON** when a focus lock is active.

### Pomodoro focus

- **Start Pomodoro** begins a focus cycle (the optional task reminder works here too):
  - 60 min focus → 5 min break → 60 min focus → 10 min break → 60 min focus → 20 min break → (repeats)
- During focus phases, tab lock behaves like **Lock Tab**.
- During breaks you can browse freely.
- **Lifeline**: hold for 5 seconds to cancel the Pomodoro session and unlock.

## Installation

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Turn on **Developer mode** (toggle in the top-right).
4. Click **Load unpacked**.
5. Select the `unswitch` project folder.

## Usage

1. Go to the tab you want to focus in (document, IDE, study page, and so on).
2. Click the Unswitch icon in the Chrome toolbar.
3. Choose **Lock Tab** for an immediate lock, or **Start Pomodoro** for structured focus and break periods.

## Requirements

- Chrome 88 or later (Manifest V3)
- **Permissions:** `tabs`, `activeTab`, `scripting`, `alarms`, `storage`
- **Host permissions:** `<all_urls>` (needed to inject the blocker, overlay, and reminder on ordinary web pages)

## Project structure

```
unswitch/
  manifest.json          # Extension manifest (Manifest V3)
  background.js          # Service worker: lock state, Pomodoro alarms, tab/window handlers
  popup/
    popup.html           # Toolbar popup UI
    popup.css
    popup.js
  content/
    blocker.js           # Full-screen blocker on tabs outside the allowed set (content script)
    blocker.css
    overlay.js           # Brief “Tab Locked” overlay (injected when switching to a wrong tab)
    overlay.css
    leave-domain.js      # Confirm before leaving the current site from an allowed tab while locked
    reminder.js          # Draggable task banner on allowed tabs
    reminder.css
  blocked/
    blocked.html         # Fallback blocked page
    blocked.css
  icons/                 # Locked / unlocked toolbar icons (16, 32, 48, 128 px)
  store-assets/          # Icons and screenshots for store listing (optional)
```

## Manual testing checklist

- [ ] **Tab lock toggle**: Lock → switch to another tab → see blocker → return to locked tab.
- [ ] **Unlock**: Unlock from popup → switch tabs freely.
- [ ] **Icon / badge**: Icon reflects lock state; badge shows **ON** when locked.
- [ ] **Locked tab closed**: Closing the primary locked tab disables the lock.
- [ ] **Leave-site warning**: On an allowed tab while locked, click an external link → confirm dialog; cancel stays on page.
- [ ] **Pomodoro start**: Start Pomodoro → tab locks, countdown visible in popup as expected.
- [ ] **Pomodoro focus → break**: After focus duration → break phase, free browsing.
- [ ] **Pomodoro break → focus**: After break → focus phase, lock active again.
- [ ] **Pomodoro cycle**: Break lengths follow 5 → 10 → 20 minutes across cycles.
- [ ] **Lifeline**: Hold Lifeline 5 s → session ends, tabs unlock.
- [ ] **Cross-window**: Lock in window A → focus window B with a non-allowed tab → forced back to locked tab.

## License

MIT
