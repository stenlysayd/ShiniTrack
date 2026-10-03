# ShiniTrack - AI RULES (READ THIS FIRST, EVERY CHAT)

## Goal
Turn ShiniTrack (Tauri v2 Android app, Rust backend, vanilla JS UI) into a Mihon-like manga reader:
library with categories, organized settings, history, updates, download queue, stats, backup, good reader.
Single source only: Shinigami API. No extension system. No trackers (MAL/AniList) for now.

## Stack (do not change)
- Rust: `crates/core` (API, DB, predict), `crates/server` (poller), `app/src-tauri` (Tauri commands).
- UI: `app/ui/` plain HTML + CSS + JS. NO React. NO Vue. NO bundler. NO npm.
- Animation: GSAP, file stored locally in `app/ui/vendor/gsap.min.js`. NO CDN (CSP blocks it, app must work offline).
- Android glue: Kotlin in `app/src-tauri/gen/android/app/src/main/java/id/shinitrack/app/`.
- UI language: Indonesian. Code and comments: English.

## HARD RULES (break one = task failed)
1. READ BEFORE EDIT. Open the file and read it before you change it. Never guess names of functions, Tauri commands, DB tables, CSS classes, or file paths. If you cannot find it, search with grep. If still missing, write `NOT FOUND` and ask me. Do not invent.
2. ONE TASK ONLY. Do exactly the task I give. Do not refactor, rename, or "improve" anything else.
3. SMALL FILES. Every new JS file must be under 300 lines. Every CSS file under 400 lines. If bigger, split it.
4. NEW TAURI COMMAND = 3 PLACES. (a) write it in `app/src-tauri/src/commands.rs`, (b) register it in `generate_handler![]` in `app/src-tauri/src/lib.rs`, (c) add a wrapper in `app/ui/js/api.js`. Missing one = runtime error.
5. NEVER rename or delete an existing command. The JS and Kotlin code depend on them.
6. DATABASE: never edit an old `CREATE TABLE`. Add a numbered migration in `crates/core/src/store.rs` (see docs/ROADMAP.md task 0.4).
7. AFTER EVERY RUST CHANGE run: `cargo check --workspace` then `cargo test --workspace`. Paste the result. If it fails, fix it before anything else.
8. AFTER EVERY JS/CSS CHANGE write a short manual test list (max 5 steps) that I can do on the phone.
9. NO EMOJI in UI. Use SVG icons from `app/ui/icons.js` or add a new one there in the same style.
10. NO new dependency (cargo crate or JS lib) unless I say yes. GSAP is already approved.
11. Follow `DESIGN.md` for colors, spacing, radius. Do not invent new colors.
12. Mihon is Apache-2.0, ShiniTrack is MIT. Use Mihon only as UX reference. NEVER copy Mihon Kotlin code.
13. Do not touch `gen/android` or Kotlin unless the task says so.
14. If unsure, ASK. A question is better than a wrong guess.

## OUTPUT FORMAT (end of every task)
```
CHANGED FILES: (list)
NEW COMMANDS: (list or none)
DB CHANGES: (list or none)
HOW TO TEST: (max 5 steps)
RISKS: (max 3 lines)
```

## CONTEXT SAFETY
- Context is small. Do not paste whole big files back to me. Show only changed parts.
- If the chat gets long (many files opened), STOP. Write what is done and what is next into `docs/PROGRESS.md`, then tell me to start a new chat.
- Always start a task by reading only: this file + the task card in `docs/ROADMAP.md` + files listed in the card.

## Other docs (read only when the task card says so)
- `docs/PROJECT_MAP.md`  - what each file does, known bugs
- `docs/ROADMAP.md`      - phases and task cards
- `docs/SETTINGS_SPEC.md`- exact settings screens
- `docs/GSAP_RULES.md`   - animation rules
- `docs/PROMPTS.md`      - prompt templates
