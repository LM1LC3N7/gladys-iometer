// -----------------------------------------------------------------------------
// Constants shared by the integration. Every key stored by Gladys (actions,
// manifest keys, feature keys in src/devices.js) is forever: never rename one.
// -----------------------------------------------------------------------------

export const ACTIONS = { TEST: 'test_connection', ACCEPT_HELD: 'accept_held_index' };

/**
 * The external id of the device: `iometer:meter`, one device per integration,
 * whatever the address (a new IP address of the same bridge keeps its device
 * and history). The meter number is never used: it identifies a household.
 */
export const EXTERNAL_ID_TYPE = 'iometer';
export const PLATFORM_ID = 'meter';

// --- The local HTTP API of the IOmeter bridge (as the iometer library reads it) ----
export const PATHS = {
  /** The last reading of the meter: the OBIS registers. */
  READING: '/v1/reading',
  /** The bridge and the reader on the meter ("core"): signal, battery, link. */
  STATUS: '/v1/status',
};

export const HTTP_TIMEOUT = 10_000;
/** A reading or a status is well under 4 KiB: more is not an IOmeter bridge. */
export const MAX_BODY_BYTES = 64 * 1024;
/** Registers looked at in one reading: a meter gives a dozen at most. */
export const MAX_REGISTERS = 64;

// --- Schedule ------------------------------------------------------------------------
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
/** The reading (power, phases): one GET every 10 s. */
export const POWER_INTERVAL = 10 * SECOND;
/** The indexes: published once a minute. */
export const INDEX_INTERVAL = 60 * SECOND;
/** The status (signal, battery, link): read once a minute. */
export const STATUS_INTERVAL = MINUTE;
/** A bridge saying it has no status (404): asked again after this delay. */
export const NO_STATUS_RETRY = HOUR;
/** The status failing: tried again after this delay (never blocking the reading). */
export const SECONDARY_RETRY = 5 * MINUTE;
/** An unreachable bridge: tries after 10 s, then doubled up to 5 minutes. */
export const RETRY_MIN = 10 * SECOND;
export const RETRY_MAX = 5 * MINUTE;
/** Unchanged values are sent again after this delay (publishChangedStates heartbeat). */
export const STATE_HEARTBEAT = 10 * MINUTE;
/** The test button answers within this delay. */
export const TEST_ANSWER_WITHIN = 25 * SECOND;
/** "Accept the held index": the second click, from 3 s to 5 min after the first. */
export const ACCEPT_CONFIRM_AFTER = 3 * SECOND;
export const ACCEPT_CONFIRM_WITHIN = 5 * MINUTE;
/**
 * The reading has not changed (same time of the meter) for this long: the
 * power and the phases are stale (reader off the meter, out of battery), they
 * are no longer published. Measured on our clock only.
 */
export const READING_STALE_AFTER = 5 * MINUTE;

// --- Plausibility of the electricity index (the one Gladys bills) --------------------
/** A home never draws more than this on average between two reads. */
export const INDEX_MAX_KW = 100;
/** kWh always accepted on top of INDEX_MAX_KW × hours (rounding, a late read). */
export const INDEX_SLACK_KWH = 0.5;
/** A power above this (W, either sign) is a glitch: a home connection never draws nor injects as much. */
export const POWER_MAX = 100_000;
/** A counter above this (kWh) is a glitch. */
export const COUNTER_MAX = 1_000_000_000;
