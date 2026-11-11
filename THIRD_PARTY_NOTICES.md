# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the project below, distributed under its own
license.

## iometer (IOmeter GmbH)

<https://pypi.org/project/iometer/>, the Python client published by IOmeter
GmbH, the maker of the device, and used by the IOmeter integration of Home
Assistant. Version 1.0.3 (PyPI sdist `iometer-1.0.3.tar.gz`, 2026-11-10; the
GitHub repository it names is not public).

Ported to JavaScript in `src/iometer/client.js` and `src/iometer/model.js`: the
two pages of the local HTTP API of the bridge (`/v1/reading`, `/v1/status`)
and their 404 meaning "nothing yet", the shape of the reading (OBIS registers
with value and unit, Wh and W) and of the status (bridge and core: rssi,
connection, power, battery, attachment), the OBIS codes read (1.8.0, 1.8.1,
1.8.2, 2.8.0, 16.7.0, 36.7.0, 56.7.0, 76.7.0) and the fallback of the power to
36.7.0 on meters without 16.7.0. Not ported: the Server-Sent Events client.

```
MIT License

Copyright (c) [2024] [IOmeter]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## gladys-p1-monitor (same author as this integration)

`src/guard.js` (the plausibility guard of the billed index) and the structure
of `src/app.js` come from <https://github.com/LM1LC3N7/gladys-p1-monitor>,
Apache-2.0, like this integration.
