# Product and retention audit

## Evidence used

- The published 1.1.1 CRX and the GitHub repository contain the same runtime code.
- The public store listing advertises optional task text and 5/10/20-minute breaks.
- The source code was traced across tab activation, tab lifecycle, service-worker wake, popup, and alarm paths.
- Automated regression tests cover the high-risk state transitions.
- Chrome successfully packed the 1.2.0 runtime as a valid Manifest V3 extension.

The developer dashboard's private uninstall breakdown was not exported into the repository. Do not claim that a specific fix came from an uninstall survey until that report is reviewed. The issues below are directly reproducible from the shipped code and are strong retention risks.

## Highest-impact findings

1. **The first break was not five minutes.** The phase index advanced before the break was scheduled, producing 10/20/5 instead of the advertised 5/10/20 sequence.
2. **A suspended service worker could lose timer state.** Alarm handlers used in-memory defaults without first loading persisted state.
3. **The listing said task text was optional, but the popup refused to start without it.** This was immediate onboarding friction and a listing/product mismatch.
4. **A focus tab closed during a break left a stale session.** When focus resumed, every remaining tab could be treated as disallowed with no valid tab to return to.
5. **Tab management appeared during breaks but its background actions rejected the request.** The interface offered a feature that could not work in that state.
6. **The leave-site confirmation was forced on every focus session.** It interrupted normal reference workflows and had no preference control.
7. **The extension injected blocker code and CSS repeatedly.** It did this on tab load and every global sync even though normal pages already received the static content script.
8. **The blocker added hidden extension DOM to every webpage even while off.** This increased the chance of page conflicts and made the extension feel more invasive than necessary.
9. **The non-breathing redirect relied on a service-worker timer.** Manifest V3 workers can be suspended, so the return was not guaranteed.
10. **Chrome tab replacement and window moves were not handled.** Prerendering or moving the primary tab could stale the saved IDs.

## Recommended next evidence loop

1. Release 1.2.0 without adding analytics.
2. Compare 7-day active users, weekly installs, weekly uninstalls, and rating/support changes for four weeks before and after release.
3. Add a voluntary uninstall survey URL only after creating a short privacy disclosure. Ask one multiple-choice question plus optional text; never collect browsing history.
4. Tag support messages by cause: trapped session, timer expectation, permissions/privacy, page compatibility, missing customization, or other.
5. Use the smallest metric set possible. The extension's local-only promise is a competitive advantage.

## Monetization recommendation

Do not charge the current 137 users for the existing core feature set. At this size, retention and learning are more valuable than short-term revenue.

Keep these free permanently: one-tab lock, allowed tabs, optional task reminder, and the standard Pomodoro cycle. Test a one-time **Pro** purchase only after retention improves. A reasonable first offer is $9-$15 lifetime, with:

- custom focus and break durations;
- saved focus presets and named workspaces;
- schedules and recurring sessions;
- local productivity history, streaks, and CSV export;
- cross-device preference sync, only if users explicitly opt in.

Use hosted checkout and license keys rather than handling card data in the extension. Make the seller, price, refund terms, and paid functionality explicit. Avoid injected ads and affiliate links: they undermine the product's focus promise and add policy risk.
