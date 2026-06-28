import { Logger } from 'homebridge';
import * as https from 'https';
import * as http from 'http';
import { ThermostatApiClient, ThermostatState, ThermostatSchedule } from './api';

// Self-hosted API response types (flat device model from the production
// NoLongerEvil-SelfHosted server).
interface SelfHostedDevice {
  serial: string;
  name?: string | null;
  mode?: string;
  current_temperature?: number;
  target_temperature?: number;
  target_temperature_low?: number;
  target_temperature_high?: number;
  humidity?: number;
  away?: boolean;
  hvac?: {
    heater?: boolean;
    ac?: boolean;
  };
  capabilities?: {
    can_heat?: boolean;
    can_cool?: boolean;
  };
}

interface DevicesResponse {
  devices?: SelfHostedDevice[];
}

interface ScheduleResponse {
  schedule?: ThermostatSchedule | null;
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

  get supportsLearningMode(): boolean {
    return true;
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
      const response = await this.request<DevicesResponse>('GET', '/api/devices');
      const devices = response.devices || [];
      return devices
        .map(device => this.parseDevice(device))
        .filter((state): state is ThermostatState => state !== null);
    } catch (error) {
      this.log.error('Failed to get thermostat states from self-hosted server:', error);
      return [];
    }
  }

  async getThermostatState(deviceId: string): Promise<ThermostatState | null> {
    try {
      const response = await this.request<DevicesResponse>('GET', '/api/devices');
      const devices = response.devices || [];
      const device = devices.find(d => d.serial === deviceId);
      if (!device) {
        this.log.warn(`Device ${deviceId} not found during refresh`);
        return null;
      }
      return this.parseDevice(device);
    } catch (error) {
      this.log.error(`Failed to refresh device ${deviceId}:`, error);
      return null;
    }
  }

  private parseDevice(device: SelfHostedDevice): ThermostatState | null {
    if (!device || !device.serial) {
      return null;
    }

    const serial = device.serial;
    const currentTemp = device.current_temperature ?? 20;
    const targetTemp = Math.max(device.target_temperature ?? 20, 10);
    const targetTempLow = Math.max(device.target_temperature_low ?? 18, 10);
    const targetTempHigh = Math.max(device.target_temperature_high ?? 24, 10);

    // HVAC Mode mapping
    let hvacMode: ThermostatState['hvacMode'] = 'off';
    switch (device.mode) {
      case 'heat':
        hvacMode = 'heat';
        break;
      case 'cool':
        hvacMode = 'cool';
        break;
      case 'range':
      case 'heat-cool':
        hvacMode = 'heat-cool';
        break;
      default:
        hvacMode = 'off';
    }

    // HVAC state (what's currently running)
    let hvacState: ThermostatState['hvacState'] = 'off';
    if (device.hvac?.heater) {
      hvacState = 'heating';
    } else if (device.hvac?.ac) {
      hvacState = 'cooling';
    }

    const humidity = device.humidity ?? 50;
    const awayMode = device.away ?? false;
    const canHeat = device.capabilities?.can_heat ?? true;
    const canCool = device.capabilities?.can_cool ?? false;
    const name = device.name || `Nest ${serial.slice(-4)}`;

    return {
      deviceId: serial,
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

  async setTemperature(deviceId: string, temperature: number, _mode: 'heat' | 'cool'): Promise<void> {
    await this.request('POST', '/command', {
      serial: deviceId,
      command: 'set_temperature',
      value: temperature,
    });
  }

  async setTemperatureRange(deviceId: string, lowTemperature: number, highTemperature: number): Promise<void> {
    await this.request('POST', '/command', {
      serial: deviceId,
      command: 'set_temperature',
      value: {
        low: lowTemperature,
        high: highTemperature,
      },
    });
  }

  async setMode(deviceId: string, mode: 'off' | 'heat' | 'cool' | 'heat-cool'): Promise<void> {
    await this.request('POST', '/command', {
      serial: deviceId,
      command: 'set_mode',
      value: mode,
    });
  }

  async setAwayMode(deviceId: string, away: boolean): Promise<void> {
    await this.request('POST', '/command', {
      serial: deviceId,
      command: 'set_away',
      value: away,
    });
  }

  async getSchedule(deviceId: string): Promise<ThermostatSchedule | null> {
    try {
      const response = await this.request<ScheduleResponse>('GET', `/api/schedule?serial=${encodeURIComponent(deviceId)}`);
      return response.schedule ?? null;
    } catch (error) {
      this.log.error(`Failed to get schedule for ${deviceId}:`, error);
      return null;
    }
  }

  async setSchedule(deviceId: string, schedule: ThermostatSchedule): Promise<void> {
    await this.request('POST', '/command', {
      serial: deviceId,
      command: 'set_schedule',
      value: schedule,
    });
  }

  async clearSchedule(deviceId: string): Promise<void> {
    const emptySchedule: ThermostatSchedule = {
      ver: 2,
      days: {},
      name: 'Cleared',
      schedule_mode: 'HEAT',
    };
    await this.request('POST', '/command', {
      serial: deviceId,
      command: 'set_schedule',
      value: emptySchedule,
    });
  }

  async setLearningMode(deviceId: string, enabled: boolean): Promise<void> {
    try {
      await this.request('POST', '/command', {
        serial: deviceId,
        command: 'set_device_setting',
        value: { learning_mode: enabled },
      });
    } catch (error) {
      this.log.debug('Failed to set learning mode:', error);
    }
  }
}
