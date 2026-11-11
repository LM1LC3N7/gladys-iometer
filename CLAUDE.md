# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for the IOmeter smart meter reader
(read only, local HTTP API of its bridge, no cloud): a Node.js service (Node
22+, ESM, no build step) in its own sandboxed Docker container, talking to
Gladys through `@gladysassistant/integration-sdk`, its only runtime dependency.
Built after `gladys-p1-monitor` (same guard, clocks, retries).

## Commands

```bash
npm install
npm test                       # node --test --test-timeout=60000
npm run lint && npm run format:check
node scripts/cover.mjs cover.png
```

## Architecture

```
index.js                 SDK wiring only, handlers registered before connect()
src/app.js               reads, retries, publication, guard, test and accept buttons, mDNS
src/iometer/client.js    HTTP GETs, bounded body (64 KiB), timeouts, our own error codes
src/iometer/model.js     OBIS registers and status, read into plain values (pure)
src/devices.js           the Gladys device and its states (pure)
src/guard.js             plausibility of the billed index (from gladys-p1-monitor, unchanged)
src/counters.js          plain counters: never lower, spikes held (CounterFloor)
src/store.js             /data (missing = empty, unreadable = never written over)
src/config.js, src/i18n.js, src/constants.js
```

## Rules

- **External ids are forever**: `iometer:meter`, one device per integration;
  feature keys in `src/devices.js`, action keys in `src/constants.js`.
- **The meter number, the installation id and the bridge id** identify a
  household: never read into the code, so never in a log, status, /data.
- `consumption_index` (1.8.0) is the only `energy-sensor/index`; `power` (taken
  from the grid, never below 0) the only `energy-sensor/power`. Everything else
  is a plain sensor. Never `publishEnergyConsumption`.
- A value is a finite JSON number with a known unit, otherwise unknown; never
  published as 0. Plain counters never go down (floors, reset by an accepted
  drop of the index), a spike held, never a floor.
- Clocks: monotonic for pacing, the session clock for the guard, the wall clock
  only for /data. Tests use clocks that move at every read, plus a real-clock
  test.
- Versions belong to the Release workflow; `CHANGELOG.md` under
  `## [Unreleased]`; texts in English and French; docs in `docs/`.
