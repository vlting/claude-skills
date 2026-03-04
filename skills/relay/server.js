#!/usr/bin/env node
'use strict';

const net = require('net');
const fs = require('fs');
const path = require('path');

// Configuration — relay dir passed as first arg, defaults to .ai-relay in cwd
const RELAY_DIR = process.argv[2] || path.join(process.cwd(), '.ai-relay');
const SOCKET_PATH = path.join(RELAY_DIR, 'relay.sock');
const PID_PATH = path.join(RELAY_DIR, 'relay.pid');

// Ensure relay directory exists
fs.mkdirSync(RELAY_DIR, { recursive: true });

// Remove stale socket file (server is not running — caller verified PID before starting us)
if (fs.existsSync(SOCKET_PATH)) {
  fs.unlinkSync(SOCKET_PATH);
}

// ---------------------------------------------------------------------------
// Client tracking
// ---------------------------------------------------------------------------
const clients = new Map(); // socket → { role, pid, tasks: Set, connectedAt }
const knownAgents = new Map(); // pid → { role, lastSeen } — survives disconnects

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
      // Enforce single orchestrator
      if (msg.role === 'orchestrator') {
        for (const [, existing] of clients) {
          if (existing.role === 'orchestrator' && existing !== info) {
            send(socket, { type: 'role-taken', active_pid: existing.pid });
            return;
          }
        }
      }
      info.role = msg.role;
      info.pid = msg.pid;
      // Track this agent across transient connections
      if (msg.pid) {
        knownAgents.set(msg.pid, { role: msg.role, lastSeen: new Date().toISOString() });
      }
      // Send current state to the newly identified client
      send(socket, {
        type: 'state',
        orchestrator: [...clients.values()].some(c => c.role === 'orchestrator'),
        workers: [...clients.values()].filter(c => c.role === 'worker').length,
      });
      break;
    }

    case 'event': {
      // Track task ownership on the server side
      if (msg.event === 'task-claimed' && msg.task) {
        info.tasks.add(msg.task);
      } else if (msg.event === 'task-completed' && msg.task) {
        info.tasks.delete(msg.task);
      }
      // Broadcast to all other clients
      broadcast(msg, socket);
      break;
    }

    case 'status': {
      send(socket, {
        type: 'status-response',
        clients: [...clients.values()].map(c => ({
          role: c.role,
          pid: c.pid,
          tasks: [...c.tasks],
          connectedAt: c.connectedAt,
        })),
        liveAgents: liveAgentCount(),
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
    role: 'unknown',
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

    if (disconnected && disconnected.role !== 'unknown') {
      broadcast({
        type: 'event',
        event: `${disconnected.role}-disconnected`,
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

// Check if any known agent PIDs are still alive (works across transient connections)
function liveAgentCount() {
  let alive = 0;
  for (const [pid] of knownAgents) {
    try { process.kill(pid, 0); alive++; } catch { knownAgents.delete(pid); }
  }
  return alive;
}

// SIGTERM: refuse to die if agents are still alive — checks BOTH connected sockets
// AND known agent PIDs (which persist across transient connections).
// A second SIGTERM (or SIGINT) forces shutdown regardless.
let forceNextSignal = false;
process.on('SIGTERM', () => {
  const connectedIdentified = [...clients.values()].filter(c => c.role !== 'unknown');
  const liveAgents = liveAgentCount();
  const blocking = Math.max(connectedIdentified.length, liveAgents);
  if (blocking > 0 && !forceNextSignal) {
    console.log(`relay: SIGTERM ignored — ${connectedIdentified.length} connected client(s), ${liveAgents} known live agent(s). Send again to force.`);
    forceNextSignal = true;
    // Reset force flag after 10 seconds so stale double-kills don't accumulate
    setTimeout(() => { forceNextSignal = false; }, 10000);
    return;
  }
  cleanup();
  process.exit(0);
});

process.on('SIGINT', () => { cleanup(); process.exit(0); });

server.listen(SOCKET_PATH, () => {
  console.log(`relay: listening on ${SOCKET_PATH} (pid ${process.pid})`);
});
