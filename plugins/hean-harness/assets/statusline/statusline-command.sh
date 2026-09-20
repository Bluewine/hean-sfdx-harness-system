#!/usr/bin/env bash
input=$(cat)

cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // ""')
dir=$(basename "$cwd")
model=$(echo "$input" | jq -r '.model.display_name // ""')
worktree=$(echo "$input" | jq -r '.workspace.git_worktree // empty')
session_name=$(echo "$input" | jq -r '.session_name // empty')
used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')

# Cumulative session totals
total_in=$(echo "$input" | jq -r '.context_window.total_input_tokens // 0')
total_out=$(echo "$input" | jq -r '.context_window.total_output_tokens // 0')

# Last single API call output tokens — used to detect cycle boundaries
cur_output=$(echo "$input" | jq -r '.context_window.current_usage.output_tokens // 0')

# ── Per-cycle accumulation ────────────────────────────────────────────────────
# A cycle = user sends message → Claude works → Claude stops (cur_output settles to 0)
# State file: baseline_in baseline_out prev_total_in prev_total_out prev_cur_out
session_id=$(echo "$input" | jq -r '.session_id // "default"')
state_dir="${TMPDIR:-/tmp}/claude-statusline"
mkdir -p "$state_dir"
state_file="$state_dir/turn-${session_id}.state"

baseline_in=0
baseline_out=0
prev_total_in=0
prev_total_out=0
prev_cur_out=0

if [ -f "$state_file" ]; then
    read -r baseline_in baseline_out prev_total_in prev_total_out prev_cur_out < "$state_file" 2>/dev/null
    baseline_in=${baseline_in:-0}
    baseline_out=${baseline_out:-0}
    prev_total_in=${prev_total_in:-0}
    prev_total_out=${prev_total_out:-0}
    prev_cur_out=${prev_cur_out:-0}
fi

# New cycle starts when totals go backward (session reset) OR idle→active transition
if [ "$prev_total_in" -gt "$total_in" ] 2>/dev/null || [ "$prev_total_out" -gt "$total_out" ] 2>/dev/null; then
    baseline_in=$prev_total_in
    baseline_out=$prev_total_out
elif [ "$prev_cur_out" -eq 0 ] 2>/dev/null && [ "$cur_output" -gt 0 ] 2>/dev/null; then
    baseline_in=$prev_total_in
    baseline_out=$prev_total_out
fi

printf '%s %s %s %s %s\n' \
    "$baseline_in" "$baseline_out" \
    "$total_in" "$total_out" \
    "$cur_output" > "$state_file"

cycle_in=$(( total_in - baseline_in ))
cycle_out=$(( total_out - baseline_out ))
[ "$cycle_in" -lt 0 ] && cycle_in=0
[ "$cycle_out" -lt 0 ] && cycle_out=0

# ── Salesforce org segment ───────────────────────────────────────────────────
sf_org_segment=""
if [ -n "$cwd" ]; then
    project_root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)
    sf_org=""
    if [ -n "$project_root" ]; then
        if [ -f "$project_root/.sf/config.json" ]; then
            sf_org=$(jq -r '."target-org" // empty' "$project_root/.sf/config.json" 2>/dev/null)
        fi
        if [ -z "$sf_org" ] && [ -f "$project_root/.sfdx/sfdx-config.json" ]; then
            sf_org=$(jq -r '.defaultusername // empty' "$project_root/.sfdx/sfdx-config.json" 2>/dev/null)
        fi
    fi
    [ -n "$sf_org" ] && sf_org_segment=" $(printf '\033[35m')sf:(${sf_org})$(printf '\033[0m')"
fi

# ── Build git branch segment ──────────────────────────────────────────────────
git_segment=""
if [ -n "$worktree" ]; then
    git_segment=" $(printf '\033[36m')git:(${worktree})$(printf '\033[0m')"
elif [ -n "$cwd" ] && git -C "$cwd" rev-parse --is-inside-work-tree --no-optional-locks 2>/dev/null | grep -q true; then
    branch=$(git -C "$cwd" symbolic-ref --short HEAD 2>/dev/null || git -C "$cwd" rev-parse --short HEAD 2>/dev/null)
    [ -n "$branch" ] && git_segment=" $(printf '\033[36m')git:(${branch})$(printf '\033[0m')"
fi

# ── Helpers ───────────────────────────────────────────────────────────────────
fmt_num() {
    local n=$1
    if [ "$n" -ge 1000 ] 2>/dev/null; then
        printf '%.1fk' "$(echo "scale=1; $n / 1000" | bc)"
    else
        printf '%s' "$n"
    fi
}

# ── Context usage segment ─────────────────────────────────────────────────────
ctx_window_size=$(echo "$input" | jq -r '.context_window.context_window_size // 0')

ctx_segment=""
if [ -n "$used" ]; then
    used_int=$(printf '%.0f' "$used")
    ctx_ab=""
    if [ "$ctx_window_size" -gt 0 ] 2>/dev/null; then
        ctx_used_tokens=$(echo "$used $ctx_window_size" | awk '{printf "%.0f", ($1/100)*$2}')
        in_fmt=$(fmt_num "$ctx_used_tokens")
        win_fmt=$(fmt_num "$ctx_window_size")
        ctx_ab=" $(printf '\033[37m')(${in_fmt}/${win_fmt})$(printf '\033[0m')"
    fi
    ctx_segment=" $(printf '\033[33m')ctx:${used_int}%$(printf '\033[0m')${ctx_ab}"
fi

req_segment=""
if [ "$total_in" -gt 0 ] 2>/dev/null; then
    in_fmt=$(fmt_num "$cycle_in")
    out_fmt=$(fmt_num "$cycle_out")
    session_total=$(( total_in + total_out ))
    total_fmt=$(fmt_num "$session_total")
    sep=" $(printf '\033[90m')│$(printf '\033[0m') "
    req_segment="${sep}$(printf '\033[94m')↑${in_fmt}$(printf '\033[0m') $(printf '\033[92m')↓${out_fmt}$(printf '\033[0m') $(printf '\033[93m')Σ${total_fmt}$(printf '\033[0m')"
fi

# ── Session name segment ──────────────────────────────────────────────────────
session_segment=""
if [ -n "$session_name" ]; then
    session_segment=" $(printf '\033[35m')[${session_name}]$(printf '\033[0m')"
fi

printf "$(printf '\033[32m')➜$(printf '\033[0m')  $(printf '\033[1;36m')%s$(printf '\033[0m')%s%s%s%s  $(printf '\033[90m')%s$(printf '\033[0m')%s\n" \
    "$dir" \
    "$git_segment" \
    "$sf_org_segment" \
    "$ctx_segment" \
    "$req_segment" \
    "$model" \
    "$session_segment"