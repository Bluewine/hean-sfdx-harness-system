# Porting rules

How to take rules, skills, agents and memories that were written inside one repository and turn
them into a plugin that any team can install.

Work through the phases in order. Each rule states what to do and why it matters. A rule marked
**Check** names the command that proves it.

## Phase 1 — Know what a plugin can carry

1. A plugin carries these natively: `skills/`, `agents/`, `commands/`, `hooks/hooks.json`,
   `.mcp.json`, `output-styles/`, `bin/`. Claude Code finds them without any install step.
2. A plugin cannot carry these natively: rule files, memories, the user's `CLAUDE.md`, and the
   status line setting. Ship them as files under `assets/` and have a setup script copy them into
   place.
3. A plugin's own `settings.json` is read for two keys only: `agent` and `subagentStatusLine`.
   Anything else written there is ignored.
4. `.claude-plugin/plugin.json` requires only `name`. Every other field is optional.
5. A marketplace file at the repository root, `.claude-plugin/marketplace.json`, lists the plugins
   and gives each one's source directory. Without it nobody can install the plugin by name.

## Phase 2 — Know where every file lands and when it loads

6. The plugin body lands at
   `~/.claude/plugins/cache/<marketplace-name>/<plugin-name>/<version>/`. It holds the directories
   from Phase 1 rule 1, and nothing else.
7. The whole repository, including the README and any documentation folder, is cloned to
   `~/.claude/plugins/marketplaces/<marketplace-name>/`. Every file committed to the repository
   reaches every installing machine, whether the plugin reads it or not.
8. Skills are never copied into the user's repository. They run from the plugin cache.
9. A skill's description is in context from the start of the session; the body of the skill file is
   read only when the skill is invoked. Write a description that is enough to choose the skill by,
   and do not shorten the body to save context.
10. A rule file with no `paths` field is read at the start of every session. A rule file with a
    `paths` field is read when Claude reads a file matching one of its patterns.
11. Setup copies files to four places. Decide which one each file belongs in before porting it:
    - Rules that apply to every project of the user's → `~/.claude/rules/`
    - Rules that apply to this repository → `<repo>/.claude/rules/`
    - Memories about the project → `~/.claude/projects/<project-key>/memory/`
    - Memories belonging to one agent → `<repo>/.claude/agent-memory/<agent-name>/`
12. The project key in rule 11 is the repository's absolute path with every `/` and every `.`
    replaced by `-`. Build it at run time; never hardcode it.
13. Never write state into the plugin directory. `${CLAUDE_PLUGIN_ROOT}` points at a new path after
    every plugin update, so anything written there is lost, and uninstall stops working. Write state
    to `~/.claude/<plugin-name>/`.

## Phase 3 — Decide what to port, file by file

14. Keep a file only when its content is true for any team on the same platform. Ask: could a
    stranger act on this without access to the source repository?
15. A rule about names — Apex classes, components, branches, commit subjects — is a project choice,
    not a fact. Turn it into a setting. Never ship it as a rule.
16. A rule that depends on a custom object, field or automation the installing team may not have
    must either detect what is there first and fall back, or become a setting. Shipping it as a
    fact makes the rule wrong for most teams.
17. Exclude a rule that only applies to a tool the team may not use.
18. Exclude a rule whose whole subject became a setting. Two sources for the same decision produce
    arbitrary behaviour.
19. When a phrase cannot be generalised, delete the phrase. Do not rename the thing it points at:
    a renamed reference points at nothing and is worse than no reference.
20. After deleting phrases, read the whole file again. If most of it had to go, the topic was
    repo-specific too. Drop the file and say so in the report. A silent deletion looks like an
    oversight.
21. Names from a managed package that anyone can install stay verbatim. They are not repo-specific.

## Phase 4 — Clean the content

22. Replace every org or sandbox name with a description of the role: "the connected and selected
    org", "the shared integration sandbox".
23. Remove every class, method, component or file name that exists only in the source repository.
24. Remove every repository path used to scope advice. A rule is about a platform situation, not a
    folder.
25. Keep a work-item prefix only as an illustration of a shape, never as the team's real prefix.
26. Remove every date attached to a claim. A date signals that a specific file, class, org or test
    run is about to be named. Write the mechanism instead of the observation.
27. This covers every wording: "confirmed live on", "measured on", "verified against", "observed
    in", "reproduced with", "captured", "this session", "an earlier version of this note".
28. Remove every count taken from one run — "157 files", "22 consecutive runs". It cannot be
    reproduced and it dates the entry.
29. Remove the history of the note itself.
30. Write the description in a git commit message or a PR title with a capital first letter, in the
    form `@{ID}: {Description}`. This holds for a literal phrase, a placeholder, and an exact string
    another step matches on.
31. When one step writes a phrase and another step searches for it, write it once and search for
    the same text. Add case-insensitive matching when a person may type it differently.
32. Never put angle brackets in a placeholder that sits inside XML. `<members><SampleClass></members>`
    is not valid XML and breaks any parser reading the file. Use a plain identifier.
33. Check that every cross-reference between memories resolves. A `[[name]]` link matches either a
    memory's filename or its `name:` field, so check both before calling one broken. When the
    target is a rule rather than a memory, replace the link with the rule's installed path.

**Check:** search the ported tree for org names, project names, team prefixes and dates.

## Phase 5 — Fix every path, reference and trigger

34. Read a file the plugin ships with `${CLAUDE_PLUGIN_ROOT}/...`. A repository-relative path to a
    plugin file worked while the file lived in the repository and fails once it ships.
35. Write a file the skill produces to `<repo>/.claude/skills/<skill-name>/output/`. Each skill owns
    the directory named after itself.
36. Never have one skill write into another skill's directory, and never have one skill depend on
    a file another skill left behind. Each skill creates what it needs and removes it afterwards.
37. Never copy shared content into two skills. Keep one file and have each skill read it, so a
    later correction reaches every caller.
38. Replace every command that only exists in the source repository with the plugin's own
    equivalent.
39. A glob in a rule's `paths` field is matched against files Claude reads. A glob pointing at a
    skill's own directory stops matching once the skill moves into the plugin, because the skill's
    file is no longer inside the repository.
40. Make the skill read the rule file by path, and keep a `paths` glob as well. The explicit read is
    the mechanism to rely on: it works wherever the rule lives and costs nothing until the skill
    runs. Whether a glob can match a file outside the repository is not documented, so treat the
    glob as a bonus and never as the only trigger.
41. Write the glob broadly enough to cover the skill's whole directory, not only its data files.
    The skill's own body is read at invocation, and the skill may also read templates beside it.
42. Give a rule no `paths` field only when it must apply to every session of every installing team.
    Anything narrower costs every team context they will not use.
43. Test every glob against a real repository before shipping it. A pattern that looks right can
    match nothing — a directory named `test` is not matched by a glob written `tests`.

**Check:** list each rule's globs and run each one against a real repository of the target kind.

## Phase 6 — Turn project choices into settings

44. Keep every project choice in one file inside the repository, and add that file to `.gitignore`.
    The answers belong to the person, not the team.
45. Enforce a setting only when the team recorded one. An unset setting blocks nothing and asks
    nothing.
46. Ask for the settings in an interactive step. A script cannot hold a conversation, so a
    non-interactive setup step only reports which settings are missing.

## Phase 7 — Make install reversible and honest

47. Record every change setup makes in a manifest file, and have uninstall reverse exactly those
    changes. Store the manifest outside the plugin directory, for the reason in rule 13, and so
    uninstall still works after the plugin is removed.
48. Record one entry type per file. Recording a file as both a copy and a block edit makes uninstall
    delete a file it should only have edited.
49. Reverse an edit to a file that already existed by removing the block setup added, never by
    restoring the backup. Restoring the backup throws away everything the user wrote afterwards.
50. Refuse to edit a file whose opening marker has no closing marker, and say why. Editing it
    blindly deletes everything below the opening marker.
51. Keep a copy of every file setup replaced, and never delete those copies on uninstall.
52. Pass the target repository to every install script explicitly. A script that resolves the
    repository from the working directory will write into whatever directory it happens to run in.
53. Print which repository the script resolved, and say whether it had to guess.
54. Report a missing prerequisite and carry on, when only some features need it. Print the exact
    command that fixes it for this platform. Stop the run only for a prerequisite that every
    feature needs.
55. Make the features that need that prerequisite name what they could not run. A report that looks
    complete while part of it never executed is worse than no report.
56. Add every directory the skills write into to the repository's `.gitignore`. A skill that calls
    its output directory ignored while nothing ignores it leaves untracked files after every run.
57. Prefer one wildcard pattern over a list, so a skill added later is covered without another
    change.
58. Have uninstall report the `.gitignore` lines setup added. Uninstall does not remove them,
    because the user may have written their own lines around them.
59. Ask the user whether to keep or delete the answers they recorded. Present both choices without
    recommending one.

**Check:** install into an empty home directory, then uninstall, and confirm every manifest entry
reports success and every edited file returns to its earlier content.

## Phase 8 — Verify before publishing

60. Run the plugin validator in strict mode after every change.
61. Name every skill file `SKILL.md` with that exact capitalisation. A file named `skill.md` works
    on a case-insensitive filesystem and fails on Linux.
62. Re-measure every count and re-check every factual claim in user-facing text after every change.
    A count of rules, skills, agents or memories goes stale the moment a file is added or removed,
    and one fix commonly invalidates a sentence written for an earlier one.
63. Implement every promise the user-facing text makes. A README that says a command reports
    something must not describe behaviour the command does not have.
64. Compare each ported skill against the document it came from, when one exists. A skill rewritten
    from memory drifts from the process it is supposed to follow, and the drift is invisible until
    someone runs it.
65. Match the exact wording a process document specifies, even when the wording breaks a convention
    the rest of the plugin follows. State the reason next to it so nobody corrects it back.
66. Never infer, from what is in the repository, a decision that is made outside it at run time.
    When two situations leave identical branches, commits and pull requests, the difference is not
    in the repository. Ask, and record in the skill why inference is not possible, so nobody adds
    it later.

## Phase 9 — Publish without leaking

67. Search file contents, file names, and binary files separately. A content search that skips
    binary files will not see a work item ID in an image's filename.
68. Delete sample output from the source project before publishing — screenshots, rendered reports,
    captured data.
69. Check the whole history, not only the current files. A repository built by generalising files
    commit by commit holds the un-generalised versions in its early commits, and a public repository
    serves the whole history.
70. When the history cannot be published, publish the finished tree as a fresh commit and keep the
    full history in a bundle file outside the repository.
71. Keep maintainer notes out of the published tree when they name the source project. Add them to
    `.gitignore` rather than deleting them.
72. Give the full HTTPS clone URL in the README, not the shorthand form. The shorthand can resolve
    to SSH, which fails for anyone without an SSH key on their account.

**Check:** list every published file name and search for project names, team prefixes and binary
file extensions.

## Phase 10 — Test as a new user

73. Start Claude Code with `CLAUDE_CONFIG_DIR` set to an empty directory. That session has no
    skills, no agents, no rules and no plugins, and asks the user to sign in, which is the state a
    new colleague is in.
74. Do not override `HOME` to get the same effect. It hides the Salesforce CLI's authenticated orgs,
    the git commit identity and the SSH keys, so the parts of the plugin that deploy, test and
    commit cannot run.
75. Neither variable removes installed software. Every tool stays on `PATH`, so a check for a
    missing prerequisite never fires. Reproduce that with a second account on the machine, or by
    starting the session with a restricted `PATH`.
76. Install through the marketplace rather than pointing at a local directory. Only a real install
    proves that `${CLAUDE_PLUGIN_ROOT}` resolves and that setup works with no existing configuration
    to lean on.
