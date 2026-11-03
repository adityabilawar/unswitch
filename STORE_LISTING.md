# Chrome Web Store listing draft

## Suggested summary

Stay on one focus tab with instant tab lock, allowed-tab groups, an optional Pomodoro timer, and local-only task reminders.

## Suggested detailed description

Tab Lock helps you finish the task in front of you by returning you to a chosen focus tab when you drift into another tab.

### Focus your way

- Lock the current tab in one click.
- Add reference tabs to the allowed set without ending the session.
- Add an optional task reminder that stays visible on allowed tabs.
- Choose an immediate return or a 10-second guided breathing pause.
- Optionally ask before a link leaves the current website.

### Pomodoro focus

Run repeating 60-minute focus periods with 5, 10, and 20-minute breaks. During focus periods, Tab Lock keeps your allowed tabs in front of you. During breaks, browsing is unlocked automatically.

### Private by design

Tab Lock has no account, analytics, ads, or remote server. Settings and task text stay in Chrome's local extension storage and are not transmitted.

### Browser limitations

Chrome does not allow extensions to place a blocker on internal pages such as `chrome://` pages or the Chrome Web Store. When one of those pages is selected during a focus period, Tab Lock returns directly to the focus tab.

## Permission explanations

- **Tabs:** identify the chosen focus tab and allowed tabs.
- **Storage:** keep the current session and preferences locally.
- **Alarms:** move Pomodoro sessions between focus and break periods reliably.
- **Scripting and website access:** show the blocker, breathing pause, and optional task reminder on ordinary webpages.

## 1.2.2 release notes

Fixed a startup issue that could leave the popup on “Loading…” and prevent its action buttons from responding when an open browser tab could not answer the extension. Tab Lock now keeps popup commands responsive and shows a recovery message if its background service is unavailable.

## 1.2.0 release notes

More reliable and less frustrating: correct 5/10/20 breaks, optional task text, working tab management during breaks, safe recovery when tabs move or close, opt-in leave-site prompts, clearer break UI, and lower page overhead while the extension is off.
