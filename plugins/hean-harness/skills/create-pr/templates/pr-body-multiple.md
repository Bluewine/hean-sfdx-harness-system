<!-- Repeat this block once per story (per merged work ID). {N} is the 1-based story index. Story 1 is the root branch. -->
## Story {N}

[{WORK-ID}: {TITLE}]({LINEAR_URL})

---

### What was Done?
{BULLETS}

---

<!-- Omit this block entirely, including both --- separators, if this story has no Sonar-fix commits. -->
### Sonar Fixes
{SONAR_BULLETS}

---

<!-- Omit this block entirely, including both --- separators, if this story has no commits confined to .claude/ or other non-deliverable repo tooling. -->
### Framework Changes
{FRAMEWORK_BULLETS}

---

<!-- Omit this block entirely, including both --- separators, if this story has no runbook script, no runbook metadata, no destructive-manifest entry, and no manual step the user named. Never render a placeholder row for a stage that has nothing. -->
### Pre and Post Deployment Steps
{DEPLOYMENT_STEPS}

---

<!-- Omit this block entirely, including both --- separators, if the user did not opt in to screenshots for this story this run. -->
### Screenshots
{SCREENSHOTS}

---
<!-- End repeat. -->

<!-- Repeat this line once per story, same order as above, so every Resolves line is grouped at the very end. -->
Resolves {WORK-ID}
<!-- End repeat. -->

---
