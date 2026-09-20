---
name: reference_experience_login_2nd_contact
description: "Live-test the Experience Cloud site as a real partner user via the Log in to Experience as User quick action on a partner contact — never via org-domain impersonation"
metadata:
  type: reference
---

To live-test the Experience Cloud site as a real partner or community user:

1. Log in to Salesforce with the user's frontdoor cookie.
2. Ask the user which partner account contact to use. Historically the one named
   "2nd. Provider Test User", but it can be any partner contact — always ask rather than
   pick one. The user keeps throwaway contacts for this so real credentials are never shared.
3. Open that Contact record and click **Log in to Experience as User**, the standard quick
   action at the top right of the record page.
4. Run the tests in the browser session that opens.

**Why the URL-level shortcuts fail.** `servlet/servlet.su?...&suorgadminid=` impersonates the
user in the org domain only; the community runs on a separate `my.site.com` domain with its
own session, so navigating there afterwards serves the login screen.
`servlet/networks/switch` stays inside the internal UI. The quick action's own URL uses
`sunetworkid` and `sunetworkuserid` instead, and it is the only route that mints a session on
the community domain.

**The trap that costs the most time:** an already-impersonated session cannot start another
impersonation — the quick action silently redirects to `NoAccess.jsp`, and the stale
impersonation banner is the only clue. Clear cookies and re-establish a clean admin session
before clicking, and confirm no "Logged in as" banner is present first.

**When this login is not needed:** the builder live-preview domain renders layout
unauthenticated, so pure geometry checks can skip it entirely. See
[[reference_lwr_site_needs_community_publish]] for which domain serves what.
