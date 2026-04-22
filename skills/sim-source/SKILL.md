---
name: sim-source
description: Switch the iOS Simulator's Metro bundler between the main repo root and a git worktree. Use when the user wants the running playground-native app to load sources from a worktree (to preview in-progress work) or switch back to the main checkout.
---

# sim-source

Repoints the running `playground-native` Metro bundler at a different source directory. The installed iOS Simulator binary connects to Metro on `localhost:8081` and will pick up whichever source tree Metro is serving.

## How it works

- Each checkout has its own `apps/playground-native/metro.config.js` which resolves `monorepoRoot` as `../..` and writes `.source-root.json`.
- Switching source = kill the current Metro process, `cd` into the target checkout's `apps/playground-native`, run `yarn dev` (alias for `expo start --clear`).
- No rebuild of the native binary is needed as long as native deps haven't changed.

## Procedure

1. **Read current source**
   ```
   cat <REPO_ROOT>/apps/playground-native/.source-root.json
   ```
   Shows `{ "root": "...", "worktree": "<name>" | null }`.

2. **List available targets**
   - Main: `/Users/lucas/Sites/vlt-ui`
   - Worktrees: `git -C /Users/lucas/Sites/vlt-ui worktree list`
   - Filter to those containing `apps/playground-native/` (all do, in this monorepo).

3. **Ask user** (via `AskUserQuestion`) which target to switch to. Show current in the question. Options are the main repo + each worktree branch.

4. **Kill running Metro**
   ```
   lsof -tiTCP:8081 -sTCP:LISTEN | xargs -r kill
   ```
   Wait for port to free (poll `lsof -iTCP:8081` until empty, max 5s).

5. **Start from target**
   ```
   cd <TARGET>/apps/playground-native && yarn dev
   ```
   Run in background (`run_in_background: true`).

6. **Verify**
   - Poll `<TARGET>/apps/playground-native/.source-root.json` until `root` matches target (written on Metro config load).
   - Confirm port 8081 is listening again.
   - On the Simulator, the user presses `r` in Metro (or shakes device → Reload) to reload the bundle. Mention this.

## Notes

- **Native deps must match.** If the target worktree has a different `react-native` / Expo version or added native modules, the installed sim binary won't work — requires `yarn ios` rebuild. Check `git diff <main> <target> -- apps/playground-native/package.json` before switching.
- **Do not** edit `metro.config.js` to hard-code paths. The `../..` resolution is correct by design.
- **Worktree cleanup**: if user asks to switch away from a worktree and then remove it, switch first (to avoid Metro holding file handles).
- **Simulator state persists** across source switches (AsyncStorage, nav state). That's usually desirable; mention if it could confuse the user.

## When to offer this skill

- User mentions wanting to preview a worktree's changes on the sim.
- User is reviewing a PR / `/do` output and the changes are UI-visible.
- User says "switch the sim to X" or "point the sim at the worktree".
