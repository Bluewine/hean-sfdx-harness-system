---
name: feedback-pr-body-write-override
description: "When writing .claude/skills/<skill-name>/output/ output files in the create-pr skill, use Bash heredoc to override directly — never use the Write tool which requires reading first"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 88179600-1815-4c5f-a5f0-13e02264b127
---

When writing the rendered PR body to `.claude/skills/<skill-name>/output/{WORK-ID}.md`, use a Bash heredoc (`cat > file <<'EOF'`) to write directly and override any existing file without needing to read it first.

**Why:** The Write tool requires a prior Read call. For an output file that is always fully regenerated, that read is unnecessary friction and breaks the flow.

**How to apply:** In the create-pr skill (and any similar output-file pattern), always write via Bash redirect, never via the Write tool.