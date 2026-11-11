# gladys-iometer

Unofficial [Gladys Assistant](https://gladysassistant.com) integration for the
[IOmeter](https://iometer.de/) smart meter reader (Germany), not affiliated
with IOmeter GmbH. It reads the local API of the IOmeter bridge, without any
cloud, read only: power, consumption index (1.8.0) for the Gladys energy
monitoring, tariff and injection indexes, power per phase, battery and signal
of the reader. **Never tested with a real IOmeter.** Not the Discovergy
(inexogy) integration.

- User guide: [English](docs/en.md), [français](docs/fr.md).
- Built after the `iometer` Python library of IOmeter GmbH (MIT), see
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- Development: [CLAUDE.md](CLAUDE.md); open points: [TODO.md](TODO.md).

```bash
npm install
npm test
npm run lint && npm run format:check
```

License: Apache-2.0.
