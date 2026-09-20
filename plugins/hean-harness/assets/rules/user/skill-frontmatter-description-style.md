# Skill Frontmatter Description Style

Apply these conventions every time the `description:` field in the frontmatter is written or edited in any SKILL.md — no exceptions.


## Structure — two allowed forms

**Form A — Noun-led with em-dash extension (most common)**
```
[Noun phrase: what the mechanism is] — [verb clause: what it does or how]
```

**Form B — Verb-led (for setup, config, or utility skills)**
```
[Imperative verb phrase] [object] [purpose/outcome]
```

Never open with "A", "An", or "The".


## Content rules

- Name specific tools, models, platforms, or agent types in parens when they clarify scope: `(Telegram, Discord, Slack)`, `(autopilot, ralph, ultraqa)`
- Quantify when meaningful: "up to 5 agents", "N coordinated agents", "up to five cycles"
- End with a constraint or differentiator when it bounds scope: `"...with no raw CLI assembly"`, `"...rather than leaving insights in chat history"`, `"...without persistence overhead"`
- Use domain jargon freely — the reader is technical: "PRD-driven", "worktree-first", "tournament selection", "ambiguity-scoring"


## Tone rules

- Dense and exact — cut every filler word
- Zero standalone marketing adjectives: no "powerful", "seamless", "easy", "comprehensive", "robust"
- Assumes the reader already knows the ecosystem — no hand-holding


## Length

- Target: 20–45 words
- Em-dash extension (Form A) may stretch to 50 words maximum
- One sentence only — no period chains, no semicolons to start a second clause


## Self-check before finalizing

- [ ] Opens without "A/An/The"?
- [ ] One sentence (em-dash extension allowed)?
- [ ] Specific tools/models named if they matter?
- [ ] Constraint or differentiator present if scope needs bounding?
- [ ] Under 50 words?
- [ ] No standalone puff adjectives?


## Examples

```yaml
# Form A — noun-led
description: Parallel execution engine that runs multiple agents simultaneously for independent tasks with smart model routing and no persistence overhead.

# Form A — with em-dash
description: Self-referential persistence loop until task completion — PRD-driven system that iterates on structured user stories until all pass mandatory reviewer verification.

# Form B — verb-led
description: Configure Model Context Protocol (MCP) servers to extend Claude Code's capabilities with external tools like web search, file system access, and GitHub integration.

# Form B — imperative with constraint
description: Turn a repeatable workflow from the current session into a reusable OMC skill draft rather than rediscovering it later.
```