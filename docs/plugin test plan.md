# Plugin test plan

How to simulate a fresh environment for testing this plugin, using the environment variable
Anthropic provides for exactly that: `CLAUDE_CONFIG_DIR`.

## Step 0 — push first, or you will test the wrong code

A marketplace install clones from GitHub. If `origin/main` is behind your disk, the install fetches
the published commit and misses your newest work.

```bash
git -C ~/git-repos/hean-sfdx-harness-system push origin main
```

## Step 1 — a throwaway Salesforce project as the target

```bash
mkdir -p ~/harness-test && cd ~/harness-test
git init -b main

cat > sfdx-project.json <<'JSON'
{
  "packageDirectories": [{ "path": "force-app", "default": true }],
  "name": "harness-test",
  "namespace": "",
  "sfdcLoginUrl": "https://login.salesforce.com",
  "sourceApiVersion": "65.0"
}
JSON

printf '{"name":"harness-test","devDependencies":{}}\n' > package.json
mkdir -p force-app/main/default
```

The `package.json` matters: without one, setup's environment step reports the node-modules check as
*skipped* rather than exercising it. Other teams clone existing repositories that always have one.

## Step 2 — start Claude Code with an empty configuration

```bash
mkdir -p ~/harness-onboarding
cd ~/harness-test
CLAUDE_CONFIG_DIR=~/harness-onboarding/.claude claude
```

That one variable relocates settings, session history and plugins. Everything else about the machine
stays real — authenticated Salesforce orgs, git identity, SSH access — so the skills that deploy,
test and open pull requests can actually run.

**Expect to be asked to sign in.** The macOS Keychain entry is keyed to the configuration directory,
so a different directory is a signed-out session. Your own login is untouched under its own entry.
This is the state a new colleague is in, so it is worth seeing rather than avoiding.

## Step 3 — install and set up

```
/plugin marketplace add https://github.com/Bluewine/hean-sfdx-harness-system.git
/plugin install hean-harness@hean-sfdx-harness-system
/hean-harness:setup
```

Use the full HTTPS URL, not the `owner/repo` shorthand — the shorthand resolves to SSH, which is
what a colleague without a key would hit.

## Step 4 — check it, then reverse it

```
/hean-harness:doctor
/hean-harness:uninstall
rm -rf ~/harness-onboarding ~/harness-test
```

## What to watch for

**Three environment items will report missing** in a bare project — the code analyzer plugin,
`node_modules`, and superpowers. That is the check working, and each line prints its fix.

**The real `~/.zshrc` will be edited.** The alias has to go where the shell reads it, so the
configuration directory cannot hold it. It arrives as a marked block and uninstall removes only that
block.

**Four things this proves that a local-directory install cannot.** Whether `${CLAUDE_PLUGIN_ROOT}`
resolves in a real marketplace install rather than a local directory. Whether setup works with no
existing `~/.claude` to lean on. Whether the login prompt behaves as documented. And whether a
path-scoped glob can match a file outside the repository, which decides if the Linear rule's
frontmatter does anything — nothing breaks either way, since the four skills that need that rule
read it by path.

## Two variables not to use

**Do not override `HOME`.** It hides the Salesforce CLI's authenticated orgs, the git commit
identity and the SSH keys. Measured: four authenticated orgs become zero. The parts of the plugin
worth testing then cannot run.

**`CLAUDE_CODE_PROJECT_DIR_NAME`** exists and takes effect only alongside `CLAUDE_CONFIG_DIR`,
naming the folder under `projects/` for transcripts and memory. It is not needed here; it is
mentioned so it is not a surprise in the documentation.

## What this cannot simulate

Neither variable removes installed software — `PATH` is untouched, so `node`, `sf`, `java` and `gh`
are all still found. A genuinely bare machine needs a second macOS account, where `java` resolves to
`/usr/local/bin/java`, the Salesforce stub, and the environment check's most important branch
finally fires.
