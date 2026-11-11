// -----------------------------------------------------------------------------
// The Gladys device of an IOmeter and its states. Pure.
//
// External id (forever): iometer:meter, one device per integration. The meter
// number identifies a household and is never used; an address would change
// with the router: a new address of the same bridge keeps the device and its
// history (the index guard holds a different meter's values).
//
// Energy rules of the Gladys core (server/utils/constants.js and the
// energy-monitoring service):
// - `consumption_index` (OBIS 1.8.0) is the ONLY energy-sensor / index
//   feature: the core derives the consumption and its cost from its deltas,
//   by itself. Never a daily total, never the injection;
// - the tariff registers (1.8.1, 1.8.2) are plain sensors: as indexes they
//   would be counted a second and a third time;
// - the injection (2.8.0) is never in a consumption index (it would be
//   billed): a plain sensor, kWh in the name;
// - `power` is the only energy-sensor / power feature: the power TAKEN from
//   the grid (never below 0), read by the energy contracts for the peaks.
//   The meter gives a signed net power (16.7.0, negative while injecting):
//   it is also published as is, in a plain sensor, and so are the phases;
// - units: only the ones the core lists for the category
//   (DEVICE_FEATURE_UNITS_BY_CATEGORY): W and kWh for energy-sensor, % for
//   battery, none for unknown (the unit is then in the name).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { COUNTER_MAX, EXTERNAL_ID_TYPE, PLATFORM_ID, POWER_MAX } from './constants.js';
import { NO_CAPABILITIES } from './iometer/model.js';

/** Feature keys (forever). */
export const FEATURE = {
  POWER: 'power',
  NET_POWER: 'net_power',
  CONSUMPTION_INDEX: 'consumption_index',
  CONSUMPTION_T1: 'consumption_t1',
  CONSUMPTION_T2: 'consumption_t2',
  PRODUCTION_INDEX: 'production_index',
  BATTERY: 'battery',
  BRIDGE_RSSI: 'bridge_rssi',
  CORE_RSSI: 'core_rssi',
  CORE_CONNECTED: 'core_connected',
  CORE_ATTACHED: 'core_attached',
  phasePower: (n) => `power_l${n}`,
};

/** The plain counters (kWh): never 0, never published lower than before. */
export const PLAIN_COUNTERS = [
  FEATURE.CONSUMPTION_T1,
  FEATURE.CONSUMPTION_T2,
  FEATURE.PRODUCTION_INDEX,
];

/** The external ids of the one device of the integration. */
export const ids = (gladys) => gladys.externalIds(EXTERNAL_ID_TYPE, PLATFORM_ID);

const feature = (external, key, name, category, type, extra = {}) => ({
  name,
  external_id: external.feature(key),
  category,
  type,
  min: 0,
  max: COUNTER_MAX,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});

/** A value shown, never summed nor billed: no energy category, no unit (it is in the name). */
const plain = (external, key, name, extra = {}) =>
  feature(external, key, name, C.UNKNOWN, T.SENSOR.DECIMAL, extra);

const signedPower = { min: -POWER_MAX, max: POWER_MAX, keep_history: false };
const signal = (external, key, name) =>
  feature(external, key, name, C.UNKNOWN, T.SENSOR.INTEGER, {
    min: -130,
    max: 0,
    keep_history: false,
  });
const yesNo = (external, key, name) =>
  feature(external, key, name, C.UNKNOWN, T.SENSOR.INTEGER, { min: 0, max: 1 });

/**
 * The device, with the features its capabilities show (src/iometer/model.js
 * capabilitiesOf). The features are fixed when the user creates it.
 */
export function buildDevice(gladys, capabilities, address) {
  const external = ids(gladys);
  const caps = { ...NO_CAPABILITIES, ...capabilities };
  const features = [];
  if (caps.power) {
    features.push(
      feature(
        external,
        FEATURE.POWER,
        'Power taken from the grid',
        C.ENERGY_SENSOR,
        T.ENERGY_SENSOR.POWER,
        { unit: U.WATT, max: POWER_MAX },
      ),
      plain(external, FEATURE.NET_POWER, 'Net power, negative when injecting (W)', signedPower),
    );
  }
  if (caps.consumption) {
    features.push(
      feature(
        external,
        FEATURE.CONSUMPTION_INDEX,
        'Consumption index',
        C.ENERGY_SENSOR,
        T.ENERGY_SENSOR.INDEX,
        { unit: U.KILOWATT_HOUR },
      ),
    );
  }
  if (caps.tariffs) {
    features.push(
      plain(external, FEATURE.CONSUMPTION_T1, 'Consumption index, tariff 1 (kWh)'),
      plain(external, FEATURE.CONSUMPTION_T2, 'Consumption index, tariff 2 (kWh)'),
    );
  }
  if (caps.production) {
    features.push(plain(external, FEATURE.PRODUCTION_INDEX, 'Injection index (kWh)'));
  }
  for (let n = 1; n <= Math.min(3, caps.phases); n += 1) {
    features.push(
      plain(external, FEATURE.phasePower(n), `Power L${n}, negative when injecting (W)`, {
        ...signedPower,
      }),
    );
  }
  if (caps.battery) {
    features.push(
      feature(external, FEATURE.BATTERY, 'Reader battery', C.BATTERY, T.BATTERY.INTEGER, {
        unit: U.PERCENT,
        max: 100,
      }),
    );
  }
  if (caps.bridgeRssi) {
    features.push(signal(external, FEATURE.BRIDGE_RSSI, 'Bridge Wi-Fi signal (dBm)'));
  }
  if (caps.coreRssi) {
    features.push(signal(external, FEATURE.CORE_RSSI, 'Reader radio signal (dBm)'));
  }
  if (caps.coreConnected) {
    features.push(
      yesNo(external, FEATURE.CORE_CONNECTED, 'Reader connected to the bridge (1 = yes, 0 = no)'),
    );
  }
  if (caps.coreAttached) {
    features.push(
      yesNo(external, FEATURE.CORE_ATTACHED, 'Reader attached to the meter (1 = yes, 0 = no)'),
    );
  }
  return {
    name: 'IOmeter',
    external_id: external.device,
    features,
    params: [{ name: 'address', value: address }],
  };
}

/**
 * The capabilities a CREATED device carries (its features): the device
 * published again never has fewer features than the one the user created
 * (a missing one would read as a change, and "Update" would drop its history).
 */
export function capabilitiesOfDevice(device) {
  const keys = new Set(
    (device?.features ?? []).map((f) => String(f.external_id).split(':').at(-1)),
  );
  if (keys.size === 0) {
    return undefined;
  }
  let phases = 0;
  for (const n of [1, 2, 3]) {
    if (keys.has(FEATURE.phasePower(n))) phases = n;
  }
  return {
    power: keys.has(FEATURE.POWER) || keys.has(FEATURE.NET_POWER),
    consumption: keys.has(FEATURE.CONSUMPTION_INDEX),
    tariffs: keys.has(FEATURE.CONSUMPTION_T1) || keys.has(FEATURE.CONSUMPTION_T2),
    production: keys.has(FEATURE.PRODUCTION_INDEX),
    phases,
    battery: keys.has(FEATURE.BATTERY),
    bridgeRssi: keys.has(FEATURE.BRIDGE_RSSI),
    coreRssi: keys.has(FEATURE.CORE_RSSI),
    coreConnected: keys.has(FEATURE.CORE_CONNECTED),
    coreAttached: keys.has(FEATURE.CORE_ATTACHED),
  };
}

export const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const state = (external, key, value, digits) =>
  isNumber(value)
    ? [{ device_feature_external_id: external.feature(key), state: round(value, digits) }]
    : [];

/** The live values of a reading, every 10 s: the powers. */
export function liveStates(external, reading) {
  return [
    ...state(
      external,
      FEATURE.POWER,
      isNumber(reading.power) ? Math.max(0, reading.power) : NaN,
      0,
    ),
    ...state(external, FEATURE.NET_POWER, reading.power, 0),
    ...reading.phases.flatMap((value, i) => state(external, FEATURE.phasePower(i + 1), value, 0)),
  ];
}

/**
 * The indexes, once a minute. `consumptionIndex` is the value the IndexGuard
 * let through (undefined: not published this time). `floors` maps a plain
 * counter key to the lowest value it may take (src/app.js): a counter is never
 * published at 0 nor lower than before.
 */
export function indexStates(external, reading, consumptionIndex, floors = new Map()) {
  const counter = (key, value) =>
    isNumber(value) && value > 0 && round(value, 3) >= (floors.get(key) ?? 0)
      ? state(external, key, value, 3)
      : [];
  return [
    ...(isNumber(consumptionIndex) && consumptionIndex > 0
      ? state(external, FEATURE.CONSUMPTION_INDEX, consumptionIndex, 3)
      : []),
    ...counter(FEATURE.CONSUMPTION_T1, reading.consumptionT1),
    ...counter(FEATURE.CONSUMPTION_T2, reading.consumptionT2),
    ...counter(FEATURE.PRODUCTION_INDEX, reading.production),
  ];
}

/** The status values, once a minute (no history kept by Gladys for the signals). */
export function statusStates(external, status) {
  if (!status || status.none) return [];
  return [
    ...state(external, FEATURE.BATTERY, status.battery, 0),
    ...state(external, FEATURE.BRIDGE_RSSI, status.bridgeRssi, 0),
    ...state(external, FEATURE.CORE_RSSI, status.coreRssi, 0),
    ...state(external, FEATURE.CORE_CONNECTED, status.coreConnected, 0),
    ...state(external, FEATURE.CORE_ATTACHED, status.coreAttached, 0),
  ];
}
