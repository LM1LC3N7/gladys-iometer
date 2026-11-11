// -----------------------------------------------------------------------------
// The plain counters (tariff 1 and 2 indexes, injection index): shown, never
// billed. Pure. A counter of the meter never goes down, so:
// - a value lower than the last one published is not sent (only an accepted
//   drop of the consumption index, a new meter, resets the counters);
// - a value above the last one by more than a home may draw since
//   (src/guard.js margin) is held, not sent, and never raises the floor: a
//   single glitch can never lock the counter;
// - a held jump is taken when the meter keeps giving it, each value plausible
//   after the one before, for COUNTER_JUMP_CONFIRM: these counters are not
//   billed, a repeated value is enough (unlike the consumption index);
// - without a reference (a new device), the first value is taken only once a
//   second one agrees with it (not lower, within the margin): a spike as the
//   first reading never becomes the floor.
// -----------------------------------------------------------------------------

import { COUNTER_JUMP_CONFIRM } from './constants.js';
import { margin } from './guard.js';

const valid = (ref) =>
  ref && Number.isFinite(ref.value) && ref.value > 0 && Number.isFinite(ref.at)
    ? { value: ref.value, at: ref.at }
    : undefined;

export class CounterFloor {
  /** `ref`: the value Gladys holds (`{ value, at }`, session dates), when known. */
  constructor(ref) {
    this.floor = valid(ref);
    this.pending = undefined;
    /** 'ok' | 'down' | 'jump': what the last value was. */
    this.state = 'ok';
  }

  /** Whether `value` (3 decimals), read at `at`, may be published. */
  accept(value, at) {
    if (!Number.isFinite(value) || value <= 0) {
      return false;
    }
    if (!this.floor) {
      const c = this.candidate;
      if (c && value >= c.value && value - c.value <= margin(c.at, at)) {
        return this.take(value, at);
      }
      this.candidate = { value, at };
      return false;
    }
    if (value < this.floor.value) {
      this.state = 'down';
      return false;
    }
    if (value === this.floor.value) {
      // Unchanged: published, its date not moved (the margin keeps growing).
      this.pending = undefined;
      this.state = 'ok';
      return true;
    }
    if (value - this.floor.value <= margin(this.floor.at, at)) {
      return this.take(value, at);
    }
    const p = this.pending;
    if (p && value >= p.value && value - p.value <= margin(p.lastAt, at)) {
      this.pending = { ...p, value, lastAt: at };
      if (at - p.since >= COUNTER_JUMP_CONFIRM) {
        return this.take(value, at);
      }
    } else {
      this.pending = { value, since: at, lastAt: at };
    }
    this.state = 'jump';
    return false;
  }

  take(value, at) {
    this.floor = { value, at };
    this.candidate = undefined;
    this.pending = undefined;
    this.state = 'ok';
    return true;
  }

  /** A new meter: starts again from the next value. */
  reset() {
    this.floor = undefined;
    this.candidate = undefined;
    this.pending = undefined;
    this.state = 'ok';
  }
}
