# Temporary helper — extract sole-location / batch-intro snippets from 2cdb8c7
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8")
raw = subprocess.check_output(
    ["git", "show", "2cdb8c7:src/utils/progressiveChatEngine.ts"],
    encoding="utf-8",
    errors="replace",
)

markers = [
    ("continue", "if (actionId === 'continue_single_location')"),
    ("quit", "if (actionId === 'quit_single_location')"),
    ("cancel", "function replyUserCancelled"),
    ("statewide", "Statewide sole lock"),
    ("match_yes", "/^(yes|y|ok|okay|sure|continue)"),
]

for name, needle in markers:
    idx = raw.find(needle)
    print(f"\n===== {name} @ {idx} =====")
    if idx < 0:
        continue
    print(raw[idx : idx + 1100])
