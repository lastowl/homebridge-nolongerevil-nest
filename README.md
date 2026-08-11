# Homebridge NoLongerEvil Nest

A [Homebridge](https://homebridge.io) plugin for controlling Nest Gen 1 & 2 thermostats using the [NoLongerEvil](https://nolongerevil.com) API.

> **Looking for MQTT support?** If you prefer to use MQTT instead of the REST API, check out [homebridge-nolongerevil-thermostat](https://github.com/will-tm/homebridge-nolongerevil-thermostat).

## What is NoLongerEvil?

NoLongerEvil is a project that revives bricked or abandoned Nest Gen 1 & 2 thermostats with custom firmware, allowing them to work independently of Google's servers. This plugin connects those thermostats to HomeKit via Homebridge.

## Features

- **Thermostat Control** — Set target temperature, switch between heating, cooling, auto, and off modes
- **Temperature Range** — Set heating and cooling thresholds for auto mode
- **Humidity Sensor** — View current relative humidity
- **Fan Control** — Start a timed fan cycle or return the fan to automatic control (self-hosted thermostats with fan capability)
- **Smart Schedule Switch** — Enable or disable the Nest's built-in schedule from HomeKit
- **Schedule Editor** — View and edit the weekly thermostat schedule from the Homebridge UI
- **Learning Mode Control** — Automatically disables the Nest's auto-schedule learning when the smart schedule is turned off (self-hosted)
- **Multi-Source Support** — Connect to multiple hosted and self-hosted NoLongerEvil servers simultaneously
- **Automatic Device Discovery** — Finds all thermostats across configured API sources

## Requirements

- A Nest Gen 1 or Gen 2 thermostat flashed with NoLongerEvil firmware
- A NoLongerEvil account with API key (get one at [nolongerevil.com](https://nolongerevil.com))
- Homebridge v1.6.0 or later

## Installation

### Via Homebridge UI (Recommended)

1. Open Homebridge UI
2. Go to **Plugins**
3. Search for `homebridge-nolongerevil-nest`
4. Click **Install**

### Via npm

```bash
npm install -g homebridge-nolongerevil-nest
```

## Configuration

### Using Homebridge UI

1. Go to **Plugins** → **NoLongerEvil Nest** → **Settings**
2. Enter your API key
3. (Optional) Set server URL for self-hosted installations
4. (Optional) Configure multiple servers under the **Multiple Servers** section
5. Save and restart Homebridge

### Manual Configuration

#### Simple Setup (Single API Source)

```json
{
  "platforms": [
    {
      "platform": "NoLongerEvilNest",
      "name": "NoLongerEvil Nest",
      "apiKey": "nle_your_api_key_here"
    }
  ]
}
```

#### Self-Hosted Server

```json
{
  "platforms": [
    {
      "platform": "NoLongerEvilNest",
      "name": "NoLongerEvil Nest",
      "apiKey": "nlapi_your_api_key_here",
      "serverUrl": "http://192.168.1.100:8081"
    }
  ]
}
```

#### Multiple Servers

```json
{
  "platforms": [
    {
      "platform": "NoLongerEvilNest",
      "name": "NoLongerEvil Nest",
      "servers": [
        {
          "name": "Hosted",
          "apiKey": "nle_your_hosted_key"
        },
        {
          "name": "My Self-Hosted Server",
          "apiKey": "nlapi_your_selfhosted_key",
          "serverUrl": "http://192.168.1.100:8081"
        }
      ]
    }
  ]
}
```

### Configuration Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `platform` | Yes | — | Must be `NoLongerEvilNest` |
| `name` | Yes | `NoLongerEvil Nest` | Display name for the plugin |
| `apiKey` | Yes* | — | API key for single-source setup |
| `serverUrl` | No | — | Server URL for self-hosted (leave empty for hosted) |
| `servers` | No | — | Array of server configs for multi-source setup |
| `pollInterval` | No | `30` | How often to refresh thermostat state (15–300 seconds) |
| `enableScheduleSwitch` | No | `true` | Show the Smart Schedule on/off switch in HomeKit |

*Required if `servers` is not configured.

## HomeKit Accessories

Each thermostat appears in HomeKit with:

- **Thermostat** — Current temperature, target temperature, HVAC mode (Off / Heat / Cool / Auto), and heating/cooling thresholds for auto mode
- **Humidity Sensor** — Current relative humidity
- **Fan** — Start a timed fan cycle, return to automatic control, and view whether the blower is currently running (self-hosted only)
- **Smart Schedule Switch** — Toggle the Nest's built-in schedule on or off

### Fan Control

For self-hosted NLE servers, thermostats that report `has_fan` expose a separate
HomeKit fan service. Turning it on starts NLE's configured fan timer (60 minutes
by default); turning it off returns the thermostat to automatic fan control.
HomeKit also reports the blower's current running state independently from the
timer setting.

### Smart Schedule Switch

The Smart Schedule switch controls whether the Nest thermostat follows its programmed schedule:

- **ON** — The thermostat's schedule is active and drives temperature changes automatically
- **OFF** — The schedule is cleared and the thermostat stays at whatever temperature you set manually

When turned off:
- The current schedule is cached locally so it can be restored later
- On self-hosted servers, the Nest's learning mode is also disabled to prevent the thermostat from auto-creating new schedule entries
- On the hosted API, the plugin monitors and re-clears the schedule during polling if learning mode recreates entries

This is useful when you want to use **HomeKit automations** instead of the Nest's built-in schedule. Turn the smart schedule off, then create time-based automations in the Home app (e.g., "At 7:00 AM, set thermostat to 22°C").

## Schedule Editor

The plugin includes a visual schedule editor accessible from the **Homebridge UI**:

1. Go to **Plugins** → **NoLongerEvil Nest** → **Settings** (click the wrench icon)
2. The schedule editor shows a 24-hour × 7-day grid with temperature setpoints
3. Click any day to view, add, or remove individual entries
4. Change the schedule mode (Heat / Cool / Range)
5. Copy a day's schedule to all weekdays
6. Click **Save Schedule** to push changes to the thermostat

> **Note:** The schedule editor requires the hosted NoLongerEvil API. Self-hosted servers do not currently support schedule management via the API.

## Getting an API Key

1. Go to [nolongerevil.com](https://nolongerevil.com) and sign in
2. Navigate to **Settings** → **API Keys**
3. Create a new API key with both `read` and `write` scopes
4. Copy the key (it starts with `nle_`)

## Troubleshooting

### "No thermostats found"

- Ensure your thermostat is registered with your NoLongerEvil account
- Check that your API key has `read` scope
- Verify the thermostat is online in the NoLongerEvil dashboard

### "Invalid API key"

- Double-check that you copied the entire API key
- Ensure the key hasn't been revoked in your account settings
- Verify the key has both `read` and `write` scopes

### "Rate limit exceeded"

- The hosted API has a limit of 20 requests per minute
- Try increasing `pollInterval` to reduce request frequency

### Schedule keeps recreating entries

- This is caused by the Nest's learning mode auto-creating schedule entries based on manual temperature adjustments
- Use the **Smart Schedule switch** to disable the schedule — on self-hosted servers this also disables learning mode
- On the hosted API, the plugin will automatically re-clear recreated entries during polling
- See [NoLongerEvil issue #152](https://github.com/codykociemba/NoLongerEvil-Thermostat/issues/152) for more details

### Connection errors with self-hosted server

- Verify the server URL is correct and accessible from the Homebridge host
- Ensure the server is running and the port is open

## Links

- [NoLongerEvil Website](https://nolongerevil.com)
- [NoLongerEvil API Documentation](https://docs.nolongerevil.com/api-reference/introduction)
- [NoLongerEvil Thermostat Project](https://github.com/codykociemba/NoLongerEvil-Thermostat)
- [Homebridge](https://homebridge.io)

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on [GitHub](https://github.com/lastowl/homebridge-nolongerevil-nest).
