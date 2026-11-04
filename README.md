# Tab Lock – Focus Mode

A Chrome extension that keeps you on your focus tab. Two modes: instant tab lock and a Pomodoro-style focus timer with escalating breaks.

**Version:** 1.3.0 (see `manifest.json`)

## Features

### Tab Lock (toggle)

- Click the extension icon and choose **Lock Tab** to lock yourself to the current tab.
- Optionally enter a task before locking. It appears as a draggable reminder on every tab in your allowed set (drag to reposition, double-click to reset to top center).
- If you switch to another tab, Tab Lock returns you to the focus tab. In the popup, under **Blocked tab**, choose **Breathing ritual (10s)** for a guided inhale/exhale pause, or **Return immediately**.
- Opening a new tab while locked does not add it to the allowed set. It stays blocked until you explicitly add it from **Manage tabs** in the popup.
- Optional **Leave-site warning**: when enabled, links from an allowed tab to a different hostname ask for confirmation (same-site and subdomain navigation is not interrupted).
- Click **Unlock Tab** to disable the lock.
- The toolbar icon switches between locked and unlocked artwork; the badge shows **ON** when a focus lock is active.

### Pomodoro focus

- **Start Pomodoro** begins a focus cycle (the optional task reminder works here too):
  - 60 min focus → 5 min break → 60 min focus → 10 min break → 60 min focus → 20 min break → (repeats)
- During focus phases, tab lock behaves like **Lock Tab**.
- During breaks you can browse freely.
- **Lifeline**: hold for 5 seconds to cancel the Pomodoro session and unlock.

### Pro (optional)

Every feature above stays free. Pro is off until this install has an active license from the test-mode server in `server/`. Prices live in `shared/pro-config.js`: **$2.99/month**, **$19.99/year with a 7-day trial**, and **$29.99 lifetime**.

- **Custom Pomodoro.** Your own focus and break lengths, up to 12 phases, plus a chime, bell, or ding when a phase changes.
- **Strict mode.** Lifeline and unlock wait until a timer ends, or until you type a challenge phrase. Closing the focus tab still ends the session, because Chrome does not give an extension a way to stop that.
- **Scheduled auto-lock.** Pick days and a start time. The browser checks about once a minute and locks the active tab if that check falls within five minutes after the start. An optional end time can unlock. An open session is left alone.
- **Focus sets.** Name the sites in the current allowed tabs and restore that set in one click.
- **Stats.** Streak, locked time, sessions, and switch attempts stay on this device. Export JSON or CSV from the Pro page.
- **Blocked screen.** An optional quote, https image, https redirect, and a box or 4-7-8 breathing ritual. The free 10-second ritual is unchanged.
- **Protection and sync.** A password is required to unlock, use Lifeline, or change Pro settings. Only a PBKDF2 verifier is stored. Pro settings sync with `chrome.storage.sync`. Stats and the license cache stay local. Chrome cannot block uninstall; with protection on, removing the extension opens an explanation page that does not record the visit.

The popup lists the three plans. **Pro settings and license** opens the full page.

## Installation

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Turn on **Developer mode** (toggle in the top-right).
4. Click **Load unpacked**.
5. Select the `unswitch` project folder (or your local clone path).

## Usage

1. Go to the tab you want to focus in (document, IDE, study page, and so on).
2. Click the Tab Lock icon in the Chrome toolbar.
3. Choose **Lock Tab** for an immediate lock, or **Start Pomodoro** for structured focus and break periods.

## Requirements

- Chrome 88 or later (Manifest V3)
- **Permissions:** `tabs`, `scripting`, `alarms`, `storage` (unchanged; `storage` already covers `chrome.storage.sync`)
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
    overlay.js           # 10-second breathing ritual shown before the locked screen
    overlay.css
    leave-domain.js      # Confirm before leaving the current site from an allowed tab while locked
    reminder.js          # Draggable task banner on allowed tabs
    reminder.css
  blocked/
    blocked.html         # Fallback blocked page
    blocked.css
  pro/                   # Pro settings page opened from the popup
  shared/                # Prices, entitlement checks, settings, stats, rituals
  server/                # Test-mode license server (no Stripe secret keys in the extension)
  api/                   # Vercel routes that call the same server handlers
  icons/                 # Locked / unlocked toolbar icons (16, 32, 48, 128 px)
  store-assets/          # Icons and screenshots for store listing (optional)
```

## Set up Pro payments (test mode)

This build never creates live products and never charges a live card. The extension only talks to your license server. Secret keys stay in the server environment.

Prices are the numbers in `shared/pro-config.js`. Change them there, reload the extension, and redeploy the server. Both sides read that file.

### 1. Stripe account and test keys

1. Create a Stripe account at https://dashboard.stripe.com/register.
2. Stay in **Test mode** (the toggle in the Dashboard). Do not create live products for this build.
3. Open **Developers → API keys** and copy the **Secret key**. It starts with `sk_test_`.
4. A publishable key is not used. Do not put the secret key in the extension, in git, or in `shared/pro-config.js`.

You can skip creating Products. Checkout sends `price_data` from `shared/pro-config.js` ($2.99/month, $19.99/year with a 7-day trial, $29.99 lifetime). If you would rather create test prices yourself, make three test-mode prices for those amounts and set `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`, and `STRIPE_PRICE_LIFETIME` to their `price_test_...` ids.

### 2. Local server

```bash
cp server/.env.example server/.env
```

Edit `server/.env`:

- `STRIPE_SECRET_KEY=sk_test_...`
- `STRIPE_WEBHOOK_SECRET=` leave blank until step 3, or paste the secret from `stripe listen`
- `LICENSE_SIGNING_SECRET=` a random string of at least 16 characters
- `PUBLIC_BASE_URL=http://127.0.0.1:8787`

Start it:

```bash
npm start --prefix server
```

The server listens on `http://127.0.0.1:8787`. `GET /api/health` returns `{ "mode": "test" }` and the three prices.

In Chrome, load the extension unpacked, open **Pro settings and license**, set the license server to `http://127.0.0.1:8787`, and save it. That value stays on this device.

### 3. Webhook

Install the Stripe CLI (https://docs.stripe.com/stripe-cli) and log in with `stripe login` while the Dashboard is in test mode.

```bash
stripe listen --forward-to localhost:8787/api/webhook
```

Copy the `whsec_...` secret it prints into `STRIPE_WEBHOOK_SECRET` and restart the server.

The endpoint handles:

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Stripe is the record of the license. The webhook writes install id, plan, and status onto the test customer. Renewal and cancellation are read back from the subscription, so a canceled plan stays Pro only until the period that was already paid ends. A lifetime purchase has no renewal.

### 4. Buy in test mode

1. Open the Tab Lock popup and choose Monthly, Yearly, or Lifetime.
2. Pay on the Stripe test checkout page with card `4242 4242 4242 4242`, any future expiry, and any CVC. Use any email.
3. The success page shows a license key. It is a signed pointer to the Stripe test customer, not a card number.
4. Paste that key into the popup and choose **Activate**, or choose **Refresh license**. The install id from this browser is also stored on the customer, so refresh can find the purchase without the key.
5. The badge switches to Pro. Custom timers, strict mode, the schedule, focus sets, stats, the blocked screen, and protection then work. Free behavior is unchanged on an install with no license.

`npm run check` does not call Stripe. It syntax-checks the extension and server, then runs the same handlers against stand-in Stripe responses.

### 5. Deploy the server

1. Push this branch and import the GitHub repo in Vercel (https://vercel.com/new).
2. Framework preset: **Other**. Root directory: the repository root. Leave the build command empty. `vercel.json` already points the `/api` routes at Node 20.
3. In the Vercel project settings, add the same environment variables as `server/.env.example`. Set `PUBLIC_BASE_URL` to the deployment origin, for example `https://your-project.vercel.app`. Use the `sk_test_...` key and a `whsec_...` secret. Do not use `sk_live_...` with this build; the server rejects it.
4. In the Stripe Dashboard, still in **Test mode**, open **Developers → Webhooks → Add endpoint**. Endpoint URL: `https://your-project.vercel.app/api/webhook`. Select the three events listed above. Put that endpoint's signing secret in `STRIPE_WEBHOOK_SECRET` and redeploy.
5. Set the extension's license server to that `https://` origin, or set `API_BASE` in `shared/pro-config.js` before you pack the extension so new installs already know it.
6. Repeat the test-card purchase against the deployed server.

No database is required. Do not commit `server/.env`.

### Going live

Do these only when you mean to charge real cards. This pull request does not do them.

1. In Stripe **live mode**, create the Monthly, Yearly, and Lifetime products at the prices in `shared/pro-config.js` (or whatever you changed them to). Copy the live price ids.
2. Edit `server/lib/stripe.js`. Remove the checks that require `sk_test_` and `price_test_` / `cs_test_` / `cus_test_` / `sub_test_` ids. Those checks are the only thing stopping a live charge.
3. Deploy again with `sk_live_...`, the live webhook secret, and the live price ids. Keep `LICENSE_SIGNING_SECRET` private and long.
4. Point `PUBLIC_BASE_URL`, the Dashboard webhook, and the extension `API_BASE` at that deployment.
5. Buy one real subscription yourself and confirm the popup shows Pro, then cancel it and confirm the license ends after the paid period.
6. Update the Chrome Web Store listing yourself. This repo does not submit the extension.

A cached license is rechecked about every 6 hours and keeps working offline for 7 days. After that the install returns to the free feature set until the server answers. Nothing here is published to the Chrome Web Store.

## Manual testing checklist

- [ ] **Tab lock toggle**: Lock → switch to another tab → see 10-second breathing ritual → see locked screen.
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
- [ ] **Free without a license**: Custom Pomodoro settings, strict mode, and a schedule do nothing. The cycle stays 60 / 5 / 10 / 20 and Lifeline still unlocks.
- [ ] **Pro checkout**: Test card purchase → paste the license key → Pro badge. Wrong key shows an error and does not unlock Pro features.
- [ ] **Strict mode**: Phrase or timer blocks Lifeline. Closing the focus tab still ends the session.
- [ ] **Focus set**: Save the locked sites, unlock, restore, and confirm those sites are allowed again.

## License

MIT
