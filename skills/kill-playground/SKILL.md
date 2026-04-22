---
name: kill-playground
description: Kill all running playground instances (web Vite dev server + React Native Metro/Expo bundler). Use when the user says "kill playground", "stop playground", or dev servers are stuck/zombied.
---

# Kill Playground

Terminate all running playground processes: web (`@vlting/playground` Vite) and native (`@vlting/playground-native` Metro/Expo).

## Steps

1. Show what's running first so the user sees what will die:

   ```bash
   ps -ef | grep -E '(vite|metro|expo|playground)' | grep -v grep || echo "no playground processes found"
   lsof -iTCP:5173,8081,19000,19001,19002 -sTCP:LISTEN 2>/dev/null || true
   ```

2. Kill by port (primary — most reliable):

   ```bash
   lsof -ti:5173,8081,19000,19001,19002 | xargs -r kill -9 2>/dev/null || true
   ```

   - `5173` — Vite default (web playground)
   - `8081` — Metro bundler (RN)
   - `19000-19002` — Expo dev tools / tunnel

3. Kill by process name (fallback for anything not bound to those ports):

   ```bash
   pkill -f 'vite.*playground' 2>/dev/null || true
   pkill -f 'node .*/\.bin/vite' 2>/dev/null || true
   pkill -f 'node .*/vlt-ui/.*/vite' 2>/dev/null || true
   pkill -f 'metro' 2>/dev/null || true
   pkill -f 'expo start' 2>/dev/null || true
   pkill -f '@vlting/playground' 2>/dev/null || true
   pkill -f 'dev:playground' 2>/dev/null || true
   pkill -f 'react-native-devtools' 2>/dev/null || true
   ```

   The extra `node .*/\.bin/vite` and `node .*/vlt-ui/.*/vite` patterns catch stray Vite dev servers launched from worktrees whose cmdline is just `node .../vite` without the "playground" token.

4. Verify nothing survived:

   ```bash
   sleep 1
   ps -ef | grep -E '(vite|metro|expo)' | grep -v grep || echo "all clear"
   ```

## Notes

- Don't touch the iOS Simulator itself — only the bundler. `sim-source` skill depends on the Simulator staying up.
- If a port is held by a non-playground process, stop and surface it to the user rather than killing blindly.
