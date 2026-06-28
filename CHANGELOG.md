# Changelog

All notable changes to this project will be documented in this file.

## [1.2.2] - 2026-06-28

### Fixed
- **Frequent `502` / "Invalid API key" log spam** ([#3](https://github.com/lastowl/homebridge-nolongerevil-nest/issues/3)) — Transient upstream failures while polling no longer flood the Homebridge log
  - Idempotent `GET` reads now retry with exponential backoff + jitter on transient errors (network/timeout, `408`, `429`, `5xx`, and the intermittent `401`s that occur during upstream incidents)
  - A failed poll keeps the last-known state and logs at `debug`; a single `warn` is emitted only if failures persist, then suppressed until the API recovers
  - Added a 15s per-request timeout so a hung connection can no longer stall polling

## [1.2.1] - 2026-03-07

### Fixed
- **Self-hosted API rewrite** — Aligned with the production NoLongerEvil-SelfHosted server API (thanks @roberto-montanari, [#2](https://github.com/lastowl/homebridge-nolongerevil-nest/issues/2))
  - Use flat device model from `GET /api/devices` instead of nested shared/device state objects
  - Use command-based API (`set_temperature`, `set_mode`, `set_away`, `set_schedule`) matching the production server
  - Schedule read now uses `GET /api/schedule?serial=X` endpoint
  - Learning mode uses `set_device_setting` command with whitelisted device fields

## [1.2.0] - 2026-03-07

### Added
- **Device Information Panel** — Full device data displayed in the Homebridge UI including status, safety temperatures, away temperatures, hardware details, service information, and Heat Link info
- **Safety Temperature Integration** — Schedule end times automatically revert to the device's configured safety temperatures (freeze/overheat protection)
- **Learning Mode Switch** — HomeKit switch to toggle the Nest's learning mode on/off (renamed from Smart Schedule)
- **Schedule Editor** — Visual 24h x 7-day grid schedule editor in the Homebridge UI
  - Click or drag across cells to set start/end times
  - Support for HEAT, COOL, and RANGE schedule modes
  - Copy a day's schedule to all weekdays
  - Duration entries with automatic safety temp revert
- **Dark Mode** — Auto-detects Homebridge UI theme and switches between light/dark mode
- **Raw State API** — Server endpoint to fetch full device state from the NoLongerEvil API
- **Toast Notifications** — Save button shows "Saving..." state and displays toast notifications on success/failure

### Changed
- **Smart Schedule switch now only controls learning mode** — Schedules are managed independently via the schedule editor and are never cleared by the switch
- **Removed local schedule caching** — Schedules are always read from and written to the device via the API
- **Simplified end time behavior** — End time entries revert to safety temperatures instead of arbitrary values

### Fixed
- Schedule disappearing after save (re-clear logic was wiping user-saved schedules)
- Double-click on save causing 502 errors (added saving flag to prevent concurrent requests)
- End time entries using wrong temperature (snapshot previous entries before adding new ones)
- Dark mode readability issues with hardcoded light-mode colors
- "Create Schedule" button doing nothing (circular empty-days check)
- `homebridge.ready is not a function` error
- Config reading using wrong API (`getPluginConfig` vs `fs.readFileSync`)
- `customUi: true` placed in wrong file (moved to config.schema.json)

## [1.1.0] - 2025-12-15

### Added
- Multi-source API support for hosted and self-hosted servers simultaneously
- `servers` array configuration for multiple API sources
- Automatic device discovery across all configured sources
- Server name labels in logs for easier identification

### Changed
- Single `apiKey`/`serverUrl` fields still work for simple setups
- When `servers` is configured, simple setup fields are ignored

## [1.0.3] - 2025-12-14

### Fixed
- Temperature range validation error when setting heat/cool thresholds

## [1.0.2] - 2025-12-13

### Fixed
- Homebridge verification issues preventing plugin from loading

## [1.0.1] - 2025-12-12

### Fixed
- API URL construction for path concatenation
- Include dist folder for GitHub installs

## [1.0.0] - 2025-12-11

### Added
- Initial release
- Thermostat control (temperature, HVAC mode, away mode)
- Temperature range support for auto/heat-cool mode
- Humidity sensor
- Automatic device discovery via NoLongerEvil API
- Support for both hosted (nolongerevil.com) and self-hosted servers
- Configurable polling interval (15-300 seconds)
