#!/usr/bin/env node
// Blocks on relay waiting for queue events. Scans for pending tasks on connect
// (subscribe-first-then-scan pattern to eliminate race window).
//
// Usage: node relay-listen.js <socket> <queueDir> <timeoutMs> <event1> [event2...]
// Output: one of WORK_FOUND | IDLE_TIMEOUT | <event-name>

const fs = require('fs');
const net = require('net');

const sock = process.argv[2];
const queueDir = process.argv[3];
const timeout = +(process.argv[4] || 540000);
const events = new Set(process.argv.slice(5));

const s = net.connect(sock);
const timer = setTimeout(() => { console.log('IDLE_TIMEOUT'); s.destroy(); }, timeout);

s.once('connect', () => {
  s.write(JSON.stringify({ type: 'identify', pid: process.ppid || 0 }) + '\n');
  try {
    const pending = fs.readdirSync(queueDir).filter(f => /^\d{3}\.md$/.test(f));
    if (pending.length) {
      clearTimeout(timer);
      console.log('WORK_FOUND');
      s.destroy();
      return;
    }
  } catch {}
});

s.on('data', d => {
  for (const line of d.toString().split('\n').filter(Boolean)) {
    try {
      const msg = JSON.parse(line);
      if (msg.type === 'event' && events.has(msg.event)) {
        clearTimeout(timer);
        console.log(msg.event);
        s.destroy();
      }
    } catch {}
  }
});
