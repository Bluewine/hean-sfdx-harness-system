#!/bin/sh
# Prints the installed superpowers:brainstorming skill body, frontmatter stripped, for /hean to inline at load time.
# Resolves the install path from the plugin registry so a plugin upgrade needs no edit here.
d=$(grep -A6 '"superpowers@claude-plugins-official"' "$HOME/.claude/plugins/installed_plugins.json" 2>/dev/null \
  | sed -n 's/.*"installPath": *"\([^"]*\)".*/\1/p' | head -1)/skills/brainstorming
if [ ! -f "$d/SKILL.md" ]; then
  echo HEAN_INJECT_FAILED
  exit 0
fi
echo "Base directory for superpowers:brainstorming: $d"
echo
awk 'n >= 2 { print } /^---$/ { n++ }' "$d/SKILL.md"
