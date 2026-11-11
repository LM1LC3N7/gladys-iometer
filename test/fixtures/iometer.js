// -----------------------------------------------------------------------------
// Answers of an IOmeter bridge, in the shapes the iometer library reads
// (iometer 1.0.3, reading.py and status.py, and its README). The meter number
// and the installation id are fake: they must reach no log, status nor /data.
// -----------------------------------------------------------------------------

export const ADDRESS = '192.168.1.40';
export const NOW = Date.parse('2026-11-11T10:00:00Z');
export const METER_NUMBER = '1EBZ0100507409';
export const INSTALLATION_ID = 'a9b8c7d6-secret-installation';

/** A register list, in Wh and W as the bridge gives them. */
export const REGISTERS = [
  { obis: '01-00:01.08.00*ff', value: 12345678.9, unit: 'Wh' },
  { obis: '01-00:01.08.01*ff', value: 8000000, unit: 'Wh' },
  { obis: '01-00:01.08.02*ff', value: 4345678.9, unit: 'Wh' },
  { obis: '01-00:02.08.00*ff', value: 2000500, unit: 'Wh' },
  { obis: '01-00:10.07.00*ff', value: 1234, unit: 'W' },
  { obis: '01-00:24.07.00*ff', value: 400, unit: 'W' },
  { obis: '01-00:38.07.00*ff', value: 500, unit: 'W' },
  { obis: '01-00:4C.07.00*ff', value: 334, unit: 'W' },
];

/** A reading at `time` (ISO), with these registers. */
export const reading = (registers = REGISTERS, time = '2026-11-11T10:00:00Z') => ({
  __typename: 'iometer.reading.v1',
  installationId: INSTALLATION_ID,
  meter: { number: METER_NUMBER, reading: { time, registers } },
});

/** A reading with some registers changed: `{ obis: value }` (Wh, W), null removes one. */
export function readingWith(values = {}, time) {
  const registers = REGISTERS.map((r) => ({ ...r }));
  for (const [obis, value] of Object.entries(values)) {
    const i = registers.findIndex((r) => r.obis.toLowerCase() === obis.toLowerCase());
    if (value === null) {
      if (i >= 0) registers.splice(i, 1);
    } else if (i >= 0) {
      registers[i].value = value;
    } else {
      registers.push({ obis, value, unit: obis.includes('.07.') ? 'W' : 'Wh' });
    }
  }
  return reading(registers, time);
}

export const STATUS = {
  __typename: 'iometer.status.v1',
  installationId: INSTALLATION_ID,
  meter: { number: METER_NUMBER },
  device: {
    id: 'bridge-secret-id',
    bridge: { rssi: -55, version: 'build-1' },
    core: {
      connectionStatus: 'connected',
      rssi: -72,
      version: 'build-2',
      powerStatus: 'battery',
      batteryLevel: 83,
      attachmentStatus: 'attached',
      pinStatus: 'entered',
    },
  },
};

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The routes of a bridge that answers everything. */
export const routes = () => ({
  '/v1/reading': () => json(reading()),
  '/v1/status': () => json(STATUS),
});
