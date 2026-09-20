---
name: reference_datetime_local_browser_timezone
description: "lightning-input type=datetime-local renders in the BROWSER timezone, not the Salesforce org timezone"
metadata: 
  node_type: memory
  type: reference
  originSessionId: ad851d75-791b-4781-8035-ce5bab665c29
---

`lightning-input type="datetime-local"` displays and collects wall-clock time in the **browser's** local timezone, NOT the running user's Salesforce TimeZoneSidKey. To see it: override the browser timezone in Chrome DevTools (Sensors → Location → Timezone ID) shifted the rendered ETA value (Jun 29 6:00 PM → Jun 30 6:00 AM under Asia/Tokyo). If it used an explicit Salesforce timezone via Intl, the override could not have moved it.

Consequence: an ETA field is best split from one `datetime-local` into separate `type="date"` + `type="time"` inputs (to get the "Estimated Arrival Date"/"Estimated Arrival Time" labels the reviewer's mockup wanted, since the compound widget's internal "Date"/"Time" sub-labels cannot be renamed). To preserve identical persisted instants, conversion stays **browser-local**:
- display: stored UTC → `new Date(iso)` + local getters (`getFullYear/getHours/...`)
- save: `new Date(`${date}T${time}`).toISOString()` (a no-offset time string parses as local per ECMA-262)

**Trap:** "fixing" this to `@salesforce/i18n/timeZone` / explicit SF-timezone conversion would CHANGE behavior for any user whose browser TZ ≠ SF TZ — that is a regression, not a fix. Do not do it.

`process.env.TZ` cannot be reassigned inside a running Jest jsdom test (V8 caches the realm timezone at creation). Set `TZ` on the command line / pre-fork (e.g. top of `jest.config.js`) to force a non-UTC runner. The component's round-trip test is timezone-agnostic but only discriminating when the runner offset is non-zero.
