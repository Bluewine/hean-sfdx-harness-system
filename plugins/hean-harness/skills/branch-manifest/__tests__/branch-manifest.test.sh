#!/usr/bin/env bash
# Builds throwaway repos covering every branch-manifest scope rule and base-detection path, then asserts the output.
# Requires git, node, and the sf CLI. Usage: bash <skill-dir>/__tests__/branch-manifest.test.sh
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/scripts/branch-manifest.mjs"
ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

put() { mkdir -p "$(dirname "$1")"; printf '%s\n' "${2:-<?xml version=\"1.0\" encoding=\"UTF-8\"?>}" > "$1"; }
putlabels() { mkdir -p "$(dirname "$1")"; cat > "$1"; }
commit() { git add -A && git commit -qm "$1"; }
has() { grep -qF -- "$2" <<<"$1" && echo yes || echo no; }
FAILS=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1"; echo "  expected: $2"; echo "  actual:   $3"; FAILS=$((FAILS + 1)); fi; }
members() { node -e 'const x=require("fs").readFileSync(process.argv[1],"utf8");const o=[];for(const [,b] of x.matchAll(/<types>([\s\S]*?)<\/types>/g)){const t=/<name>([^<]+)</.exec(b)[1];for(const [,m] of b.matchAll(/<members>([^<]+)</g))o.push(t+":"+m)}console.log(o.join(" "))' "$1"; }
new_repo() {
  mkdir -p "$ROOT/$1" && cd "$ROOT/$1" && git init -q -b "$2"
  git config user.email test@example.com && git config user.name test
  put sfdx-project.json '{"packageDirectories":[{"path":"force-app","default":true}],"sourceApiVersion":"67.0"}'
  printf '**/jsconfig.json\n**/__tests__/**\n' > .forceignore
}
D=force-app/main/default

# Scope rules, stale local base, update reporting.
new_repo scope integration
for c in Keep Gone Other; do put $D/classes/$c.cls "public class $c {}"; put $D/classes/$c.cls-meta.xml; done
for l in cmpA cmpB cmpC; do for e in js html css js-meta.xml; do put $D/lwc/$l/$l.$e "/* $l */"; done; put $D/lwc/$l/__tests__/$l.test.js "// $l"; done
put $D/flows/F1.flow-meta.xml
for p in P2 P4; do put $D/permissionsets/$p.permissionset-meta.xml; done
put $D/objects/Obj__c/fields/Existing__c.field-meta.xml
put $D/staticresources/res.resource-meta.xml; put $D/staticresources/res/a.css "a{}"; put $D/staticresources/res/keep.css "b{}"
put force-app/test/test-mocks/lightning/stub.js "export default {};"
commit "base"
git branch -q stale-point
echo "// newer" >> $D/classes/Other.cls && commit "integration moves ahead"
git update-ref refs/remotes/origin/integration HEAD
git reset -q --hard stale-point && git branch -q -D stale-point
git checkout -q -b work-TEST-7_fixture origin/integration
echo "// edit" >> $D/classes/Keep.cls; git rm -q $D/classes/Gone.cls $D/classes/Gone.cls-meta.xml
put $D/objects/Obj__c/fields/New__c.field-meta.xml; echo "// edit" >> $D/lwc/cmpA/cmpA.js
commit "committed changes"
git mv $D/permissionsets/P2.permissionset-meta.xml $D/permissionsets/P3.permissionset-meta.xml && git commit -qm "rename"
echo "<!-- staged -->" >> $D/permissionsets/P4.permissionset-meta.xml && git add $D/permissionsets/P4.permissionset-meta.xml
echo "<!-- unstaged -->" >> $D/flows/F1.flow-meta.xml
rm $D/lwc/cmpC/cmpC.css $D/lwc/cmpB/__tests__/cmpB.test.js $D/staticresources/res/a.css
echo "// mock" >> force-app/test/test-mocks/lightning/stub.js
for e in js html js-meta.xml; do put $D/lwc/cmpD/cmpD.$e "/* cmpD */"; done
put "$D/flows/F2.flow-meta copy.xml"

OUT="$(node "$SCRIPT")"
check "stale local base loses to origin" "yes" "$(has "$OUT" 'Base: origin/integration,')"
check "manifest members" \
  "ApexClass:Keep CustomField:Obj__c.New__c Flow:F1 LightningComponentBundle:cmpA LightningComponentBundle:cmpC LightningComponentBundle:cmpD PermissionSet:P3 PermissionSet:P4 StaticResource:res" \
  "$(members .claude/manifest/TEST-7.xml)"
check "non-metadata paths reported as skipped" "force-app/main/default/flows/F2.flow-meta copy.xml force-app/test/test-mocks/lightning/stub.js" \
  "$(sed -n '/^Skipped/,$p' <<<"$OUT" | tail -n +2 | sed 's/^  //' | sort | paste -sd' ' -)"
check "first run creates" "yes" "$(has "$OUT" 'TEST-7.xml created')"
check "identical rerun leaves the file unchanged" "yes" "$(has "$(node "$SCRIPT")" 'TEST-7.xml unchanged')"
put $D/flows/F3.flow-meta.xml; git checkout -q -- $D/flows/F1.flow-meta.xml
OUT="$(node "$SCRIPT")"
check "update reports added and dropped members" "Flow: F3|Flow: F1" \
  "$(sed -n '/^Added/{n;s/^  //;p;}' <<<"$OUT")|$(sed -n '/^Dropped/{n;s/^  //;p;}' <<<"$OUT")"
OUT="$(printf "update it, I'm done (really) --name Custom-1 \"x\" \$HOME\n" | node "$SCRIPT" --args-stdin)"
check "free-text arguments on stdin yield only the flags" "yes" "$(has "$OUT" 'Custom-1.xml')"

# Hotfix branch created from release: the reflog creation source beats origin's default branch.
git reset -q --hard && git clean -qfd
git checkout -q -b release integration && put $D/classes/Rel.cls "public class Rel {}" && put $D/classes/Rel.cls-meta.xml && commit "release only"
git checkout -q -b hotfix/ABC-9-fix release && put $D/classes/Hot.cls "public class Hot {}" && put $D/classes/Hot.cls-meta.xml
OUT="$(node "$SCRIPT")"
check "hotfix base comes from the branch's creation source" "yes" "$(has "$OUT" 'Base: release,')"
check "hotfix manifest lists only hotfix work, named by work ID" "ApexClass:Hot" "$(members .claude/manifest/ABC-9.xml)"

# Custom-labels scope: only labels that are new or changed count, committed or not; a partial change gets
# no file-level CustomLabels member; a deleted label is reported separately, never listed.
new_repo labels integration
putlabels $D/labels/CustomLabels.labels-meta.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata">
    <labels>
        <fullName>Keep</fullName>
        <categories>Cat</categories>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>Keep desc</shortDescription>
        <value>Keep value</value>
    </labels>
    <labels>
        <fullName>ChangeMe</fullName>
        <categories>Cat</categories>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>Change desc</shortDescription>
        <value>Old value</value>
    </labels>
    <labels>
        <fullName>CatChange</fullName>
        <categories>Cat</categories>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>Cat desc</shortDescription>
        <value>Cat value</value>
    </labels>
    <labels>
        <fullName>DeleteMe</fullName>
        <categories>Cat</categories>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>Delete desc</shortDescription>
        <value>Delete value</value>
    </labels>
</CustomLabels>
XML
putlabels force-app/main/legacy/labels/CustomLabels.labels-meta.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata">
    <labels>
        <fullName>Legacy</fullName>
        <categories>Cat</categories>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>Legacy desc</shortDescription>
        <value>Legacy value</value>
    </labels>
</CustomLabels>
XML
commit "base labels"
git checkout -q -b work-LBL-1_fixture integration
# Committed: ChangeMe's value changes (value-only change), CatChange's categories change, DeleteMe is removed.
putlabels $D/labels/CustomLabels.labels-meta.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata">
    <labels>
        <fullName>Keep</fullName>
        <categories>Cat</categories>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>Keep desc</shortDescription>
        <value>Keep value</value>
    </labels>
    <labels>
        <fullName>ChangeMe</fullName>
        <categories>Cat</categories>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>Change desc</shortDescription>
        <value>New value</value>
    </labels>
    <labels>
        <fullName>CatChange</fullName>
        <categories>Cat2</categories>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>Cat desc</shortDescription>
        <value>Cat value</value>
    </labels>
</CustomLabels>
XML
commit "committed label changes"
# Uncommitted: NewLabel is added to the existing file (unstaged), and a second, brand-new labels file
# (untracked) contributes two more labels, all new.
putlabels $D/labels/CustomLabels.labels-meta.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata">
    <labels>
        <fullName>Keep</fullName>
        <categories>Cat</categories>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>Keep desc</shortDescription>
        <value>Keep value</value>
    </labels>
    <labels>
        <fullName>ChangeMe</fullName>
        <categories>Cat</categories>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>Change desc</shortDescription>
        <value>New value</value>
    </labels>
    <labels>
        <fullName>CatChange</fullName>
        <categories>Cat2</categories>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>Cat desc</shortDescription>
        <value>Cat value</value>
    </labels>
    <labels>
        <fullName>NewLabel</fullName>
        <categories>Cat</categories>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>New desc</shortDescription>
        <value>New label value</value>
    </labels>
</CustomLabels>
XML
putlabels force-app/main/other/labels/CustomLabels.labels-meta.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata">
    <labels>
        <fullName>Alpha</fullName>
        <categories>Cat</categories>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>Alpha desc</shortDescription>
        <value>Alpha value</value>
    </labels>
    <labels>
        <fullName>Beta</fullName>
        <categories>Cat</categories>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>Beta desc</shortDescription>
        <value>Beta value</value>
    </labels>
</CustomLabels>
XML
# A metadata type that sorts before CustomLabel must survive the CustomLabel block rewrite untouched.
put $D/classes/Cls.cls "public class Cls {}"; put $D/classes/Cls.cls-meta.xml
# A whole labels file removed outright (unstaged): every label it held is gone, not just one.
rm force-app/main/legacy/labels/CustomLabels.labels-meta.xml

OUT="$(node "$SCRIPT")"
check "labels: only new or changed labels are listed, from every touched file" \
  "ApexClass:Cls CustomLabel:Alpha CustomLabel:Beta CustomLabel:CatChange CustomLabel:ChangeMe CustomLabel:NewLabel" \
  "$(members .claude/manifest/LBL-1.xml)"
check "labels: unchanged label is absent" "no" "$(has "$OUT" 'CustomLabel: Keep')"
check "labels: partial change gets no file-level CustomLabels member" "no" "$(has "$OUT" 'CustomLabels: CustomLabels')"
check "labels: deleted labels are reported separately, not listed" \
"CustomLabel: DeleteMe
CustomLabel: Legacy" \
  "$(sed -n '/^Deleted custom labels/{n;s/^  //;p;n;s/^  //;p;}' <<<"$OUT")"
check "labels: a type sorting before CustomLabel survives the rewrite" "yes" "$(has "$OUT" 'ApexClass: Cls')"
check "labels: identical rerun leaves the file unchanged" "yes" "$(has "$(node "$SCRIPT")" 'LBL-1.xml unchanged')"

# Another project: trunk named main, branch created from HEAD, no work ID, no origin.
new_repo other main
put $D/classes/A.cls "public class A {}" && put $D/classes/A.cls-meta.xml && commit "base"
git checkout -q -b feature/login && put $D/classes/B.cls "public class B {}" && put $D/classes/B.cls-meta.xml
OUT="$(node "$SCRIPT")"
check "common trunk name found without configuration" "yes" "$(has "$OUT" 'Base: main,')"
check "branch without work ID names the manifest after the branch" "ApexClass:B" "$(members .claude/manifest/feature-login.xml)"
git branch -q -m main trunk
set +e; OUT="$(node "$SCRIPT")"; CODE=$?; set -e
check "no detectable base reports an error line with exit 0" "yes|0" "$(has "$OUT" 'Error: no base branch found')|$CODE"
check "--base resolves an uncommon trunk" "yes" "$(has "$(node "$SCRIPT" --base trunk)" 'Base: trunk,')"
git reset -q --hard && git clean -qfd && git checkout -q -b feature/empty trunk
check "branch without metadata changes writes nothing" "yes|no" \
  "$(has "$(node "$SCRIPT" --base trunk)" 'feature-empty.xml not written')|$([ -e .claude/manifest/feature-empty.xml ] && echo yes || echo no)"
echo "{" > sfdx-project.json
set +e; OUT="$(node "$SCRIPT" --base trunk)"; CODE=$?; set -e
check "malformed sfdx-project.json reports an error line with exit 0" "yes|0" "$(has "$OUT" 'Error: ')|$CODE"

[ "$FAILS" -eq 0 ] && echo "All checks passed" || { echo "$FAILS check(s) failed"; exit 1; }
