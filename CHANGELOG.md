# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-11-11

### Added

- First version: the IOmeter bridge read through its local API every 10
  seconds; power taken from the grid and consumption index (1.8.0) for the
  Gladys energy monitoring; net power, tariff and injection indexes, power per
  phase, reader battery, signals and link as sensors; plausibility guard of
  the billed index with a two-click "Accept the held index" action; network
  discovery (mDNS) of the bridge from the Discover tab; a reading more than 2
  hours old is never published; plain counters held on a drop or a spike.

[Unreleased]: https://github.com/LM1LC3N7/gladys-iometer/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-iometer/releases/tag/v0.1.1
