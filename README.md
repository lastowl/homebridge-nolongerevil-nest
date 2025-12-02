# Homebridge NoLongerEvil Nest

A [Homebridge](https://homebridge.io) plugin for controlling Nest Gen 1 & 2 thermostats using the [NoLongerEvil](https://nolongerevil.com) API.

> **Looking for MQTT support?** If you prefer to use MQTT instead of the REST API, check out [homebridge-nolongerevil-thermostat](https://github.com/will-tm/homebridge-nolongerevil-thermostat).

## What is NoLongerEvil?

NoLongerEvil is a project that revives bricked or abandoned Nest Gen 1 & 2 thermostats with custom firmware, allowing them to work independently of Google's servers. This plugin connects those thermostats to HomeKit via Homebridge.

## Features

- Control Nest thermostats from Apple Home app
- Set target temperature
- Switch between heating, cooling, auto, and off modes
- Temperature range support for auto mode
- Humidity sensor
- Automatic device discovery
- Works with both hosted and self-hosted NoLongerEvil servers

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

### Via GitHub

```bash
npm install -g github:lastowl/homebridge-nolongerevil-nest
```

## Configuration

### Using Homebridge UI

1. Go to **Plugins** → **NoLongerEvil Nest** → **Settings**
2. Enter your API key
3. (Optional) Expand **Advanced Settings** to configure server URL for self-hosted installations
4. Save and restart Homebridge

### Manual Configuration

Add the following to your Homebridge `config.json`:

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

### Configuration Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `platform` | Yes | - | Must be `NoLongerEvilNest` |
| `name` | Yes | `NoLongerEvil Nest` | Display name for the plugin |
| `apiKey` | Yes | - | Your NoLongerEvil API key |
| `serverUrl` | No | - | URL for self-hosted server (e.g., `http://192.168.1.100:3000/api/v1`) |
| `pollInterval` | No | `30` | How often to refresh thermostat state (15-300 seconds) |

### Self-Hosted Server

If you're running your own NoLongerEvil server instead of using the hosted service, add the `serverUrl` option:

```json
{
  "platforms": [
    {
      "platform": "NoLongerEvilNest",
      "name": "NoLongerEvil Nest",
      "apiKey": "nle_your_api_key_here",
      "serverUrl": "http://192.168.1.100:3000/api/v1"
    }
  ]
}
```

## Getting an API Key

1. Go to [nolongerevil.com](https://nolongerevil.com) and sign in
2. Navigate to **Settings** → **API Keys**
3. Create a new API key with both `read` and `write` scopes
4. Copy the key (it starts with `nle_`)

## HomeKit Features

Once configured, each thermostat will appear in HomeKit with:

- **Thermostat**: Control temperature and mode
  - Current temperature
  - Target temperature
  - Heating/Cooling mode (Off, Heat, Cool, Auto)
  - Heating/Cooling thresholds for Auto mode
- **Humidity Sensor**: Current relative humidity

## Troubleshooting

### "No thermostats found"

- Ensure your thermostat is registered with your NoLongerEvil account
- Check that your API key has `read` scope
- Verify the thermostat is online in the NoLongerEvil dashboard

### "Invalid API key"

- Double-check that you copied the entire API key
- Ensure the key hasn't been revoked in your account settings

### "Rate limit exceeded"

- The hosted API has a limit of 20 requests per minute
- Try increasing `pollInterval` to reduce request frequency

### Connection errors with self-hosted server

- Verify the server URL is correct and accessible
- Check that the URL includes the `/api/v1` path
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
