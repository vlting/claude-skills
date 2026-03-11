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
