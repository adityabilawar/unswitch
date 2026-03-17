# Unswitch

A Chrome extension that locks you into one tab to eliminate distractions. Two modes: instant tab lock and pomodoro focus timer.

## Features

### Tab Lock (Toggle)
- Click the extension icon and tap **Lock Tab** to lock yourself to the current tab
- Optionally type a task you need to finish before locking—it appears as a draggable reminder banner on the locked tab (drag to reposition, double‑click to reset to top center)
- Switching to other tabs shows a black screen and immediately returns you to the locked tab
- Click **Unlock Tab** to disable
- Extension badge shows "ON" when locked

### Pomodoro Focus
- **Start Pomodoro** to begin a focus cycle (optional task reminder works here too):
  - 60 min focus → 5 min break → 60 min focus → 10 min break → 60 min focus → 20 min break → (repeats)
- During focus phases: tab lock is active (same behavior as regular lock)
- During break phases: you can browse freely
- **Lifeline** button: hold for 5 seconds to cancel the pomodoro session and unlock

## Installation

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked**
5. Select the `unswitch` folder

## Usage

1. Navigate to the tab you want to lock (e.g. a document, IDE, or study material)
2. Click the Unswitch icon in the Chrome toolbar
3. Choose:
   - **Lock Tab** – instant lock, toggle off anytime
   - **Start Pomodoro** – structured focus/break cycle with escalating breaks

## Requirements

- Chrome 88+ (Manifest V3)
- Permissions: `tabs`, `activeTab`, `scripting`, `alarms`, `storage`

## Project Structure

```
unswitch/
  manifest.json       # Extension manifest (Manifest V3)
  background.js       # Service worker - tab lock & pomodoro logic
  popup/
    popup.html        # Extension popup UI
    popup.css         # Popup styles
    popup.js          # Popup logic
  content/
    overlay.js        # Black screen overlay (injected)
    overlay.css       # Overlay styles
  blocked/
    blocked.html      # Fallback blocked page
    blocked.css       # Blocked page styles
  icons/              # Lock/unlock icons (16, 32, 48, 128px)
```

## Manual Testing Checklist

- [ ] **Tab Lock Toggle**: Lock tab → switch to another tab → see black overlay → auto-return to locked tab
- [ ] **Tab Lock Unlock**: Unlock from popup → can switch tabs freely
- [ ] **Icon/Badge**: Icon switches locked/unlocked; badge shows "ON" when locked
- [ ] **Locked tab closed**: Close locked tab → lock disables automatically
- [ ] **Pomodoro Start**: Start Pomodoro → tab locks, countdown shows
- [ ] **Pomodoro Focus → Break**: After 60 min → break phase, can switch tabs
- [ ] **Pomodoro Break → Focus**: After break → focus phase, tab lock active again
- [ ] **Pomodoro Cycle**: 5 min → 10 min → 20 min breaks in sequence
- [ ] **Lifeline**: Hold Lifeline 5 sec → pomodoro cancels, tabs unlock
- [ ] **Cross-window**: Lock in window A → switch to window B → forced back to locked tab

## License

MIT
