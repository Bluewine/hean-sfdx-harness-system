---
name: staticresource-description-255-limit
description: StaticResource.description is a bounded text field (~255 chars); write it short or the deploy fails on field length, not on the metadata content
type: reference
---

`StaticResource.description` is a standard Salesforce text field capped at roughly 255 characters, same as most metadata description fields. A description written to explain "what this resource holds and which components consume it" easily runs past that if it lists every file and its consumer in full sentences.

**Why:** a description that names several files and their consumers in full sentences passes 255 characters easily. The deploy then fails on field length, and that failure looks like a metadata problem rather than a text-length one — especially if it lands alongside an unrelated error.

**How to apply:** after writing any StaticResource (or similar bounded-field metadata) description, run `grep -o '<description>.*</description>' <file> | sed 's/<[^>]*>//g' | wc -c` (or equivalent) before deploying. Prefer a terse form — `file.png (consumerComponent)` pairs joined by commas/semicolons — over full sentences per file.
