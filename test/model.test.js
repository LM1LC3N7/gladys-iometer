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
  const floors = new Map([[FEATURE.PRODUCTION_INDEX, 3000]]);
  const states = indexStates(external, { ...r, consumptionT2: 0 }, 12345.679, floors);
  const keys = states.map((s) => s.device_feature_external_id.split(':').at(-1));
  assert.deepEqual(keys, ['consumption_index', 'consumption_t1']);
  assert.deepEqual(
    indexStates(external, r, 0, new Map())
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
  for (const bad of ['admin:pw@1.2.3.4', 'a b', 'x:99999', 'bad\r\nhost', 'a..b']) {
    assert.ok(parseAddress(bad).error, bad);
  }
  assert.deepEqual(normalizeConfig({ address: 'x:0' }), { address: '', invalidAddress: true });
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
