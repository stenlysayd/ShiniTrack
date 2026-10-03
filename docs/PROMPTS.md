# PROMPTS (copy, paste, change the task number)

## Start a task (new chat every time)
```
Read GEMINI.md first. Then read docs/ROADMAP.md, ONLY task <NUMBER>.
Do only that task. Read every file in the READ list before editing.
Do not guess names. If something is missing, say NOT FOUND and ask me.
When done, give the OUTPUT FORMAT from GEMINI.md.
```

## Expand a phase into task cards (use the Pro model)
```
Read GEMINI.md and docs/PROJECT_MAP.md.
Read docs/ROADMAP.md, ONLY Phase <N>. Also read the files that phase touches.
Expand Phase <N> into small task cards with the same format as Phase 0
(GOAL / READ / EDIT / STEPS / DONE WHEN). Each card must be doable in one chat,
touch at most 4 files, and name the exact functions to read.
Write the cards into docs/ROADMAP.md under that phase. Change nothing else.
```

## When the AI starts hallucinating
```
STOP. You used a name that I cannot find in the code: <NAME>.
Search the repo for it with grep and show me the exact file and line.
If it does not exist, say so and tell me which real name should be used.
Do not write code until this is clear.
```

## When the chat is too long
```
Context is getting long. Write into docs/PROGRESS.md: what is finished, what is half-done
(with file names), and the next step. Then stop. I will start a new chat.
```

## Review after a task (use the Pro model)
```
Review only the files changed in the last task: <LIST>.
Check against GEMINI.md HARD RULES one by one and answer PASS/FAIL for each.
Check: new command registered in lib.rs and api.js? DB change has a migration?
Any raw API string put into innerHTML without escapeHtml? Any file over 300 lines?
Do not change code. Only report.
```

# PROGRESS (copy to docs/PROGRESS.md and tick as you go)
- [ ] 0.1 Audit  - [ ] 0.2 Small bugs  - [ ] 0.3 Read-state bug  - [ ] 0.4 Migrations  - [ ] 0.5 Split app.js  - [ ] 0.6 escapeHtml
- [ ] 1.1 Nav  - [ ] 1.2 Lainnya  - [ ] 1.3 Prefs  - [ ] 1.4 Components
- [ ] 2.1 DB categories  - [ ] 2.2 Commands  - [ ] 2.3 Category screen  - [ ] 2.4 Library tabs  - [ ] 2.5 Fast query  - [ ] 2.6 Sheet
- [ ] Phase 3 Settings  - [ ] Phase 4 Downloads  - [ ] Phase 5 Updates/History  - [ ] Phase 6 Detail/Reader  - [ ] Phase 7 Stats/Backup  - [ ] Phase 8 GSAP  - [ ] Phase 9 Release
