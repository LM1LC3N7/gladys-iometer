// -----------------------------------------------------------------------------
// The local HTTP API of the IOmeter bridge, plain HTTP on the home network, no
// cloud, no account, after the iometer library (IOmeter GmbH, MIT, see
// THIRD_PARTY_NOTICES.md): a GET of /v1/reading and of /v1/status. The library
// also offers a Server-Sent Events stream of the same objects; this module
// polls (see TODO.md "Decisions").
//
// The reading is the main page; the status is secondary: src/app.js never
// lets its failure hold back the reading.
//
// Errors carry our own words and codes, never a text of the device.
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, MAX_BODY_BYTES, PATHS } from '../constants.js';
import { parseReading, parseStatus } from './model.js';

export class IOmeterError extends Error {
  /**
   * @param {'timeout'|'unreachable'|'http'|'too_large'|'not_data'|'unknown_answer'|'no_data'} code
   */
  constructor(code, message, status) {
    super(message);
    this.name = 'IOmeterError';
    this.code = code;
    this.status = status;
  }
}

/** A system error code (ECONNREFUSED...) is ours to show; anything else is not. */
const systemCode = (err) => {
  const code = err?.cause?.code ?? err?.code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,30}$/.test(code) ? code : undefined;
};

/** A network failure (while connecting or while reading the body), in our words. */
function networkError(err) {
  if (err instanceof IOmeterError) {
    return err;
  }
  const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
  const code = systemCode(err);
  return new IOmeterError(
    timeout ? 'timeout' : 'unreachable',
    timeout ? 'no answer' : `unreachable${code ? ` (${code})` : ''}`,
  );
}

const tooLarge = () =>
  new IOmeterError('too_large', 'the device answered more than an IOmeter bridge sends');

/** The body, read up to `limit` bytes: a longer one is cut before its end. */
async function readBounded(response, limit) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

const notIOmeter = () =>
  new IOmeterError('unknown_answer', 'the answer is not an IOmeter bridge one');

export class IOmeterClient {
  constructor({
    address,
    fetchImpl = (...args) => globalThis.fetch(...args),
    timeout = HTTP_TIMEOUT,
  }) {
    this.address = address;
    this.fetch = fetchImpl;
    this.timeout = timeout;
  }

  /** One GET of a page, its JSON; a 404 is returned as `undefined`. */
  async get(path) {
    let response;
    let text;
    try {
      response = await this.fetch(`http://${this.address}${path}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        // A redirect is never followed: the requests stay on this address.
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeout),
      });
      // The body can fail too (timeout, connection cut): same errors.
      text = await readBounded(response, MAX_BODY_BYTES);
    } catch (err) {
      throw networkError(err);
    }
    if (response.status === 404) {
      return undefined;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new IOmeterError('http', `HTTP ${response.status}`, response.status);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new IOmeterError('not_data', 'the device answered something that is not data');
    }
  }

  /** The last reading of the meter (the main page). */
  async readReading() {
    const data = await this.get(PATHS.READING);
    if (data === undefined) {
      // The library's IOmeterNoReadingsError: the reader has sent nothing yet.
      throw new IOmeterError('no_data', 'the bridge has no reading of the meter yet');
    }
    const reading = parseReading(data);
    if (!reading) {
      throw notIOmeter();
    }
    if (reading.empty) {
      throw new IOmeterError('no_data', 'the bridge has no reading of the meter yet');
    }
    return reading;
  }

  /** The status of the bridge and of the reader (secondary): `{ none: true }` on a 404. */
  async readStatus() {
    const data = await this.get(PATHS.STATUS);
    if (data === undefined) {
      return { none: true };
    }
    const status = parseStatus(data);
    if (!status) {
      throw notIOmeter();
    }
    return status;
  }
}
