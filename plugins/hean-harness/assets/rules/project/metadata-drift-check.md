---
paths:
  - "force-app/main/**/applications/*.app-meta.xml"
  - "force-app/main/**/permissionsets/*.permissionset-meta.xml"
  - "force-app/main/**/profiles/*.profile-meta.xml"
---

# Metadata Drift Check — CustomApplication, PermissionSet, Profile

Apply before writing or committing any change to a `CustomApplication` (`*.app-meta.xml`), `PermissionSet` (`*.permissionset-meta.xml`), or `Profile` (`*.profile-meta.xml`) metadata file sourced from a `sf project retrieve`.

## Rule

Diff the org's current state against `origin/integration` before running a broad retrieve on one of these three metadata types. Confirm the scale of drift before committing the retrieved result.

## Why

`CustomApplication`, `PermissionSet`, and `Profile` files all accumulate admin-driven, click-based configuration continuously, independent of source control. A retrieve captures the file's entire current state in the org, not just the one element a developer intends to add.

A retrieve meant to capture a single addition (an action override, one field permission, one object permission) can silently pull in hundreds of unrelated entries — per-profile overrides, unrelated field/object/tab permissions, cross-object references. Some of those swept-in entries can point at metadata with no corresponding source file anywhere in the repo, which fails deploy validation — often on a later, unrelated commit, disconnected in time from the retrieve that caused it and hard to trace back to its root cause.

## How to Apply

- **Diff first.** Before retrieving, compare the org's current metadata for the file against `origin/integration` — via a retrieve into a scratch location or a line-count comparison — to see the scale of drift.
- **Small, targeted drift → hand-edit.** When the intended change is one element (a tab, one action override, one field/object permission entry), add it by hand instead of retrieving the whole file.
- **Large or unrelated drift → confirm scope first.** When the org's file differs from `origin/integration` by more than the intended change, stop and confirm with the user whether to capture the full drift or scope the retrieve down, before committing anything.
- **Verify after retrieve.** After any retrieve of one of these files, diff the retrieved result against `origin/integration` and confirm every changed line traces to an intended change.
