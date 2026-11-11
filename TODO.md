# TODO

## Before announcing

- [ ] Test on a real Gladys 5.3 with a real IOmeter (single and three-phase
      meters, with and without solar injection): test button, device
      creation, the consumption and cost the core derives from the index, the
      sensors, the mDNS listing of the Discover tab.
- [ ] Add the `gladys-assistant-integration` topic to publish in the store
      (after the first release: the store validator needs the GHCR image).

## To confirm on a real IOmeter (built without one)

- [ ] `/v1/reading` and `/v1/status` answer a plain GET with JSON (the library
      polls them; HA's integration too).
- [ ] The units given in the registers (`Wh`, `W`): other units are ignored.
- [ ] 16.7.0 is signed (negative while injecting) on bidirectional meters.
- [ ] The `time` of the reading moves at each new reading (used to see a
      frozen reading).
- [ ] The values of `powerStatus` (`battery`, `wired`?) and of
      `attachmentStatus` (`attached`, `detached`), `connectionStatus`
      (`connected`, `disconnected`).
- [ ] The mDNS name of the bridge contains `_iometer._tcp` in what the core
      gives back.

## Later

- [ ] The Server-Sent Events stream of the bridge (push instead of polling),
      bounded in size, age and inactivity.
- [ ] Several bridges per integration.
- [ ] `keywords` / `countries` (DE) in the manifest once the store accepts them.

## Decisions

- Version 0.1.0 set by hand (package.json, lock, manifest, `docker_image`);
  the Release workflow takes over from there.
- Polling every 10 s, not the SSE stream: one bounded GET is simpler to make
  safe (size, time, retries) and the library offers both; the SSE stream is
  for later.
- One device per integration, external id `iometer:meter`: the meter number
  identifies a household and is never used; a new address keeps the history.
- `power` (energy sensor) is the power taken from the grid, max(0, 16.7.0):
  the energy contracts read it for the peaks. The signed value is a plain
  sensor (`net_power`), so are the phases (36.7.0, 56.7.0, 76.7.0). Without
  16.7.0, 36.7.0 is the total power and no phase is shown (library note).
- `consumption_index` is 1.8.0 only, never the sum of the tariffs; the
  tariffs and the injection are plain counters, never lower than before
  (floors from Gladys' last values, reset by an accepted drop of the index).
- The index guard is `gladys-p1-monitor/src/guard.js` unchanged (its tariff
  helper removed), with its tests.
- /data: a missing file is empty, an unreadable one is never written over
  (the guard then starts from Gladys' last value).
- mDNS: only listed in the status when no address is set; never taken by
  itself (the user enters it).
- Categories: `energy` only.
