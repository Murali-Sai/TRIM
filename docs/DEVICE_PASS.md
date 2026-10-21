# Device pass (task 5.8)

Run this on the live site (`https://app.<domain>`, after docs/DEPLOY.md) on each of:

| Device | Browser |
|---|---|
| iPhone (iOS 17 or later) | Safari, and TRIM added to the Home Screen |
| Android phone | Chrome |
| Desktop | Chrome, Safari (macOS), Firefox |

The automated tests already cover Chromium for every screen at 375 and 1280 px, and WebKit
(Safari's engine) for sign-up, password reset, a custom metric to its chart, and export. This
pass is for what only a real device shows: touch, the keyboard, notches, push, files and
installing the app.

Tick each box per device. Anything that fails gets a note and an issue; when every row passes on
every device, mark 5.8 `[x]` in TASKS.md.

## Checklist

| # | Check | iPhone | Android | Chrome | Safari | Firefox |
|---|---|---|---|---|---|---|
| 1 | Sign up, open the verification email link, log in with "Keep me signed in"; close the browser and reopen: still signed in | | | | | |
| 2 | The TRIM title block shows "Track, Record, Inspect, Measure" under the name, nothing cut off | | | | | |
| 3 | Today: add a food from search, change its amount, change its time, delete it, Undo | | | | | |
| 4 | Today on a phone: the bottom sheet opens and closes, nothing hides behind the notch or home bar, the + button does not cover the last entry | | | | | |
| 5 | Log a meal and a quick add; the target strip and macro bars update | | | | | |
| 6 | "What should I eat?": Shuffle, lock an item, thumbs-down a pair, log the plate | | | | | |
| 7 | Weigh in; the weight chart draws, the tooltip follows a tap or hover, pinch or wheel zoom works, Reset zoom returns | | | | | |
| 8 | Body: switch on Waist, quick-log it, open its chart; Compare shows the overlay | | | | | |
| 9 | Diet phases: add one; every chart shows its tint and name; the Phases toggle hides them | | | | | |
| 10 | Progress: every card has its headline; tapping a card opens its chart | | | | | |
| 11 | Download my data as Excel, CSV and JSON. On iPhone the share sheet opens and the file saves to Files. Each file opens (Numbers, Sheets or Excel) with dates, numbers and units right | | | | | |
| 12 | Import the JSON file into a new account; the counts match | | | | | |
| 13 | Streak reminder: turn it on a few minutes ahead with today unlogged; one reminder arrives; after logging, no second one (iPhone: from the Home Screen app) | n/a in Safari tab | | | | |
| 14 | Install: Add to Home Screen or Install app; it opens full screen with the TRIM icon | | | | n/a | n/a |
| 15 | Dark and light themes, and Match device, follow the setting with no flash of the wrong theme | | | | | |
| 16 | Text at 200% (browser zoom or the system text size) still fits with no sideways scroll | | | | | |
| 17 | Screen reader spot check (VoiceOver or TalkBack): Today's totals, a chart's summary and the Log tabs are read sensibly | | | | | |
| 18 | Desktop keyboard only: Tab reaches every control in order with a visible focus ring; Escape closes sheets | n/a | n/a | | | |
| 19 | The browser console shows no Content-Security-Policy errors on Today, Charts and Account | n/a | n/a | | | |
| 20 | Log out on one device: "Sign out other devices" on another ends that session | | | | | |
