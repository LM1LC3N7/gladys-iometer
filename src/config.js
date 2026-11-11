// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// -----------------------------------------------------------------------------

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * An address typed by the user: an IP address or a host name, with an
 * optional port. A pasted URL ("http://192.168.1.30/home.html") is reduced
 * to its host and port.
 * @returns {{ address: string } | { error: 'invalid' }} `address` is '' when empty.
 */
export function parseAddress(raw) {
  let text = String(raw ?? '').trim();
  if (text === '') {
    return { address: '' };
  }
  // CR, LF and other control characters never belong in an address.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(text) || text.length > 300) {
    return { error: 'invalid' };
  }
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[/?#].*$/, '');
  // user:password@ never belongs in the address: refused rather than sent around.
  if (text.includes('@')) {
    return { error: 'invalid' };
  }
  const bracketed = /^\[([0-9a-f:.]+)\](?::(\d{1,5}))?$/i.exec(text);
  if (bracketed) {
    return badIPv6(bracketed[1])
      ? { error: 'invalid' }
      : withPort(`[${bracketed[1].toLowerCase()}]`, bracketed[2]);
  }
  if (/^[0-9a-f:.]+$/i.test(text) && (text.match(/:/g) ?? []).length >= 2) {
    return badIPv6(text) ? { error: 'invalid' } : { address: `[${text.toLowerCase()}]` };
  }
  const match = /^(.*?)(?::(\d{1,5}))?$/.exec(text);
  const host = match[1];
  if (host.length > 253 || !host.split('.').every((label) => LABEL.test(label))) {
    return { error: 'invalid' };
  }
  // A name whose last label is a number (decimal, hex 0x.., short forms like
  // 224.1) is read by fetch as an IPv4 address: only four decimal octets.
  const lastLabel = host.split('.').at(-1);
  if ((/^\d+$/.test(lastLabel) || /^0x[0-9a-f]*$/i.test(lastLabel)) && !unicastIPv4(host)) {
    return { error: 'invalid' };
  }
  return withPort(host.toLowerCase(), match[2]);
}

/**
 * A dotted IPv4 a device can have: four numbers 0-255, never 0.x (0.0.0.0
 * included), multicast (224-239), reserved or broadcast (240-255).
 */
function unicastIPv4(host) {
  const parts = host.split('.');
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) {
    return false;
  }
  const first = Number(parts[0]);
  return first !== 0 && first < 224;
}

/** The unspecified address (::) and multicast (ff00::/8): never a device. */
function badIPv6(text) {
  const lower = text.toLowerCase();
  return /^[0:]+$/.test(lower) || lower.startsWith('ff');
}

function withPort(host, port) {
  if (port === undefined) {
    return { address: host };
  }
  const number = Number(port);
  if (number < 1 || number > 65535) {
    return { error: 'invalid' };
  }
  return { address: number === 80 ? host : `${host}:${number}` };
}

export function normalizeConfig(raw = {}) {
  const parsed = parseAddress(raw?.address);
  return {
    address: parsed.error ? '' : parsed.address,
    invalidAddress: Boolean(parsed.error),
  };
}
