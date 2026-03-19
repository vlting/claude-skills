#!/usr/bin/env node
'use strict';

const net = require('net');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Fixed paths — one relay per machine
const SOCKET_PATH = path.join(process.env.HOME, '.claude', 'relay.sock');
const PID_PATH = path.join(process.env.HOME, '.claude', 'relay.pid');

// Ensure parent directory exists
fs.mkdirSync(path.dirname(SOCKET_PATH), { recursive: true });

// Remove stale socket file (caller verified PID before starting us)
if (fs.existsSync(SOCKET_PATH)) {
  fs.unlinkSync(SOCKET_PATH);
}

// ---------------------------------------------------------------------------
// Client tracking
// ---------------------------------------------------------------------------
const clients = new Map(); // socket → { pid, tasks: Set, connectedAt }

// Claim map: composite key "taskSlug:ctime" → workerPid
const claims = new Map();

function broadcast(msg, exclude) {
  const data = JSON.stringify(msg) + '\n';
  for (const [sock] of clients) {
    if (sock !== exclude && !sock.destroyed) {
      try { sock.write(data); } catch {}
    }
  }
}

function send(sock, msg) {
  if (!sock.destroyed) {
    try { sock.write(JSON.stringify(msg) + '\n'); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------
function handleMessage(socket, info, msg) {
  switch (msg.type) {
    case 'identify': {
      info.pid = msg.pid;
      send(socket, {
        type: 'state',
        workers: [...clients.values()].filter(c => c.pid).length,
      });
      break;
    }

    case 'claim': {
      // msg.key = "taskSlug:ctime" — composite key for uniqueness
      const key = msg.key;
      if (claims.has(key)) {
        send(socket, { type: 'claim-denied', key, holder: claims.get(key) });
      } else {
        claims.set(key, info.pid);
        info.tasks.add(key);
        send(socket, { type: 'claim-granted', key });
        broadcast({
          type: 'event',
          event: 'task-claimed',
          worker: info.pid,
          key,
        }, socket);
      }
      break;
    }

    case 'event': {
      // Clear claim on task completion
      if (msg.event === 'task-completed' && msg.key) {
        claims.delete(msg.key);
        info.tasks.delete(msg.key);
      }
      if (msg.event === 'task-claimed' && msg.key) {
        info.tasks.add(msg.key);
      }
      // Broadcast to all other clients
      broadcast(msg, socket);
      break;
    }

    case 'recover': {
      // Server-side PID liveness check for orphan recovery.
      // If no claim exists → recover-granted (task was never claimed or already released).
      // If claim exists → check if owner PID is alive:
      //   alive → recover-denied (task still owned)
      //   dead  → delete claim, recover-granted
      const key = msg.key;
      if (!claims.has(key)) {
        send(socket, { type: 'recover-granted', key });
      } else {
        const ownerPid = claims.get(key);
        let alive = false;
        try { process.kill(ownerPid, 0); alive = true; } catch {}
        if (alive) {
          send(socket, { type: 'recover-denied', key, holder: ownerPid });
        } else {
          claims.delete(key);
          // Remove from any client's task set
          for (const [, c] of clients) { c.tasks.delete(key); }
          send(socket, { type: 'recover-granted', key });
          broadcast({
            type: 'event',
            event: 'task-recovered',
            recoveredBy: info.pid,
            key,
          }, socket);
        }
      }
      break;
    }

    case 'release': {
      // Explicit claim release — worker finished or is cleaning up.
      const key = msg.key;
      if (claims.get(key) === info.pid) {
        claims.delete(key);
        info.tasks.delete(key);
        send(socket, { type: 'release-ack', key });
      } else {
        // Not the owner — no-op but acknowledge
        send(socket, { type: 'release-ack', key, note: 'not-owner' });
      }
      break;
    }

    case 'status': {
      send(socket, {
        type: 'status-response',
        clients: [...clients.values()].map(c => ({
          pid: c.pid,
          tasks: [...c.tasks],
          connectedAt: c.connectedAt,
        })),
        claims: Object.fromEntries(claims),
        uptime: process.uptime(),
      });
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = net.createServer(socket => {
  const info = {
    pid: null,
    tasks: new Set(),
    connectedAt: new Date().toISOString(),
  };
  clients.set(socket, info);

  let buffer = '';

  socket.on('data', chunk => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        handleMessage(socket, info, JSON.parse(line));
      } catch {
        // ignore malformed messages
      }
    }
  });

  socket.on('close', () => {
    const disconnected = clients.get(socket);
    clients.delete(socket);

    if (disconnected && disconnected.pid) {
      // Broadcast for awareness only — do NOT delete claims here.
      // The PID (Agent subprocess) may still be alive even after the
      // short-lived socket disconnects. Claims are released explicitly
      // via 'release' or reclaimed via 'recover' with PID liveness check.
      broadcast({
        type: 'event',
        event: 'worker-disconnected',
        pid: disconnected.pid,
        tasks: [...disconnected.tasks],
      });
    }
  });

  socket.on('error', () => {
    clients.delete(socket);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
fs.writeFileSync(PID_PATH, process.pid.toString());

function cleanup() {
  try { fs.unlinkSync(SOCKET_PATH); } catch {}
  try { fs.unlinkSync(PID_PATH); } catch {}
}

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });

// ---------------------------------------------------------------------------
// Self-termination via pgrep
// Poll every ~20s for Claude processes. Exit after two consecutive empty
// checks (~40s worst case). Handles terminal crashes gracefully.
// ---------------------------------------------------------------------------
let emptyChecks = 0;

setInterval(() => {
  try {
    const output = execSync('pgrep -f claude', { encoding: 'utf8' }).trim();
    // Filter out our own PID — relay path contains "claude"
    const pids = output.split('\n').filter(p => +p !== process.pid);
    if (pids.length > 0) {
      emptyChecks = 0;
    } else {
      emptyChecks++;
    }
  } catch {
    // pgrep returns non-zero if no matches
    emptyChecks++;
  }

  if (emptyChecks >= 2) {
    console.log('relay: no Claude processes detected for ~40s, self-terminating');
    cleanup();
    process.exit(0);
  }
}, 20000);

server.listen(SOCKET_PATH, () => {
  console.log(`relay: listening on ${SOCKET_PATH} (pid ${process.pid})`);
});
