// -----------------------------------------------------------------------------
// The HTTP client against a real local server (127.0.0.1, a free port): the
// bodies are bounded before their end, a silent bridge times out, a redirect
// is never followed, the errors are our own words.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { IOmeterClient, IOmeterError } from '../src/iometer/client.js';
import { MAX_BODY_BYTES } from '../src/constants.js';
import { STATUS, reading } from './fixtures/iometer.js';

/** A server answering with `handler(req, res)`; closed (with its sockets) after the test. */
async function serve(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  return `127.0.0.1:${server.address().port}`;
}

const rejectsWith = (promise, code) =>
  assert.rejects(promise, (err) => err instanceof IOmeterError && err.code === code);

test('a reading and a status read from a real server', async (t) => {
  const seen = [];
  const address = await serve(t, (req, res) => {
    seen.push([req.method, req.url, req.headers.accept]);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url === '/v1/reading' ? reading() : STATUS));
  });
  const client = new IOmeterClient({ address });
  const r = await client.readReading();
  assert.equal(r.consumption, 12345.6789);
  assert.equal(r.power, 1234);
  const s = await client.readStatus();
  assert.equal(s.battery, 83);
  assert.deepEqual(seen, [
    ['GET', '/v1/reading', 'application/json'],
    ['GET', '/v1/status', 'application/json'],
  ]);
});

test('an endless body is cut at the limit, long before its end', async (t) => {
  let sent = 0;
  const address = await serve(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    const chunk = Buffer.alloc(16 * 1024, 0x20);
    const pump = () => {
      while (sent < 50 * 1024 * 1024 && res.write(chunk)) sent += chunk.length;
      if (sent < 50 * 1024 * 1024 && !res.destroyed) res.once('drain', pump);
    };
    res.on('close', () => res.removeAllListeners('drain'));
    pump();
  });
  await rejectsWith(new IOmeterClient({ address }).readReading(), 'too_large');
  assert.ok(sent < 10 * 1024 * 1024, `sent ${sent} bytes`);
});

test('a declared length above the limit is refused before reading', async (t) => {
  const address = await serve(t, (req, res) => {
    res.writeHead(200, { 'content-length': String(MAX_BODY_BYTES + 1) });
    res.write('{');
  });
  await rejectsWith(new IOmeterClient({ address }).readReading(), 'too_large');
});

test('a silent bridge, or one that stops in the middle: a timeout, in our words', async (t) => {
  const silent = await serve(t, () => {});
  const half = await serve(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"meter":');
  });
  for (const address of [silent, half]) {
    const started = performance.now();
    await rejectsWith(new IOmeterClient({ address, timeout: 200 }).readReading(), 'timeout');
    assert.ok(performance.now() - started < 5_000);
  }
});

test('a redirect is never followed; 404, 500, not JSON, not an IOmeter', async (t) => {
  let followed = 0;
  const address = await serve(t, (req, res) => {
    if (req.url === '/elsewhere') {
      followed += 1;
      res.end('{}');
      return;
    }
    res.writeHead(302, { location: '/elsewhere' });
    res.end();
  });
  await rejectsWith(new IOmeterClient({ address }).readReading(), 'http');
  assert.equal(followed, 0);
  const answers = {
    '/v1/reading': [404, '{}'],
    '/v1/status': [404, '{}'],
  };
  const other = await serve(t, (req, res) => {
    const [code, body] = answers[req.url];
    res.writeHead(code);
    res.end(body);
  });
  const client = new IOmeterClient({ address: other });
  await rejectsWith(client.readReading(), 'no_data');
  assert.deepEqual(await client.readStatus(), { none: true });
  answers['/v1/reading'] = [500, 'Internal error with a secret 1EBZ'];
  await assert.rejects(
    client.readReading(),
    (err) => err.code === 'http' && !/1EBZ/.test(err.message),
  );
  answers['/v1/reading'] = [200, '<html>'];
  await rejectsWith(client.readReading(), 'not_data');
  answers['/v1/reading'] = [200, '{"meter":{"reading":{"registers":[]}}}'];
  await rejectsWith(client.readReading(), 'no_data');
  answers['/v1/reading'] = [200, '{"hello":1}'];
  await rejectsWith(client.readReading(), 'unknown_answer');
  answers['/v1/status'] = [200, '[]'];
  await rejectsWith(client.readStatus(), 'unknown_answer');
});

test('nothing listening: unreachable, with the system code only', async (t) => {
  const address = await serve(t, () => {});
  const port = address.split(':')[1];
  // Closed now: the port refuses.
  const closed = createServer();
  await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const free = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));
  assert.notEqual(String(free), port);
  await assert.rejects(
    new IOmeterClient({ address: `127.0.0.1:${free}` }).readReading(),
    (err) => err.code === 'unreachable' && /ECONNREFUSED/.test(err.message),
  );
});
