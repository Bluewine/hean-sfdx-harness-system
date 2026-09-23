---
name: feedback_playwright_for_browser_testing
description: "Use the ego-browser skill for browser testing/verification when ego lite is installed, Playwright MCP when it is not, never the gstack browse skill; instruct subagents the same"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 3d2a4365-5e87-4a54-889a-df0536ebd3ca
---

For browser-based testing and verification in this project (e.g. an Experience Cloud site), use
the `ego-browser` skill when the ego lite browser is installed (`command -v ego-browser`
succeeds). When it is not, use the Playwright MCP tools (`mcp__plugin_playwright_playwright__*`).
Never use the gstack `/browse` skill.

**Why:** the user chose ego-browser first, with Playwright MCP as the fallback on machines
without ego lite. The user directed earlier that testing never goes through gstack browse. This
overrides the global "use /browse for all web browsing" instruction for testing and verification
in this project.

**How to apply:** check for `ego-browser` once per session, then drive navigation, snapshots,
screenshots and DOM checks through that tool. When delegating browser testing to a subagent, name
the tool to use and tell it not to use the gstack browse skill. A site the user is signed into
only in Chrome loads signed out in ego lite: [[reference_egobrowser_no_chrome_cookies]].
