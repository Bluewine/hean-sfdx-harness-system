---
name: feedback_playwright_for_browser_testing
description: "Use Playwright MCP for browser testing/verification in this project, not the gstack browse skill; instruct subagents the same"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 3d2a4365-5e87-4a54-889a-df0536ebd3ca
---

For browser-based testing and verification in this project (e.g. an Experience Cloud site), use the Playwright MCP tools (`mcp__plugin_playwright_playwright__*`), not the gstack `/browse` skill.

**Why:** The user explicitly directed that testing use Playwright rather than browse. This overrides the global "use /browse for all web browsing" instruction for the testing/verification case in this project.

**How to apply:** Drive verification (navigation, snapshots, screenshots, DOM hit-tests via `browser_evaluate`) through the Playwright MCP tools. When delegating browser testing to a subagent, explicitly instruct it to use Playwright MCP and not the gstack browse skill.
