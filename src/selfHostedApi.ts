import { Logger } from 'homebridge';
import * as https from 'https';
import * as http from 'http';
import { ThermostatApiClient, ThermostatState } from './api';

// Self-hosted API response types
interface SelfHostedDevice {
  serial: string;
  objects: string[];
}

interface SelfHostedStatusResponse {
  devices: string[];
  deviceState: {
    [serial: string]: {
      [objectKey: string]: {
        serial: string;
        object_key: string;
        object_revision: number;
        object_timestamp: number;
        value: Record<string, unknown>;
      };
    };
  };
}

interface CommandResponse {
  success: boolean;
  message: string;
  device: string;
  object: string;
  revision: number;
  timestamp: number;
}

export class SelfHostedAPI implements ThermostatApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly log: Logger;
  private readonly isHttps: boolean;

  constructor(apiKey: string, serverUrl: string, log: Logger) {
    this.baseUrl = serverUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.log = log;
    this.isHttps = this.baseUrl.startsWith('https://');

    this.log.debug(`Using self-hosted API URL: ${this.baseUrl}`);
  }

  get sourceLabel(): string {
    return `self-hosted@${this.baseUrl}`;
  }

  private request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const fullUrl = `${this.baseUrl}${path}`;
      const url = new URL(fullUrl);

      this.log.debug(`Self-Hosted API Request: ${method} ${fullUrl}`);

      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (this.isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
      };

      const client = this.isHttps ? https : http;

      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data) as T);
            } catch {
              resolve(data as unknown as T);
            }
          } else if (res.statusCode === 401) {
            reject(new Error('Invalid API key. Please check your self-hosted server configuration.'));
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', reject);

      if (body) {
        req.write(JSON.stringify(body));
      }

      req.end();
    });
  }

  async getThermostatStates(): Promise<ThermostatState[]> {
    try {
      const devices = await this.request<SelfHostedDevice[]>('GET', '/api/devices');
      const states: ThermostatState[] = [];

      for (const device of devices) {
        try {
          const state = await this.getThermostatState(device.serial);
          if (state) {
            states.push(state);
          }
        } catch (error) {
          this.log.error(`Failed to get status for device ${device.serial}:`, error);
        }
      }

      return states;
    } catch (error) {
      this.log.error('Failed to get thermostat states from self-hosted server:', error);
      return [];
    }
  }

  async getThermostatState(deviceId: string): Promise<ThermostatState | null> {
    // deviceId is the serial for self-hosted
    const serial = deviceId;
    try {
      const response = await this.request<SelfHostedStatusResponse>(
        'GET',
        `/status?serial=${encodeURIComponent(serial)}`,
      );
      return this.parseStatus(serial, response);
    } catch (error) {
      this.log.error(`Failed to get state for ${serial}:`, error);
      return null;
    }
  }

  async setTemperature(
    deviceId: string,
    temperature: number,
    mode: 'heat' | 'cool',
  ): Promise<void> {
    await this.request<CommandResponse>('POST', '/command', {
      serial: deviceId,
      action: 'temp',
      value: temperature,
      mode,
    });
  }

  async setTemperatureRange(
    deviceId: string,
    lowTemperature: number,
    highTemperature: number,
  ): Promise<void> {
    await this.request<CommandResponse>('POST', '/command', {
      serial: deviceId,
      action: 'temp',
      mode: 'range',
      target_temperature_low: lowTemperature,
      target_temperature_high: highTemperature,
    });
  }

  async setMode(deviceId: string, mode: 'off' | 'heat' | 'cool' | 'heat-cool'): Promise<void> {
    // Translate heat-cool -> range for the self-hosted API
    const apiMode = mode === 'heat-cool' ? 'range' : mode;
    await this.request<CommandResponse>('POST', '/command', {
      serial: deviceId,
      action: 'set',
      field: 'target_temperature_type',
      value: apiMode,
    });
  }

  async setAwayMode(deviceId: string, away: boolean): Promise<void> {
    await this.request<CommandResponse>('POST', '/command', {
      serial: deviceId,
      action: 'away',
      value: away,
    });
  }

  private parseStatus(serial: string, response: SelfHostedStatusResponse): ThermostatState | null {
    const deviceState = response.deviceState?.[serial];
    if (!deviceState) {
      this.log.warn(`No state data found for device ${serial}`);
      return null;
    }

    const sharedKey = `shared.${serial}`;
    const deviceKey = `device.${serial}`;

    const shared = deviceState[sharedKey]?.value || {};
    const device = deviceState[deviceKey]?.value || {};

    // Temperature values are in Celsius
    const currentTemp = (shared['current_temperature'] as number) ?? 20;
    const targetTemp = (shared['target_temperature'] as number) ?? 20;
    const targetTempLow = (shared['target_temperature_low'] as number) ?? 18;
    const targetTempHigh = (shared['target_temperature_high'] as number) ?? 24;

    // HVAC mode mapping (self-hosted uses 'range' instead of 'heat-cool')
    const tempType = (shared['target_temperature_type'] as string) || 'off';
    let hvacMode: ThermostatState['hvacMode'] = 'off';
    switch (tempType) {
      case 'heat':
        hvacMode = 'heat';
        break;
      case 'cool':
        hvacMode = 'cool';
        break;
      case 'range':
        hvacMode = 'heat-cool';
        break;
      case 'off':
      default:
        hvacMode = 'off';
    }

    // HVAC state (what's currently running)
    let hvacState: ThermostatState['hvacState'] = 'off';
    if (shared['hvac_heater_state'] === true) {
      hvacState = 'heating';
    } else if (shared['hvac_ac_state'] === true) {
      hvacState = 'cooling';
    }

    // Away mode (0 = home, 2 = away)
    const awayValue = shared['auto_away'] as number;
    const awayMode = awayValue === 2;

    // Humidity
    const humidity = (device['current_humidity'] as number) ?? 50;

    // Device capabilities
    const canHeat = (shared['can_heat'] as boolean) ?? true;
    const canCool = (shared['can_cool'] as boolean) ?? false;

    // Self-hosted doesn't provide a name in the device list
    const name = (shared['name'] as string) || `Nest ${serial.slice(-4)}`;

    return {
      deviceId: serial, // self-hosted uses serial as the device identifier
      serial,
      currentTemperature: currentTemp,
      targetTemperature: targetTemp,
      targetTemperatureLow: targetTempLow,
      targetTemperatureHigh: targetTempHigh,
      hvacMode,
      hvacState,
      humidity,
      awayMode,
      canHeat,
      canCool,
      name,
    };
  }
}
