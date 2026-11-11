// -----------------------------------------------------------------------------
// The app on a REAL moving clock (performance.now, Date.now, real timers) and
// a real local HTTP server playing the bridge: the reads really happen every
// POWER_INTERVAL, never sooner, and nothing runs after stop(). The time is
// sped up 100 times (10 s are 100 ms) but it is the real clock: it moves
// between any two reads of it.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { IOmeterApp } from '../src/app.js';
import { POWER_INTERVAL } from '../src/constants.js';
import { createMemoryStore } from '../src/store.js';
import { STATUS, reading } from './fixtures/iometer.js';

const SPEED = 100;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('real clock: one read per interval, never sooner; nothing after stop()', async (t) => {
  const reads = [];
  let second = 0;
  const server = createServer((req, res) => {
    if (req.url === '/v1/reading') reads.push(performance.now() * SPEED);
    res.writeHead(200, { 'content-type': 'application/json' });
    const time = new Date(Date.parse('2026-11-11T10:00:00Z') + (second += 1) * 1000);
    res.end(
      JSON.stringify(req.url === '/v1/reading' ? reading(undefined, time.toISOString()) : STATUS),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const { port } = server.address();
  const live = new Set();
  const timers = {
    setTimeout(fn, ms) {
      const id = setTimeout(
        () => {
          live.delete(id);
          fn();
        },
        Math.max(0, ms) / SPEED,
      );
      live.add(id);
      return id;
    },
    clearTimeout(id) {
      live.delete(id);
      clearTimeout(id);
    },
    setInterval(fn, ms) {
      const id = setInterval(fn, Math.max(1, ms) / SPEED);
      live.add(id);
      return id;
    },
    clearInterval(id) {
      live.delete(id);
      clearInterval(id);
    },
  };
  const gladys = createFakeGladys({ selector: 'iometer', config: {} });
  await gladys.connect();
  const quiet = () => {};
  const app = new IOmeterApp({
    gladys,
    logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
    now: () => Date.now() * SPEED,
    monotonic: () => performance.now() * SPEED,
    timers,
    store: createMemoryStore(),
  });
  t.after(() => app.stop());
  // The decision is timed, not the requests (their latency blurs the period).
  const ticks = [];
  const doTick = app.doTick.bind(app);
  app.doTick = () => {
    ticks.push(performance.now() * SPEED);
    return doTick();
  };
  const started = performance.now() * SPEED;
  await app.start({ address: `127.0.0.1:${port}` });
  const deadline = performance.now() + 5_000;
  while (reads.length < 5 && performance.now() < deadline) await sleep(5);
  await app.stop();
  const count = reads.length;
  await sleep((3 * POWER_INTERVAL) / SPEED);
  const at = ticks.map((r) => Math.round(r - started));
  assert.ok(count >= 5, `reads at ${at}`);
  assert.equal(ticks.length, count, 'one request per tick');
  assert.equal(reads.length, count, 'no read after stop()');
  assert.equal(live.size, 0, 'no timer left after stop()');
  assert.ok(ticks[0] - started < POWER_INTERVAL / 2, `the first read at once: ${at}`);
  for (let i = 1; i < count; i += 1) {
    const gap = ticks[i] - ticks[i - 1];
    assert.ok(gap >= 0.9 * POWER_INTERVAL, `never sooner than the interval: ${at}`);
    assert.ok(gap < 3 * POWER_INTERVAL, `on time: ${at}`);
  }
});
