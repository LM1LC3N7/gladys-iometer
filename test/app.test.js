// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and a fake IOmeter bridge.
// The clocks move by themselves at every read (1 µs): a decision that reads
// them twice sees them move.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { IOmeterApp } from '../src/app.js';
import {
  ACTIONS,
  NO_STATUS_RETRY,
  POWER_INTERVAL,
  READING_STALE_AFTER,
  RETRY_MIN,
  SECONDARY_RETRY,
} from '../src/constants.js';
import { buildDevice } from '../src/devices.js';
import { createMemoryStore } from '../src/store.js';
import { IOmeterClient } from '../src/iometer/client.js';
import { NO_CAPABILITIES } from '../src/iometer/model.js';
import { createFetch, refusedError } from './helpers/fakeFetch.js';
import { createFakeTimers } from './helpers/fakeTimers.js';
import {
  ADDRESS,
  INSTALLATION_ID,
  METER_NUMBER,
  NOW,
  STATUS,
  json,
  readingWith,
  routes as bridgeRoutes,
} from './fixtures/iometer.js';

const SELECTOR = 'iometer';
const DEVICE = `ext:${SELECTOR}:iometer:meter`;
const F = (key) => `${DEVICE}:${key}`;
const CONFIG = { address: ADDRESS };
const MINUTE = 60_000;
const READING = '/v1/reading';
const STATUS_PATH = '/v1/status';
const INDEX = 12345.679;
const OBIS = {
  index: '01-00:01.08.00*ff',
  t1: '01-00:01.08.01*ff',
  injection: '01-00:02.08.00*ff',
  power: '01-00:10.07.00*ff',
};

function createLogger() {
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  return { lines, info: log, warn: log, error: log, debug: log };
}

const ALL = {
  ...NO_CAPABILITIES,
  power: true,
  consumption: true,
  tariffs: true,
  production: true,
  phases: 3,
  battery: true,
  bridgeRssi: true,
  coreRssi: true,
  coreConnected: true,
  coreAttached: true,
};

/** The device as the user created it from the discovered one; `last`: { key: [value, iso] }. */
function created(caps = ALL, last = {}) {
  const gladys = createFakeGladys({ selector: SELECTOR });
  const device = buildDevice(gladys, caps, ADDRESS);
  for (const f of device.features) {
    const key = f.external_id.split(':').at(-1);
    if (last[key]) {
      f.last_value = last[key][0];
      f.last_value_changed = last[key][1];
    }
  }
  return device;
}

async function setup({
  config = CONFIG,
  routes = bridgeRoutes(),
  devices = [],
  store = createMemoryStore(),
  now = NOW,
  scanResults,
} = {}) {
  const fake = createFetch(routes);
  const gladys = createFakeGladys({ selector: SELECTOR, config, devices, scanResults });
  await gladys.connect();
  const timers = createFakeTimers();
  /** `now` the wall clock, `mono` the monotonic one; each read moves them by 1 µs. */
  const clock = { now, mono: 1000 };
  const logger = createLogger();
  const app = new IOmeterApp({
    gladys,
    logger,
    now: () => (clock.now += 0.001),
    monotonic: () => (clock.mono += 0.001),
    timers,
    store,
    clientFactory: (options) => new IOmeterClient({ ...options, fetchImpl: fake.fetch }),
  });
  gladys.onDeviceCreated((device) => app.onDeviceCreated(device));
  gladys.onDeviceUpdated((device) => app.onDeviceUpdated(device));
  gladys.onScanRequest(() => app.scan());
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());
  gladys.onAction(ACTIONS.ACCEPT_HELD, () => app.acceptHeldIndex());
  const tick = async (ms = POWER_INTERVAL) => {
    clock.now += ms;
    clock.mono += ms;
    await timers.runIntervals();
  };
  const accept = async () => {
    await gladys.fake.action(ACTIONS.ACCEPT_HELD);
    clock.now += 5_000;
    clock.mono += 5_000;
    return gladys.fake.action(ACTIONS.ACCEPT_HELD);
  };
  return { app, gladys, timers, clock, logger, fake, tick, accept, store };
}

const status = (gladys) => gladys.fake.connectionStatus;
const published = (gladys, key) =>
  gladys.fake.states.filter((s) => s.device_feature_external_id === F(key)).map((s) => s.state);
const indexes = (gladys) => published(gladys, 'consumption_index');
const distinct = (values) => [...new Set(values)];

/** A bridge whose reading changes at each call (a live meter), with these registers. */
function live(routes, values = {}) {
  let second = 0;
  routes[READING] = () =>
    json(readingWith(values, new Date(NOW + (second += 10) * 1000).toISOString()));
}

test('no address, a wrong one: the status says so, nothing is called', async () => {
  for (const [config, pattern] of [
    [{}, /Saisissez l’adresse/],
    [{ address: 'http://admin:pw@1.2.3.4' }, /pas valide/],
  ]) {
    const { app, gladys, timers, fake } = await setup({ config });
    await app.start(config);
    await app.idle();
    assert.equal(status(gladys).connected, false);
    assert.match(status(gladys).message.fr, pattern);
    assert.equal(fake.calls.length, 0);
    assert.equal(timers.pending.size, 0);
    assert.match(String((await gladys.fake.action(ACTIONS.TEST)).data.message.fr), pattern);
    assert.ok(!JSON.stringify(gladys.fake.connectionStatuses).includes('pw'));
  }
});

test('discovered with what the bridge gives; no value before the device is created', async () => {
  const { app, gladys, fake } = await setup();
  await app.start(CONFIG);
  await app.idle();
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, DEVICE);
  assert.equal(device.name, 'IOmeter');
  const keys = device.features.map((f) => f.external_id.split(':').at(-1));
  assert.deepEqual(keys, [
    'power',
    'net_power',
    'consumption_index',
    'consumption_t1',
    'consumption_t2',
    'production_index',
    'power_l1',
    'power_l2',
    'power_l3',
    'battery',
    'bridge_rssi',
    'core_rssi',
    'core_connected',
    'core_attached',
  ]);
  const index = device.features.find((f) => f.external_id === F('consumption_index'));
  assert.deepEqual(
    [index.category, index.type, index.unit],
    ['energy-sensor', 'index', 'kilowatt-hour'],
  );
  // Only one energy index and one energy power: nothing else is billed or summed.
  assert.deepEqual(
    device.features.filter((f) => f.category === 'energy-sensor').map((f) => f.type),
    ['power', 'index'],
  );
  for (const f of device.features) {
    assert.equal(f.read_only, true);
    assert.ok(!('supported_options' in f), f.external_id);
  }
  assert.equal(gladys.fake.states.length, 0);
  assert.equal(status(gladys).connected, true);
  assert.match(status(gladys).message.fr, /Découverte/);
  assert.deepEqual(fake.calls[0].headers, { Accept: 'application/json' });
  assert.equal(fake.calls[0].init.redirect, 'manual');
});

test('created device: every value, in kWh and W; the net power split; status once', async () => {
  const routes = bridgeRoutes();
  const { app, gladys, tick, fake } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  const last = (key) => gladys.fake.lastState(F(key));
  assert.equal(last('power'), 1234);
  assert.equal(last('net_power'), 1234);
  assert.equal(last('consumption_index'), INDEX);
  assert.equal(last('consumption_t1'), 8000);
  assert.equal(last('consumption_t2'), 4345.679);
  assert.equal(last('production_index'), 2000.5);
  assert.deepEqual([last('power_l1'), last('power_l2'), last('power_l3')], [400, 500, 334]);
  assert.equal(last('battery'), 83);
  assert.equal(last('bridge_rssi'), -55);
  assert.equal(last('core_rssi'), -72);
  assert.equal(last('core_connected'), 1);
  assert.equal(last('core_attached'), 1);
  assert.match(status(gladys).message.en, /Connected to the IOmeter bridge \(192\.168\.1\.40\)\./);

  // Injecting: power taken 0, the net power below 0.
  live(routes, { [OBIS.power]: -2500, '01-00:24.07.00*ff': -2500 });
  await tick();
  assert.equal(last('power'), 0);
  assert.equal(last('net_power'), -2500);
  assert.equal(last('power_l1'), -2500);
  // The status is read once a minute only, and published once per read.
  const statusReads = () => fake.calls.filter((c) => c.path === STATUS_PATH).length;
  assert.equal(statusReads(), 1);
  assert.equal(published(gladys, 'battery').length, 1);
  for (let i = 0; i < 6; i += 1) await tick();
  assert.equal(statusReads(), 2);
  assert.equal(gladys.fake.publishedEnergyConsumption.length, 0);
});

test('units: Wh or kWh, W or kW; any other unit, a text, null: unknown, never 0', async () => {
  const routes = bridgeRoutes();
  const { app, gladys, tick } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  routes[READING] = () =>
    json({
      meter: {
        number: METER_NUMBER,
        reading: {
          time: '2026-11-11T10:01:00Z',
          registers: [
            { obis: OBIS.index, value: 12345.7, unit: 'kWh' },
            { obis: OBIS.t1, value: '8000000', unit: 'Wh' },
            { obis: '01-00:01.08.02*ff', value: 5, unit: 'varh' },
            { obis: OBIS.injection, value: null, unit: 'Wh' },
            { obis: OBIS.power, value: 1.5, unit: 'kW' },
          ],
        },
      },
    });
  await tick(MINUTE);
  assert.equal(gladys.fake.lastState(F('consumption_index')), 12345.7);
  assert.equal(gladys.fake.lastState(F('power')), 1500);
  for (const key of ['consumption_t1', 'consumption_t2', 'production_index']) {
    assert.equal(published(gladys, key).length, 1, key);
    assert.ok(!published(gladys, key).includes(0), key);
  }
  // No index register: the index waits, never 0.
  live(routes, { [OBIS.index]: null });
  await tick(MINUTE);
  assert.ok(!indexes(gladys).includes(0));
  assert.match(status(gladys).message.fr, /ne donne pas d’index/);
});

test('a jump of the index is held until the user accepts it, then counted once', async () => {
  const routes = bridgeRoutes();
  const { app, gladys, tick, accept, store } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  live(routes, { [OBIS.index]: 22345678.9 });
  for (let i = 0; i < 30; i += 1) await tick(MINUTE);
  assert.deepEqual(distinct(indexes(gladys)), [INDEX]);
  assert.match(status(gladys).message.fr, /a sauté de 12345.679 à 22345.679 kWh/);
  assert.equal(store.data[F('consumption_index')].held.direction, 'up');
  const answer = await accept();
  assert.match(answer.data.message.en, /Accepted/);
  await app.idle();
  await tick(MINUTE);
  assert.equal(indexes(gladys).at(-1), 22345.679);
  assert.equal(store.data[F('consumption_index')].held, null);
});

test('a drop of a plain counter is never sent; a drop accepted (new meter) resets them', async () => {
  const routes = bridgeRoutes();
  const { app, gladys, tick, accept } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  live(routes, { [OBIS.injection]: 1000 });
  await tick(MINUTE);
  assert.deepEqual(published(gladys, 'production_index'), [2000.5]);
  assert.match(status(gladys).message.fr, /plus bas qu’avant/);
  // A new meter: everything lower. The index is held, the user accepts the drop.
  live(routes, { [OBIS.index]: 5000, [OBIS.injection]: 1000, [OBIS.t1]: 4000 });
  await tick(MINUTE);
  assert.match(status(gladys).message.fr, /a baissé de 12345.679 à 5 kWh/);
  await accept();
  await app.idle();
  await tick(MINUTE);
  assert.equal(indexes(gladys).at(-1), 5);
  assert.equal(gladys.fake.lastState(F('production_index')), 1);
  assert.equal(gladys.fake.lastState(F('consumption_t1')), 4);
  assert.doesNotMatch(status(gladys).message.fr, /plus bas/);
});

test('plain counters are floored by what Gladys holds, after a restart too', async () => {
  const routes = bridgeRoutes();
  const iso = new Date(NOW - MINUTE).toISOString();
  const device = created(ALL, {
    production_index: [3000, iso],
    consumption_index: [12345.6, iso],
  });
  const { app, gladys } = await setup({ routes, devices: [device] });
  await app.start(CONFIG);
  await app.idle();
  assert.deepEqual(published(gladys, 'production_index'), []);
  assert.equal(gladys.fake.lastState(F('consumption_index')), INDEX);
});

test('a frozen reading: the power is no longer sent, the status says so', async () => {
  const routes = bridgeRoutes();
  // The time of the meter never moves, whatever the power says.
  let watts = 100;
  routes[READING] = () => json(readingWith({ [OBIS.power]: (watts += 1) }));
  const { app, gladys, tick } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  for (let t = POWER_INTERVAL; t < READING_STALE_AFTER; t += POWER_INTERVAL) await tick();
  const count = published(gladys, 'power').length;
  assert.equal(count, READING_STALE_AFTER / POWER_INTERVAL);
  await tick();
  await tick();
  assert.equal(published(gladys, 'power').length, count);
  assert.match(status(gladys).message.fr, /ne donne plus de nouveau relevé/);
  live(routes, { [OBIS.power]: 777 });
  await tick();
  assert.equal(gladys.fake.lastState(F('power')), 777);
  assert.doesNotMatch(status(gladys).message.fr, /ne donne plus/);
});

test('the status page failing or absent never holds back the reading', async () => {
  const routes = bridgeRoutes();
  routes[STATUS_PATH] = () => json({ error: 'x' }, 500);
  const { app, gladys, tick, fake, logger } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(gladys.fake.lastState(F('power')), 1234);
  assert.match(status(gladys).message.fr, /Certaines pages ne répondent pas \(état/);
  assert.equal(logger.lines.filter((l) => /status page unavailable/.test(l)).length, 1);
  const reads = () => fake.calls.filter((c) => c.path === STATUS_PATH).length;
  await tick(SECONDARY_RETRY - POWER_INTERVAL);
  assert.equal(reads(), 1);
  routes[STATUS_PATH] = () => json({}, 404);
  await tick(POWER_INTERVAL);
  assert.equal(reads(), 2);
  assert.equal(status(gladys).connected, true);
  assert.doesNotMatch(status(gladys).message.fr, /Certaines pages/);
  await tick(NO_STATUS_RETRY - MINUTE);
  assert.equal(reads(), 2);
  await tick(MINUTE);
  assert.equal(reads(), 3);
});

test('a status page not from an IOmeter, a reader on mains: no battery, nothing invented', async () => {
  const routes = bridgeRoutes();
  routes[STATUS_PATH] = () =>
    json({
      ...STATUS,
      device: {
        ...STATUS.device,
        bridge: { rssi: 'strong' },
        core: { connectionStatus: 'weird', powerStatus: 'wired', batteryLevel: 50, rssi: 12 },
      },
    });
  const { app, gladys } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  for (const key of ['battery', 'bridge_rssi', 'core_rssi', 'core_connected', 'core_attached']) {
    assert.deepEqual(published(gladys, key), [], key);
  }
});

test('an unreachable bridge: growing delays, no request in between, the status says so', async () => {
  const routes = bridgeRoutes();
  routes[READING] = () => {
    throw refusedError();
  };
  const { app, gladys, tick, fake } = await setup({ routes });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(status(gladys).connected, false);
  assert.match(status(gladys).message.fr, /injoignable\) : nouvel essai dans 10 s/);
  const reads = () => fake.calls.filter((c) => c.path === READING).length;
  await tick(RETRY_MIN);
  assert.equal(reads(), 2);
  await tick(RETRY_MIN);
  assert.equal(reads(), 2, 'the second wait is 20 s');
  await tick(RETRY_MIN);
  assert.equal(reads(), 3);
  routes[READING] = bridgeRoutes()[READING];
  await tick(4 * RETRY_MIN);
  assert.equal(status(gladys).connected, true);
});

test('another service at the address, a body too large, a 404: never a device', async () => {
  for (const [answer, pattern] of [
    [() => json({ hello: 'world' }), /n’est pas celle d’un pont IOmeter/],
    [() => new Response('x'.repeat(70 * 1024)), /réponse trop grande/],
    [() => json({}, 404), /aucun relevé/],
    [() => json(readingWith(Object.fromEntries(['a'].map(() => [])))), null],
  ]) {
    if (!pattern) continue;
    const routes = bridgeRoutes();
    routes[READING] = answer;
    const { app, gladys } = await setup({ routes });
    await app.start(CONFIG);
    await app.idle();
    assert.equal(gladys.fake.discoveredDevices.length, 0);
    assert.match(status(gladys).message.fr, pattern);
  }
});

test('the meter number and the installation id reach no log, status, /data, state', async () => {
  const routes = bridgeRoutes();
  const { app, gladys, tick, logger, store } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  live(routes, { [OBIS.index]: 99999999999 });
  await tick(MINUTE);
  await gladys.fake.action(ACTIONS.TEST);
  const seen = JSON.stringify([
    logger.lines,
    gladys.fake.connectionStatuses,
    store.data,
    gladys.fake.discoveredDevices,
    gladys.fake.requests,
  ]);
  for (const secret of [METER_NUMBER, INSTALLATION_ID, 'bridge-secret-id']) {
    assert.ok(!seen.includes(secret), secret);
  }
});

test('getConfig() failing at a connection: tried again, spaced, then the start', async () => {
  const { app, gladys, timers } = await setup();
  const real = gladys.getConfig.bind(gladys);
  let failures = 2;
  gladys.getConfig = async () => {
    if (failures > 0) {
      failures -= 1;
      throw Object.assign(new Error('boom'), { status: 503 });
    }
    return real();
  };
  await app.connected();
  assert.equal(status(gladys).connected, false);
  assert.match(status(gladys).message.fr, /nouvel essai dans 10 s/);
  const retry = () => [...timers.pending.values()].find((t) => t.kind === 'timeout');
  const fire = async () => {
    const t = retry();
    timers.pending.delete(t.id);
    t.fn();
    await app.configRun;
  };
  assert.equal(retry().ms, RETRY_MIN);
  await fire();
  assert.match(status(gladys).message.fr, /nouvel essai dans 20 s/);
  assert.equal(retry().ms, 2 * RETRY_MIN);
  await fire();
  await app.idle();
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  assert.equal(status(gladys).connected, true);
});

test('a disconnection cancels the configuration retry', async () => {
  const { app, gladys, timers } = await setup();
  gladys.getConfig = async () => {
    throw new Error('down');
  };
  await app.connected();
  assert.equal([...timers.pending.values()].filter((t) => t.kind === 'timeout').length, 1);
  await app.stop();
  assert.equal(timers.pending.size, 0);
});

test('/data unreadable: the guard starts from Gladys, nothing written over it', async () => {
  const routes = bridgeRoutes();
  const store = createMemoryStore({ other: 1 });
  store.fail = true;
  const { app, gladys, tick, logger } = await setup({ routes, store, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(gladys.fake.lastState(F('consumption_index')), INDEX);
  assert.deepEqual(store.data, { other: 1 });
  assert.equal(logger.lines.filter((l) => /cannot be read/.test(l)).length, 1);
  live(routes, { [OBIS.index]: 99999999999 });
  await tick(MINUTE);
  assert.deepEqual(store.data, { other: 1 });
  store.fail = false;
  await tick(MINUTE);
  assert.equal(store.data.other, 1);
  assert.equal(store.data[F('consumption_index')].held.direction, 'up');
});

test('a held jump stays held across a restart', async () => {
  const routes = bridgeRoutes();
  const store = createMemoryStore();
  const first = await setup({ routes, store, devices: [created()] });
  await first.app.start(CONFIG);
  await first.app.idle();
  live(routes, { [OBIS.index]: 22345678.9 });
  await first.tick(MINUTE);
  await first.app.stop();
  const iso = new Date(NOW).toISOString();
  const second = await setup({
    routes,
    store,
    now: NOW + 2 * MINUTE,
    devices: [created(ALL, { consumption_index: [INDEX, iso] })],
  });
  await second.app.start(CONFIG);
  await second.app.idle();
  for (let i = 0; i < 10; i += 1) await second.tick(MINUTE);
  assert.deepEqual(distinct(indexes(second.gladys)), [INDEX]);
  assert.match(status(second.gladys).message.fr, /a sauté/);
});

test('a reconnection publishes again, but never a stale status as new', async () => {
  const routes = bridgeRoutes();
  const { app, gladys, tick } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(published(gladys, 'battery').length, 1);
  await tick();
  await app.start(CONFIG);
  await app.idle();
  assert.equal(published(gladys, 'battery').length, 1);
  assert.ok(published(gladys, 'power').length >= 2);
});

test('the test button reads the meter once', async () => {
  const { app, gladys, fake } = await setup();
  await app.start(CONFIG);
  await app.idle();
  const before = fake.calls.length;
  const answer = await gladys.fake.action(ACTIONS.TEST);
  assert.match(
    answer.data.message.fr,
    /puissance nette 1234 W, index de consommation 12345.679 kWh/,
  );
  assert.equal(fake.calls.length, before + 1);
});

test('the Discover tab without an address lists the bridges announced in mDNS', async () => {
  const scanResults = {
    mdns: [
      { name: 'IOmeter-1._iometer._tcp.local', addresses: ['192.168.1.77'], port: 80, txt: [] },
      { name: 'other._http._tcp.local', addresses: ['192.168.1.9'], port: 80, txt: [] },
      { name: 'evil._iometer._tcp.local', addresses: ['bad\r\nhost'], port: 80, txt: [] },
    ],
  };
  const { app, gladys, fake } = await setup({ config: {}, scanResults });
  await app.start({});
  await gladys.fake.scanRequest();
  assert.match(status(gladys).message.fr, /trouvé sur le réseau à l’adresse 192\.168\.1\.77 :/);
  assert.doesNotMatch(status(gladys).message.fr, /192\.168\.1\.9|bad/);
  assert.equal(fake.calls.length, 0, 'never read by itself');
  gladys.fake.scanResults = { mdns: [] };
  await gladys.fake.scanRequest();
  assert.match(status(gladys).message.fr, /Aucun pont IOmeter trouvé/);
});

test('the device created later: its values are read at once', async () => {
  const { app, gladys } = await setup();
  await app.start(CONFIG);
  await app.idle();
  await gladys.fake.deviceCreated(created());
  assert.equal(gladys.fake.lastState(F('consumption_index')), INDEX);
  assert.equal(status(gladys).connected, true);
  assert.match(status(gladys).message.fr, /Connecté au pont IOmeter/);
});

// --- Review r1 -------------------------------------------------------------------

const HOUR = 60 * MINUTE;
const at = (ms) => new Date(NOW + ms).toISOString();

test('a reading hours old at the first contact: nothing published, the status says so', async () => {
  const routes = bridgeRoutes();
  routes[READING] = () => json(readingWith({}, at(-3 * 24 * HOUR)));
  const { app, gladys, tick } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  await tick(MINUTE);
  for (const key of ['power', 'net_power', 'consumption_index', 'consumption_t1', 'power_l1']) {
    assert.deepEqual(published(gladys, key), [], key);
  }
  assert.equal(gladys.fake.lastState(F('battery')), 83, 'the status is fresh');
  assert.match(status(gladys).message.fr, /date de plus de 2 heures/);
  live(routes);
  await tick(MINUTE);
  assert.equal(gladys.fake.lastState(F('consumption_index')), INDEX);
  assert.doesNotMatch(status(gladys).message.fr, /2 heures/);
});

test('the age of a reading is judged on the Date of the bridge when it gives one', async () => {
  const routes = bridgeRoutes();
  const withDate = (time, date) => () =>
    new Response(JSON.stringify(readingWith({}, time)), {
      headers: { 'content-type': 'application/json', date: new Date(date).toUTCString() },
    });
  // The bridge clock 3 h behind ours: its reading is fresh.
  routes[READING] = withDate(at(-3 * HOUR), NOW - 3 * HOUR + MINUTE);
  const { app, gladys, tick } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(gladys.fake.lastState(F('consumption_index')), INDEX);
  // Its own clock says the reading is 3 h old: nothing.
  routes[READING] = withDate(at(0), NOW + 3 * HOUR);
  live(routes, { [OBIS.power]: 5 });
  routes[READING] = withDate(at(MINUTE), NOW + 3 * HOUR);
  await tick(MINUTE);
  assert.notEqual(gladys.fake.lastState(F('power')), 5);
  assert.match(status(gladys).message.fr, /date de plus de 2 heures/);
});

test('a reading frozen for 2 hours: the indexes stop too', async () => {
  const routes = bridgeRoutes();
  let i = 0;
  routes[READING] = () => json(readingWith({ [OBIS.index]: 12345678.9 + (i += 1) }));
  const { app, gladys, tick, clock } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  // The reading time stays, our clock moves on (the bridge Date is absent: our clock, ahead too).
  clock.now -= 3 * HOUR;
  for (let t = 0; t < 2 * HOUR - MINUTE; t += MINUTE) await tick(MINUTE);
  const count = indexes(gladys).length;
  assert.ok(count > 100);
  await tick(MINUTE);
  await tick(MINUTE);
  assert.equal(indexes(gladys).length, count);
});

test('a spike of a plain counter never locks it; the status says what is held', async () => {
  const routes = bridgeRoutes();
  const { app, gladys, tick } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  live(routes, { [OBIS.injection]: 500_000_000 });
  await tick(MINUTE);
  assert.match(status(gladys).message.fr, /sauté plus loin/);
  live(routes, { [OBIS.injection]: 2000600 });
  for (let k = 0; k < 30; k += 1) await tick(MINUTE);
  assert.equal(gladys.fake.lastState(F('production_index')), 2000.6);
  assert.ok(!published(gladys, 'production_index').includes(500000));
  assert.doesNotMatch(status(gladys).message.fr, /sauté plus loin|plus bas/);
});

/** Holds a jump of the index, then clicks once: the listed value. */
async function heldAndListed() {
  const routes = bridgeRoutes();
  const ctx = await setup({ routes, devices: [created()] });
  await ctx.app.start(CONFIG);
  await ctx.app.idle();
  live(routes, { [OBIS.index]: 22345678.9 });
  await ctx.tick(MINUTE);
  const first = await ctx.gladys.fake.action(ACTIONS.ACCEPT_HELD);
  assert.match(first.data.message.en, /Nothing accepted yet/);
  return { ...ctx, routes };
}

const second = async ({ gladys, clock }, after = 5_000) => {
  clock.now += after;
  clock.mono += after;
  return (await gladys.fake.action(ACTIONS.ACCEPT_HELD)).data.message.en;
};

test('accept: a second click too soon or too late only lists again', async () => {
  const soon = await heldAndListed();
  assert.match(await second(soon, 1_000), /Nothing accepted yet/);
  const late = await heldAndListed();
  assert.match(await second(late, 5 * MINUTE + 1_000), /Nothing accepted yet/);
  for (const ctx of [soon, late]) {
    await ctx.tick(MINUTE);
    assert.deepEqual(distinct(indexes(ctx.gladys)), [INDEX]);
  }
});

test('accept: another value held between the clicks is never taken', async () => {
  const cases = [
    // Direction changed: a drop held from the same reference.
    [{ [OBIS.index]: 5000 }, /changed/],
    // Lower than listed.
    [{ [OBIS.index]: 20345678.9 }, /changed/],
    // Higher than listed by more than the margin since the first click.
    [{ [OBIS.index]: 32345678.9 }, /changed/],
  ];
  for (const [values, pattern] of cases) {
    const ctx = await heldAndListed();
    live(ctx.routes, values);
    await ctx.tick(MINUTE);
    assert.match(await second(ctx, 5_000), pattern, JSON.stringify(values));
    await ctx.tick(MINUTE);
    assert.deepEqual(distinct(indexes(ctx.gladys)), [INDEX]);
  }
  // Another reference (from) since: a value back in line, then the same jump again.
  const ctx = await heldAndListed();
  live(ctx.routes, { [OBIS.index]: 12345800 });
  await ctx.tick(MINUTE);
  live(ctx.routes, { [OBIS.index]: 22345678.9 });
  await ctx.tick(MINUTE);
  assert.match(await second(ctx, 5_000), /changed/);
  assert.ok(!indexes(ctx.gladys).includes(22345.679));
});

test('accept: the device created again between the clicks; its old held state is dropped', async () => {
  const ctx = await heldAndListed();
  assert.equal(ctx.store.data[F('consumption_index')].held.direction, 'up');
  await ctx.gladys.fake.deviceCreated(created());
  assert.match(await second(ctx, 5_000), /created again|No consumption index/);
  // The new device starts from the reading, not from the old device's held jump.
  assert.equal(indexes(ctx.gladys).at(-1), 22345.679);
  assert.equal(ctx.store.data[F('consumption_index')].held, null);
});

test('accept: a guard built again between the clicks never takes the first click', async () => {
  const ctx = await heldAndListed();
  // Created again with the same reference: the new guard holds the same jump.
  await ctx.gladys.fake.deviceCreated(created(ALL, { consumption_index: [INDEX, at(0)] }));
  assert.match(await second(ctx, 5_000), /created again/);
  await ctx.tick(MINUTE);
  assert.ok(!indexes(ctx.gladys).includes(22345.679));
});

test('a slow bridge: never two requests at once', async () => {
  const routes = bridgeRoutes();
  let release;
  let inFlight = 0;
  let peak = 0;
  routes[READING] = async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => (release = resolve));
    inFlight -= 1;
    return json(readingWith({}));
  };
  const { app, fake, tick } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  const ticks = [tick(), tick(), tick()];
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fake.calls.filter((c) => c.path === READING).length, 1);
  release();
  await Promise.all(ticks);
  await app.idle();
  assert.equal(peak, 1);
});

test('only the features of the created device; status and /data written only on change', async () => {
  const routes = bridgeRoutes();
  const store = createMemoryStore();
  let saves = 0;
  const save = store.save;
  store.save = (data) => ((saves += 1), save(data));
  const caps = { ...ALL, phases: 0, battery: false };
  const { app, gladys, tick } = await setup({ routes, store, devices: [created(caps)] });
  await app.start(CONFIG);
  await app.idle();
  const statuses = gladys.fake.connectionStatuses.length;
  live(routes);
  for (let k = 0; k < 5; k += 1) await tick(MINUTE);
  assert.deepEqual(published(gladys, 'power_l1'), []);
  assert.deepEqual(published(gladys, 'battery'), []);
  assert.equal(saves, 1);
  assert.equal(gladys.fake.connectionStatuses.length, statuses);
});

test('a reference date from /data in the future is now: a normal rise is never held', async () => {
  const routes = bridgeRoutes();
  const store = createMemoryStore({
    [F('consumption_index')]: { last: { value: INDEX, at: NOW + 24 * HOUR }, held: null },
  });
  const { app, gladys, tick } = await setup({ routes, store, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  live(routes, { [OBIS.index]: 12345678.9 + 50_000 });
  await tick(HOUR);
  assert.equal(gladys.fake.lastState(F('consumption_index')), 12395.679);
});

test('an index register at 0: nothing published, nothing said held', async () => {
  const routes = bridgeRoutes();
  const { app, gladys, tick, logger } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  live(routes, { [OBIS.index]: 0 });
  await tick(MINUTE);
  await tick(MINUTE);
  assert.ok(!indexes(gladys).includes(0));
  assert.equal(logger.lines.filter((l) => /held back/.test(l)).length, 0);
});

test('a Gladys value without a date is still a reference: a lower index is held', async () => {
  const device = created(ALL, { consumption_index: [99999, 'not a date'] });
  const { app, gladys } = await setup({ devices: [device] });
  await app.start(CONFIG);
  await app.idle();
  assert.deepEqual(indexes(gladys), [99999]);
  assert.match(status(gladys).message.fr, /a baissé/);
});
