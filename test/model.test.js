// -----------------------------------------------------------------------------
// The pure parts: the answers of the bridge, the capabilities, the device and
// its states, the address, the /data store.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig, parseAddress } from '../src/config.js';
import {
  FEATURE,
  buildDevice,
  capabilitiesOfDevice,
  ids,
  indexStates,
  liveStates,
} from '../src/devices.js';
import { createFileStore, StoreUnreadable } from '../src/store.js';
import { CounterFloor } from '../src/counters.js';
import { COUNTER_JUMP_CONFIRM, HTTP_TIMEOUT } from '../src/constants.js';
import { IOmeterClient } from '../src/iometer/client.js';
import {
  NO_CAPABILITIES,
  bringsNew,
  capabilitiesOf,
  mergeCapabilities,
  parseReading,
  parseStatus,
} from '../src/iometer/model.js';
import { STATUS, reading, readingWith } from './fixtures/iometer.js';

const gladys = createFakeGladys({ selector: 'iometer' });
const external = ids(gladys);
const key = (f) => f.external_id.split(':').at(-1);

test('the reading: Wh to kWh, W, the OBIS codes in any case, the first register wins', () => {
  const r = parseReading(reading());
  assert.equal(r.consumption, 12345.6789);
  assert.equal(r.consumptionT1, 8000);
  assert.equal(r.production, 2000.5);
  assert.equal(r.power, 1234);
  assert.deepEqual(r.phases, [400, 500, 334]);
  assert.equal(r.time, '2026-11-11T10:00:00Z');
  const twice = reading([
    { obis: '01-00:01.08.00*FF', value: 1000, unit: 'Wh' },
    { obis: '01-00:01.08.00*ff', value: 9e9, unit: 'Wh' },
  ]);
  assert.equal(parseReading(twice).consumption, 1);
});

test('without 16.7.0, 36.7.0 is the total power (library note), never a phase', () => {
  const r = parseReading(readingWith({ '01-00:10.07.00*ff': null }));
  assert.equal(r.power, 400);
  assert.deepEqual(r.phases, []);
  // 16.7.0 there but unreadable: the power is unknown, no fallback.
  const bad = parseReading(readingWith({ '01-00:10.07.00*ff': 'x' }));
  assert.equal(bad.power, undefined);
});

test('values: numbers only; a text, null, NaN, below 0, an odd unit: unknown', () => {
  for (const value of ['1000', null, '', true, -5]) {
    const r = parseReading(reading([{ obis: '01-00:01.08.00*ff', value, unit: 'Wh' }]));
    assert.equal(r.consumption, undefined, String(value));
  }
  for (const unit of ['varh', 'MWh', 12]) {
    const r = parseReading(reading([{ obis: '01-00:01.08.00*ff', value: 5, unit }]));
    assert.equal(r.consumption, undefined, String(unit));
  }
  const r = parseReading(reading([{ obis: '01-00:10.07.00*ff', value: 100_001, unit: 'W' }]));
  assert.equal(r.power, undefined, 'a power above 100 kW is a glitch');
  assert.equal(
    parseReading(reading([{ obis: '01-00:10.07.00*ff', value: -3.2, unit: 'kW' }])).power,
    -3200,
  );
  assert.equal(parseReading(reading([{ obis: '01-00:01.08.00*ff', value: 2 }])).consumption, 0.002);
});

test('not a reading: undefined; registers bounded; empty flagged', () => {
  for (const data of [null, [], {}, { meter: {} }, { meter: { reading: { registers: {} } } }]) {
    assert.equal(parseReading(data), undefined, JSON.stringify(data));
  }
  assert.equal(parseReading(reading([])).empty, true);
  const many = Array.from({ length: 5000 }, (_, i) => ({ obis: `x${i}`, value: i, unit: 'W' }));
  many.push({ obis: '01-00:01.08.00*ff', value: 1000, unit: 'Wh' });
  assert.equal(parseReading(reading(many)).consumption, undefined, 'past 64 registers, ignored');
  const polluted = JSON.parse(
    '{"meter":{"reading":{"registers":[{"obis":"__proto__","value":1}]}}}',
  );
  parseReading(polluted);
  assert.equal({}.value, undefined);
});

test('the status: dBm, battery on battery power only, flags 1/0 or unknown', () => {
  assert.deepEqual(parseStatus(STATUS), {
    bridgeRssi: -55,
    coreRssi: -72,
    coreConnected: 1,
    coreAttached: 1,
    battery: 83,
  });
  const odd = parseStatus({
    device: {
      core: {
        connectionStatus: 'disconnected',
        attachmentStatus: 'detached',
        batteryLevel: 101,
        rssi: -72.5,
      },
    },
  });
  assert.deepEqual(odd, {
    bridgeRssi: undefined,
    coreRssi: undefined,
    coreConnected: 0,
    coreAttached: 0,
    battery: undefined,
  });
  assert.equal(parseStatus({ device: {} }), undefined);
  assert.equal(parseStatus([]), undefined);
});

test('capabilities: from what is known; merged, never fewer; only new ones count', () => {
  const caps = capabilitiesOf({ reading: parseReading(reading()), status: parseStatus(STATUS) });
  assert.equal(caps.phases, 3);
  assert.ok(caps.consumption && caps.tariffs && caps.production && caps.battery);
  const small = capabilitiesOf({
    reading: parseReading(readingWith({ '01-00:02.08.00*ff': null })),
  });
  assert.equal(small.production, false);
  assert.equal(small.battery, false);
  assert.ok(bringsNew(small, caps));
  assert.ok(!bringsNew(caps, small));
  assert.deepEqual(mergeCapabilities(caps, small), caps);
  assert.deepEqual(mergeCapabilities(undefined, undefined), undefined);
});

test('the device: units of the core, one index, a created device gives back its capabilities', () => {
  const caps = capabilitiesOf({ reading: parseReading(reading()), status: parseStatus(STATUS) });
  const device = buildDevice(gladys, caps, '192.168.1.40');
  assert.equal(device.external_id, external.device);
  const byKey = Object.fromEntries(device.features.map((f) => [key(f), f]));
  assert.equal(byKey.power.unit, 'watt');
  assert.equal(byKey.power.min, 0);
  assert.equal(byKey.net_power.min, -100_000);
  assert.equal(byKey.battery.unit, 'percent');
  assert.equal(byKey.battery.category, 'battery');
  for (const f of device.features.filter((f) => f.category === 'unknown')) {
    assert.equal(f.unit, undefined, key(f));
  }
  assert.deepEqual(capabilitiesOfDevice(device), caps);
  assert.equal(capabilitiesOfDevice({ features: [] }), undefined);
  const bare = buildDevice(gladys, { ...NO_CAPABILITIES, consumption: true }, 'a');
  assert.deepEqual(bare.features.map(key), [FEATURE.CONSUMPTION_INDEX]);
});

test('states: rounded, power taken never below 0, counters never 0 nor under the floor', () => {
  const r = parseReading(readingWith({ '01-00:10.07.00*ff': -50.4 }));
  const live = Object.fromEntries(
    liveStates(external, r).map((s) => [s.device_feature_external_id.split(':').at(-1), s.state]),
  );
  assert.equal(live.power, 0);
  assert.equal(live.net_power, -50);
  const asked = [];
  const allow = (k, v) => (asked.push([k, v]), k !== FEATURE.PRODUCTION_INDEX);
  const states = indexStates(external, { ...r, consumptionT2: 0 }, 12345.679, allow);
  assert.deepEqual(asked, [
    [FEATURE.CONSUMPTION_T1, 8000],
    [FEATURE.PRODUCTION_INDEX, 2000.5],
  ]);
  const keys = states.map((s) => s.device_feature_external_id.split(':').at(-1));
  assert.deepEqual(keys, ['consumption_index', 'consumption_t1']);
  assert.deepEqual(
    indexStates(external, r, 0)
      .map((s) => s.state)
      .includes(0),
    false,
  );
});

test('the address: IP, host name, port, pasted URL; never credentials', () => {
  assert.deepEqual(parseAddress(' 192.168.1.40 '), { address: '192.168.1.40' });
  assert.deepEqual(parseAddress('http://iometer.local:8080/v1/reading'), {
    address: 'iometer.local:8080',
  });
  assert.deepEqual(parseAddress('192.168.1.40:80'), { address: '192.168.1.40' });
  for (const bad of [
    'admin:pw@1.2.3.4',
    'a b',
    'x:99999',
    'bad\r\nhost',
    'a..b',
    '0.0.0.0',
    '255.255.255.255',
    '224.0.0.1',
    '239.1.2.3',
    '240.0.0.1',
    '0.1.2.3',
    '999.1.1.1',
    '10.999.1.1',
    '10.1.1.256',
    '0x0',
    '224.1',
    '0x7f.1',
    '0xe0.0.0.1',
    '127.1',
    'bridge.42',
    '1.2.3',
    '1.2.3.4.5',
    '::',
    '[::]:80',
    'ff02::1',
    '[ff02::1]',
  ]) {
    assert.ok(parseAddress(bad).error, bad);
  }
  assert.deepEqual(normalizeConfig({ address: 'x:0' }), { address: '', invalidAddress: true });
  for (const good of [
    '10.0.0.1',
    '223.255.255.254',
    'fe80::1',
    '[2001:db8::1]:8080',
    'my-bridge',
  ]) {
    assert.ok(!parseAddress(good).error, good);
  }
});

test('the /data store: written through a temporary file; missing = empty; unreadable throws', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'iometer-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createFileStore(join(dir, 'state.json'));
  assert.deepEqual(store.load(), {});
  await store.save({ a: 1 });
  assert.deepEqual(store.load(), { a: 1 });
  await writeFile(join(dir, 'state.json'), '{broken');
  assert.throws(() => store.load(), StoreUnreadable);
  await writeFile(join(dir, 'state.json'), '[1]');
  assert.throws(() => store.load(), StoreUnreadable);
  await mkdir(join(dir, 'dir.json'));
  assert.throws(() => createFileStore(join(dir, 'dir.json')).load(), StoreUnreadable);
});

const HOUR = 3_600_000;

test('plain counter: a spike is held and never raises the floor; back, it goes on', () => {
  const c = new CounterFloor({ value: 1000, at: 0 });
  assert.equal(c.accept(1000.5, HOUR / 60), true);
  assert.equal(c.accept(500000, 2 * (HOUR / 60)), false);
  assert.equal(c.state, 'jump');
  assert.equal(c.floor.value, 1000.5);
  assert.equal(c.accept(1000.6, 3 * (HOUR / 60)), true);
  assert.equal(c.state, 'ok');
  assert.equal(c.accept(999, 4 * (HOUR / 60)), false);
  assert.equal(c.state, 'down');
  assert.equal(c.accept(0, 5 * (HOUR / 60)), false);
  assert.equal(c.accept(1000.6, 6 * (HOUR / 60)), true, 'equal: published');
  assert.equal(c.floor.at, 3 * (HOUR / 60), 'equal: date not moved');
});

test('plain counter: a real jump kept an hour, each value plausible, is taken; not sooner', () => {
  const c = new CounterFloor({ value: 1000, at: 0 });
  const t0 = HOUR / 60;
  for (let i = 0; i * 60_000 < COUNTER_JUMP_CONFIRM; i += 1) {
    assert.equal(c.accept(5000 + i * 0.01, t0 + i * 60_000), false, `minute ${i}`);
  }
  assert.equal(c.accept(5001, t0 + COUNTER_JUMP_CONFIRM), true);
  // A held jump broken by another implausible one starts again.
  const d = new CounterFloor({ value: 1000, at: 0 });
  d.accept(5000, t0);
  d.accept(90000, t0 + 30 * 60_000);
  assert.equal(d.accept(90000.1, t0 + COUNTER_JUMP_CONFIRM + 1), false);
  assert.equal(d.accept(4000, t0 + COUNTER_JUMP_CONFIRM + 2), false, 'lower than the pending');
  // A lower value while a jump is pending starts the hour again.
  const f = new CounterFloor({ value: 1000, at: 0 });
  f.accept(5000, t0);
  assert.equal(f.accept(4000, t0 + 59 * 60_000), false);
  assert.equal(f.accept(4000.01, t0 + COUNTER_JUMP_CONFIRM), false);
  // No reference: the first value only once a second one agrees (a spike
  // as the first reading never becomes the floor); a reset starts again.
  const e = new CounterFloor(undefined);
  assert.equal(e.accept(500000, 0), false);
  assert.equal(e.accept(1000, 60_000), false, 'lower: a new candidate');
  assert.equal(e.accept(1000.1, 120_000), true);
  assert.equal(e.floor.value, 1000.1);
  e.reset();
  assert.equal(e.accept(3, 1), false);
  assert.equal(e.accept(3, 2), true);
  const g = new CounterFloor(undefined);
  g.accept(1000, 0);
  assert.equal(g.accept(500000, 60_000), false, 'beyond the margin: not taken');
  assert.equal(new CounterFloor({ value: 0, at: 0 }).floor, undefined);
});

test('bounds kept by default: request time, counters above 1e9 kWh, long time and OBIS', () => {
  assert.equal(new IOmeterClient({ address: 'x' }).timeout, HTTP_TIMEOUT);
  assert.ok(HTTP_TIMEOUT >= 1000 && HTTP_TIMEOUT <= 15_000);
  const big = parseReading(
    reading([{ obis: '01-00:01.08.00*ff', value: 2e12 + 1000, unit: 'Wh' }]),
  );
  assert.equal(big.consumption, undefined);
  assert.equal(parseReading(reading([], 'x'.repeat(41))).time, undefined);
  assert.equal(parseReading(reading([], 'x'.repeat(40))).time, 'x'.repeat(40));
  const long = '01-00:01.08.00*ff' + ' '.repeat(30);
  assert.equal(parseReading(reading([{ obis: long, value: 5, unit: 'Wh' }])).empty, true);
});

test('the /data store: a file above 256 KiB is not ours', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'iometer-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 's.json'), JSON.stringify({ a: 'x'.repeat(300 * 1024) }));
  assert.throws(() => createFileStore(join(dir, 's.json')).load(), StoreUnreadable);
  await writeFile(join(dir, 's.json'), JSON.stringify({ a: 'x'.repeat(200 * 1024) }));
  assert.equal(createFileStore(join(dir, 's.json')).load().a.length, 200 * 1024);
});
