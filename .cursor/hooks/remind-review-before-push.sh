#!/usr/bin/env bash
# Cursor beforeShellExecution hook: prompt before git push so you can run
# pre-commit-reviewer (or finish review) before the command runs.
exec python3 -c "
import json, re, sys

raw = sys.stdin.read()
try:
    data = json.loads(raw)
except Exception:
    print(json.dumps({'permission': 'allow'}))
    sys.exit(0)

cmd = data.get('command') or ''
if re.search(r'\\bgit\\s+push\\b', cmd):
    print(json.dumps({
        'permission': 'ask',
        'user_message': 'You are about to push. If you have not already, run the pre-commit-reviewer subagent on your diff (staged + unstaged) before continuing.',
        'agent_message': 'Before git push: delegate to the pre-commit-reviewer subagent and review the change set (e.g. git diff / git diff --cached). Proceed with push only after blockers are addressed.'
    }))
else:
    print(json.dumps({'permission': 'allow'}))
"
