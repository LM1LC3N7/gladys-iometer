// -----------------------------------------------------------------------------
// The answers of the IOmeter bridge, read into plain values. Pure.
//
// After the iometer library (IOmeter GmbH, MIT, see THIRD_PARTY_NOTICES.md):
// - GET /v1/reading: `{ installationId, meter: { number, reading: { time,
//   registers: [{ obis, value, unit }] } } }`, the OBIS registers of the meter
//   in Wh and W;
// - GET /v1/status: `{ installationId, meter: { number }, device: { id,
//   bridge: { rssi, version }, core: { connectionStatus, rssi, version,
//   powerStatus, batteryLevel, attachmentStatus, pinStatus } } }`.
//
// The meter number and the installation id identify a household: never read
// here, so they can reach no log, status nor /data.
//
// A value is a finite JSON number, nothing else: a text, null or an empty
// string is unknown, never 0. An OBIS code is compared in lower case.
// -----------------------------------------------------------------------------

import { COUNTER_MAX, MAX_REGISTERS, POWER_MAX } from '../constants.js';

/** The OBIS codes the library reads (hex digits: 10 is 16.7.0, 24 is 36.7.0, 4c is 76.7.0). */
export const OBIS = {
  CONSUMPTION: '01-00:01.08.00*ff',
  PRODUCTION: '01-00:02.08.00*ff',
  CONSUMPTION_T1: '01-00:01.08.01*ff',
  CONSUMPTION_T2: '01-00:01.08.02*ff',
  POWER: '01-00:10.07.00*ff',
  /** Some meters give no 16.7.0 and their total power in 36.7.0 (library note). */
  POWER_L1: '01-00:24.07.00*ff',
  POWER_L2: '01-00:38.07.00*ff',
  POWER_L3: '01-00:4c.07.00*ff',
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A finite JSON number, or undefined. */
export const num = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** An energy register in kWh: Wh (the library's unit) or kWh; any other unit is unknown. */
function energyOf(register) {
  const value = num(register?.value);
  if (value === undefined || value < 0) return undefined;
  const unit = register.unit ?? 'Wh';
  let kwh;
  if (unit === 'Wh') kwh = value / 1000;
  else if (unit === 'kWh') kwh = value;
  else return undefined;
  return kwh <= COUNTER_MAX ? kwh : undefined;
}

/** A power register in W (W or kW), signed; beyond POWER_MAX it is a glitch. */
function powerOf(register) {
  const value = num(register?.value);
  if (value === undefined) return undefined;
  const unit = register.unit ?? 'W';
  let watts;
  if (unit === 'W') watts = value;
  else if (unit === 'kW') watts = value * 1000;
  else return undefined;
  return Math.abs(watts) <= POWER_MAX ? watts : undefined;
}

/**
 * The reading: `{ time, empty, power, consumption, consumptionT1,
 * consumptionT2, production, phases: [l1, l2, l3] }` (W and kWh, undefined
 * when unknown), or undefined when the answer is not an IOmeter reading.
 */
export function parseReading(data) {
  const reading = isObject(data) && isObject(data.meter) ? data.meter.reading : undefined;
  if (!isObject(reading) || !Array.isArray(reading.registers)) {
    return undefined;
  }
  const registers = new Map();
  for (const register of reading.registers.slice(0, MAX_REGISTERS)) {
    if (!isObject(register) || typeof register.obis !== 'string' || register.obis.length > 40) {
      continue;
    }
    if (register.unit !== undefined && typeof register.unit !== 'string') continue;
    const obis = register.obis.toLowerCase();
    // The first one wins: a register given twice never overrides the first.
    if (!registers.has(obis)) registers.set(obis, register);
  }
  const reg = (obis) => registers.get(obis);
  const net = powerOf(reg(OBIS.POWER));
  const time =
    typeof reading.time === 'string' && reading.time.length <= 40 ? reading.time : undefined;
  return {
    time,
    empty: registers.size === 0,
    power: net !== undefined || reg(OBIS.POWER) ? net : powerOf(reg(OBIS.POWER_L1)),
    consumption: energyOf(reg(OBIS.CONSUMPTION)),
    consumptionT1: energyOf(reg(OBIS.CONSUMPTION_T1)),
    consumptionT2: energyOf(reg(OBIS.CONSUMPTION_T2)),
    production: energyOf(reg(OBIS.PRODUCTION)),
    // Per phase only when the meter also gives its total power: otherwise
    // 36.7.0 is that total (library note), never L1.
    phases: reg(OBIS.POWER)
      ? [OBIS.POWER_L1, OBIS.POWER_L2, OBIS.POWER_L3].map((o) => powerOf(reg(o)))
      : [],
  };
}

const RSSI = (value) => {
  const n = num(value);
  return n !== undefined && Number.isInteger(n) && n >= -130 && n <= 0 ? n : undefined;
};

const flag = (value, yes, no) => (value === yes ? 1 : value === no ? 0 : undefined);

/**
 * The status: `{ bridgeRssi, coreRssi, coreConnected, coreAttached, battery }`
 * (dBm, 1/0, %), undefined when unknown; or undefined when the answer is not
 * an IOmeter status.
 */
export function parseStatus(data) {
  const device = isObject(data) ? data.device : undefined;
  if (!isObject(device) || !isObject(device.core)) {
    return undefined;
  }
  const bridge = isObject(device.bridge) ? device.bridge : {};
  const core = device.core;
  const level = num(core.batteryLevel);
  return {
    bridgeRssi: RSSI(bridge.rssi),
    coreRssi: RSSI(core.rssi),
    coreConnected: flag(core.connectionStatus, 'connected', 'disconnected'),
    coreAttached: flag(core.attachmentStatus, 'attached', 'detached'),
    // A reader on mains power has no battery level to show.
    battery:
      core.powerStatus !== 'wired' && Number.isInteger(level) && level >= 0 && level <= 100
        ? level
        : undefined,
  };
}

/** What the bridge showed it gives: the features of the device. */
export const NO_CAPABILITIES = Object.freeze({
  power: false,
  consumption: false,
  tariffs: false,
  production: false,
  phases: 0,
  battery: false,
  bridgeRssi: false,
  coreRssi: false,
  coreConnected: false,
  coreAttached: false,
});

/** The capabilities a reading and a status show (a value at 0 counts: it is known). */
export function capabilitiesOf({ reading, status } = {}) {
  const known = (value) => value !== undefined;
  let phases = 0;
  for (const [i, value] of (reading?.phases ?? []).entries()) {
    if (known(value)) phases = i + 1;
  }
  return {
    power: known(reading?.power),
    consumption: known(reading?.consumption),
    tariffs: known(reading?.consumptionT1) || known(reading?.consumptionT2),
    production: known(reading?.production),
    phases,
    battery: known(status?.battery),
    bridgeRssi: known(status?.bridgeRssi),
    coreRssi: known(status?.coreRssi),
    coreConnected: known(status?.coreConnected),
    coreAttached: known(status?.coreAttached),
  };
}

/** Both together: a capability seen once stays (the device never loses a feature). */
export function mergeCapabilities(a, b) {
  if (!a) return b ? { ...NO_CAPABILITIES, ...b } : undefined;
  if (!b) return { ...NO_CAPABILITIES, ...a };
  const merged = { ...NO_CAPABILITIES };
  for (const key of Object.keys(NO_CAPABILITIES)) {
    merged[key] =
      key === 'phases' ? Math.max(a.phases ?? 0, b.phases ?? 0) : Boolean(a[key] || b[key]);
  }
  return merged;
}

/** Whether `target` holds a capability `current` has not. */
export function bringsNew(current, target) {
  if (!current) return Boolean(target);
  return Object.keys(NO_CAPABILITIES).some((key) =>
    key === 'phases'
      ? (target.phases ?? 0) > (current.phases ?? 0)
      : Boolean(target[key]) && !current[key],
  );
}
