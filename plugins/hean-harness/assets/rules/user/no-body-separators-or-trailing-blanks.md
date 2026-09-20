# Meta-file Hygiene

Apply after creating or editing any of these file types: CLAUDE.md, rules (`.claude/rules/`), skills (`.claude/skills/`), agent files (`.claude/agents/`), memory files (`.claude/projects/*/memory/`).

## Rules

**No `---` body separators.** After any create or edit, remove every `---` line that is not part of YAML frontmatter. Frontmatter is the opening `---` … `---` block on lines 1–N before any content — those two delimiters are kept. Any `---` appearing after the frontmatter closing delimiter must be deleted.

**No trailing blank lines.** The file must end with exactly one newline after the last non-empty line. Remove all blank lines at the bottom of the file before saving.
