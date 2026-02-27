---
name: relay
description: "Inter-agent communication server. Start/stop the relay, check status, or coordinate between multiple Claude Code agents running in parallel."
user_invocable: true
license: MIT
metadata:
  author: Lucas Castro
  version: 2.0.0
---

# Relay

A lightweight inter-agent communication layer built on Unix domain sockets. Enables multiple Claude Code agents (in separate terminal windows) to coordinate in real time — instant event broadcasting, role enforcement, and disconnect detection.

---

## Invocation

```
/relay              — Ensure relay is running (start or reclaim)
/relay stop         — Stop the relay server (refuses if agents are still connected)
/relay stop --force — Stop the relay server even if agents are still connected
/relay status       — Show connected agents and uptime
```

**Disambiguation:**
- `/relay` alone → ensure running
- `/relay stop` → smart stop (refuses if clients connected)
- `/relay stop --force` → unconditional stop
- `/relay status` → show status

---

## Architecture

```
.ai-relay/              ← per-project runtime directory (gitignored)
  relay.sock            ← Unix domain socket
  relay.pid             ← server PID for lifecycle management

~/.claude/skills/relay/
  SKILL.md              ← this file
  server.js             ← relay server (~140 lines, zero dependencies)
```

The relay server is a Node.js process that:
- Listens on a Unix domain socket (`.ai-relay/relay.sock`)
- Tracks connected clients by role (`orchestrator`, `worker`) and PID
- Broadcasts events to all connected clients
- Detects disconnections instantly (socket close) and notifies remaining clients
- Enforces single-orchestrator rule (only one orchestrator at a time)

**The socket connection IS the heartbeat.** When an agent's process dies, the OS closes its socket. The relay server detects this immediately and broadcasts a `{role}-disconnected` event with the dead agent's PID and any tasks it owned. No polling, no stale thresholds — instant detection.

---

## Protocol

All messages are **newline-delimited JSON** over the Unix domain socket.

### Client → Server

| Message | Purpose |
|---------|---------|
| `{"type":"identify","role":"worker","pid":12345}` | Register as a worker |
| `{"type":"identify","role":"orchestrator","pid":12345}` | Register as orchestrator (rejected if one exists) |
| `{"type":"event","event":"work-queued","detail":"..."}` | Broadcast an event to all other clients |
| `{"type":"event","event":"task-claimed","task":"003","pid":12345}` | Announce task ownership (server tracks it) |
| `{"type":"event","event":"task-completed","task":"003"}` | Release task ownership |
| `{"type":"event","event":"epic-done"}` | Signal workers to exit gracefully |
| `{"type":"status"}` | Request current server state |

### Server → Client

| Message | Purpose |
|---------|---------|
| `{"type":"state","orchestrator":true,"workers":2}` | Sent after successful `identify` |
| `{"type":"role-taken","active_pid":12345}` | Orchestrator role already claimed |
| `{"type":"event","event":"worker-disconnected","pid":12345,"tasks":["003"]}` | Agent died, these tasks are orphaned |
| `{"type":"event","event":"orchestrator-disconnected","pid":12345,"tasks":[]}` | Orchestrator died |
| `{"type":"status-response","clients":[...],"uptime":3600}` | Response to status query |

Events are broadcast to all clients **except the sender**. Disconnection events are generated automatically by the server when a client's socket closes.

---

## Lifecycle Management

### `/relay` (ensure running)

```
Check .ai-relay/relay.pid:
  → File exists?
    → PID alive? (kill -0)
      → Socket responsive? (connect + status query)
        → YES: "Relay running (pid X, Y clients connected)"
        → NO:  Kill stale process, remove .sock + .pid, start fresh
      → NO: Remove .sock + .pid, start fresh
    → NO: Remove stale .sock + .pid if present, start fresh
  → File missing?
    → Remove stale .sock if present, start fresh
```

**Starting fresh:**
```bash
nohup node ~/.claude/skills/relay/server.js "$(pwd)/.ai-relay" > .ai-relay/relay.log 2>&1 &
```

Wait up to 2 seconds for `.ai-relay/relay.sock` to appear. Verify by connecting and sending a status query.

### `/relay stop`

Smart stop — refuses to shut down if agents are still connected. This enables the "last one out turns off the lights" pattern: multiple agents (Q workers, Epic orchestrator) all call `/relay stop` on exit, but only the last one actually stops the server.

**Procedure:**

1. **Check if relay is running.** Read `.ai-relay/relay.pid`, verify the PID is alive, verify the socket is responsive. If relay is not running, print "Relay is not running." and exit.

2. **Query connected clients:**
   ```bash
   CLIENT_COUNT=$(node -e "
   const s = require('net').connect(process.argv[1]);
   s.write(JSON.stringify({type:'status'})+'\n');
   s.on('data', d => {
     for (const line of d.toString().split('\n').filter(Boolean)) {
       try {
         const r = JSON.parse(line);
         if (r.type==='status-response') {
           console.log(r.clients ? r.clients.length : 0);
           s.destroy();
         }
       } catch {}
     }
   });
   setTimeout(() => { console.log('0'); s.destroy(); }, 2000);
   " "$(pwd)/.ai-relay/relay.sock")
   ```

3. **If `CLIENT_COUNT > 0` (and `--force` was NOT passed):** Refuse to stop. Print:
   ```
   Relay still has N connected agent(s). Not stopping.
   Use `/relay stop --force` to stop regardless.
   ```
   Exit without stopping.

4. **If `CLIENT_COUNT == 0` or `--force` was passed:** Stop the server:
   ```bash
   PID=$(cat .ai-relay/relay.pid 2>/dev/null)
   if [ -n "$PID" ]; then
     kill "$PID" 2>/dev/null
     # Server cleans up .sock and .pid on exit
   fi
   ```
   Print "Relay stopped." (or "Relay force-stopped (N agent(s) were still connected)." if forced).

If PID file is missing but socket exists, remove the stale socket file.

### `/relay status`

Connect to the relay and send a status query:
```bash
node -e "
const s = require('net').connect('$(pwd)/.ai-relay/relay.sock');
s.write(JSON.stringify({type:'status'})+'\n');
s.on('data', d => {
  for (const line of d.toString().split('\n').filter(Boolean)) {
    try { const r = JSON.parse(line); if (r.type==='status-response') { console.log(JSON.stringify(r,null,2)); s.destroy(); } } catch {}
  }
});
setTimeout(() => { console.log('timeout'); s.destroy(); }, 2000);
"
```

Print a formatted summary:
```
--- Relay status ---
PID: 12345
Uptime: 1h 23m
Connected:
  orchestrator (pid 12345) — 0 tasks
  worker (pid 12346) — 1 task (003)
  worker (pid 12347) — 0 tasks
---
```

---

## Integration Helpers

Other skills (`q`, `epic`) use these inline Node.js snippets to interact with the relay. These are **not separate scripts** — they are bash commands that skills embed directly.

### Check if relay is running

```bash
RELAY_SOCK="$(pwd)/.ai-relay/relay.sock"
RELAY_PID_FILE="$(pwd)/.ai-relay/relay.pid"
RELAY_RUNNING=false
if [ -f "$RELAY_PID_FILE" ] && kill -0 "$(cat "$RELAY_PID_FILE")" 2>/dev/null && [ -S "$RELAY_SOCK" ]; then
  RELAY_RUNNING=true
fi
```

### Connect, identify, and disconnect

```bash
node -e "
const s = require('net').connect(process.argv[1]);
s.write(JSON.stringify({type:'identify',role:process.argv[2],pid:+process.argv[3]})+'\n');
s.on('data', d => {
  for (const line of d.toString().split('\n').filter(Boolean)) {
    try { console.log(line); } catch {}
  }
  s.destroy();
});
setTimeout(() => s.destroy(), 2000);
" "$RELAY_SOCK" "worker" "$PPID"
```

### Send a one-shot event

```bash
node -e "
const s = require('net').connect(process.argv[1]);
s.write(JSON.stringify({type:'event',event:process.argv[2]})+'\n');
setTimeout(() => s.destroy(), 500);
" "$RELAY_SOCK" "work-queued"
```

### Wait for an event (blocking)

Used by QTM workers in RFX mode. Blocks until a matching event arrives or timeout.

```bash
node -e "
const s = require('net').connect(process.argv[1]);
const events = new Set(process.argv.slice(3));
const timeout = setTimeout(() => { console.log('RFX_TIMEOUT'); s.destroy(); }, +process.argv[2]);
s.write(JSON.stringify({type:'identify',role:'worker',pid:process.env.PPID||0})+'\n');
s.on('data', d => {
  for (const line of d.toString().split('\n').filter(Boolean)) {
    try {
      const msg = JSON.parse(line);
      if (msg.type === 'event' && events.has(msg.event)) {
        clearTimeout(timeout);
        console.log(msg.event);
        s.destroy();
      }
    } catch {}
  }
});
" "$RELAY_SOCK" "600000" "work-queued" "epic-done" "worker-disconnected"
```

The output is the event name that triggered the wake-up, or `RFX_TIMEOUT` if the timeout expires. The caller inspects this to decide what to do next.

---

## Relationship to Other Skills

### Q (execution engine)

Q starts relay at QTM startup if it is not already running, and calls `/relay stop` on QTM exit. The smart stop is a no-op if other agents are still connected — only the last agent out actually stops relay.

| Q behavior | With relay | Without relay (fallback) |
|-----------|-----------|------------------------|
| QTM startup | Start relay if not running (idempotent) | N/A — relay is always started |
| RFX idle wait | Block on socket event — instant wake-up | Poll every 15s for 10 minutes |
| Task claimed | Send `task-claimed` event | Write LAT + PID to file (still done regardless) |
| Task completed | Send `task-completed` event | Archive to `_completed/` (still done regardless) |
| Orphan detection | Instant via `worker-disconnected` event | 5-minute stale LAT threshold |
| QTM exit | Call `/relay stop` (smart — no-op if others connected) | N/A |

**Important:** File-based heartbeats (LAT + PID in task files) are ALWAYS written, regardless of relay. Relay accelerates detection but the file data is the durable fallback.

**Fallback:** If relay fails to start (e.g., `server.js` missing, Node.js unavailable), Q continues without relay using file-based polling — the same behavior as before.

### Epic (orchestration layer)

Epic starts relay during PLAN and calls `/relay stop` during COMPLETION. The smart stop means relay stays alive if Q workers haven't disconnected yet — they'll clean up on their way out.

| Epic behavior | With relay |
|--------------|-----------|
| `/epic {goal}` | Starts relay server during PLAN. Workers can connect immediately. |
| `/epic` (bare) | Ensures relay is running. Connects as orchestrator. If role taken → falls back to `/q`. |
| BREAKDOWN complete | Sends `work-queued` → workers wake instantly. |
| ITERATE complete | Sends `work-queued` → workers wake instantly. |
| COMPLETION | Sends `epic-done` → workers exit gracefully. Calls `/relay stop` (smart). |

### Lifecycle: "last one out turns off the lights"

Both Q and Epic call `/relay stop` on exit. Since the stop is smart (refuses if agents are connected), the relay stays alive as long as any agent needs it. The last agent to disconnect and call `/relay stop` is the one that actually shuts down the server. No ownership tracking is needed — the connected-client count is the sole arbiter.

**Typical multi-agent flow:**
```
T1: /epic {goal}   → starts relay → exits
T1: /epic           → ensures relay → orchestrator role → drains tasks
T2: /q              → ensures relay (already running, no-op) → worker → drains tasks
T3: /q              → ensures relay (already running, no-op) → worker → drains tasks
...epic completes...
T1: /epic COMPLETION → sends epic-done → /relay stop → 2 clients connected → refused
T2: /q receives epic-done → exits QTM → /relay stop → 1 client connected → refused
T3: /q receives epic-done → exits QTM → /relay stop → 0 clients → relay stopped ✓
```

---

## `.ai-relay/` Directory

This directory is created at the repo root when the relay server starts. It contains only runtime artifacts:

- `relay.sock` — Unix domain socket (deleted on server exit)
- `relay.pid` — Server PID (deleted on server exit)
- `relay.log` — Server stdout/stderr (for debugging)

**This directory should be gitignored.** The socket and PID file are machine-local runtime state. Add `.ai-relay/` to `.gitignore` if not already present.
