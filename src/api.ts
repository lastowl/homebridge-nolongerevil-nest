import { Logger } from 'homebridge';
import * as https from 'https';
import * as http from 'http';

// API Response Types
export interface ApiDevice {
  id: string;
  serial: string;
  name: string | null;
  accessType: 'owner' | 'shared';
}

export interface DevicesResponse {
  devices: ApiDevice[];
}

export interface DeviceStatusResponse {
  device: {
    id: string;
    serial: string;
    name: string | null;
  };
  state: {
    [key: string]: {
      value: Record<string, unknown>;
    };
  };
}

export interface ThermostatState {
  deviceId: string;
  serial: string;
  currentTemperature: number;
  targetTemperature: number;
  targetTemperatureLow: number;
  targetTemperatureHigh: number;
  hvacMode: 'off' | 'heat' | 'cool' | 'heat-cool';
  hvacState: 'off' | 'heating' | 'cooling';
  humidity: number;
  awayMode: boolean;
  canHeat: boolean;
  canCool: boolean;
  name: string;
}

export interface ScheduleEntry {
  temp: number;
  time: number;
  type: 'HEAT' | 'COOL' | 'RANGE';
  entry_type: 'setpoint' | 'continuation';
}

export interface ThermostatSchedule {
  ver: number;
  days: Record<string, Record<string, ScheduleEntry>>;
  name: string;
  schedule_mode: 'HEAT' | 'COOL' | 'RANGE';
}

export interface ScheduleResponse {
  device: {
    id: string;
    serial: string;
    name: string | null;
  };
  schedule: ThermostatSchedule | null;
}

// Common interface for all API backends (hosted, self-hosted, etc.)
export interface ThermostatApiClient {
  getThermostatStates(): Promise<ThermostatState[]>;
  getThermostatState(deviceId: string): Promise<ThermostatState | null>;
  setTemperature(deviceId: string, temperature: number, mode: 'heat' | 'cool'): Promise<void>;
  setTemperatureRange(deviceId: string, lowTemperature: number, highTemperature: number): Promise<void>;
  setMode(deviceId: string, mode: 'off' | 'heat' | 'cool' | 'heat-cool'): Promise<void>;
  setAwayMode(deviceId: string, away: boolean): Promise<void>;
  getSchedule(deviceId: string): Promise<ThermostatSchedule | null>;
  setSchedule(deviceId: string, schedule: ThermostatSchedule): Promise<void>;
  clearSchedule(deviceId: string): Promise<void>;
  setLearningMode(deviceId: string, enabled: boolean): Promise<void>;
  readonly supportsLearningMode: boolean;
  readonly sourceLabel: string;
}

const HOSTED_API_URL = 'https://nolongerevil.com/api/v1';

export class NoLongerEvilAPI implements ThermostatApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly log: Logger;
  private readonly isHttps: boolean;

  constructor(apiKey: string, log: Logger, serverUrl?: string) {
    // Use custom server URL if provided, otherwise use hosted API
    this.baseUrl = serverUrl ? serverUrl.replace(/\/$/, '') : HOSTED_API_URL;
    this.apiKey = apiKey;
    this.log = log;
    this.isHttps = this.baseUrl.startsWith('https://');

    this.log.debug(`Using API URL: ${this.baseUrl}`);
  }

  get sourceLabel(): string {
    return this.baseUrl === HOSTED_API_URL ? 'hosted' : `hosted@${this.baseUrl}`;
  }

  get supportsLearningMode(): boolean {
    return false;
  }

  private request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const fullUrl = `${this.baseUrl}${path}`;
      const url = new URL(fullUrl);

      this.log.debug(`API Request: ${method} ${fullUrl}`);

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
          } else if (res.statusCode === 429) {
            reject(new Error('Rate limit exceeded. Please wait before making more requests.'));
          } else if (res.statusCode === 401) {
            reject(new Error('Invalid API key. Please check your configuration.'));
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

  async getDevices(): Promise<ApiDevice[]> {
    const response = await this.request<DevicesResponse>('GET', '/devices');
    return response.devices;
  }

  async getDeviceStatus(deviceId: string): Promise<DeviceStatusResponse> {
    return this.request<DeviceStatusResponse>('GET', `/thermostat/${deviceId}/status`);
  }

  async setTemperature(
    deviceId: string,
    temperature: number,
    mode: 'heat' | 'cool',
  ): Promise<void> {
    await this.request('POST', `/thermostat/${deviceId}/temperature`, {
      value: temperature,
      mode,
      scale: 'C',
    });
  }

  async setTemperatureRange(
    deviceId: string,
    lowTemperature: number,
    highTemperature: number,
  ): Promise<void> {
    await this.request('POST', `/thermostat/${deviceId}/temperature/range`, {
      low: lowTemperature,
      high: highTemperature,
      scale: 'C',
    });
  }

  async setMode(deviceId: string, mode: 'off' | 'heat' | 'cool' | 'heat-cool'): Promise<void> {
    await this.request('POST', `/thermostat/${deviceId}/mode`, {
      mode,
    });
  }

  async setAwayMode(deviceId: string, away: boolean): Promise<void> {
    await this.request('POST', `/thermostat/${deviceId}/away`, {
      away,
    });
  }

  async getSchedule(deviceId: string): Promise<ThermostatSchedule | null> {
    try {
      const response = await this.request<ScheduleResponse>('GET', `/thermostat/${deviceId}/schedule`);
      return response.schedule;
    } catch (error) {
      this.log.error(`Failed to get schedule for ${deviceId}:`, error);
      return null;
    }
  }

  async setSchedule(deviceId: string, schedule: ThermostatSchedule): Promise<void> {
    await this.request('PUT', `/thermostat/${deviceId}/schedule`, { schedule });
  }

  async clearSchedule(deviceId: string): Promise<void> {
    const emptySchedule: ThermostatSchedule = {
      ver: 2,
      days: {},
      name: 'Cleared',
      schedule_mode: 'HEAT',
    };
    await this.request('PUT', `/thermostat/${deviceId}/schedule`, { schedule: emptySchedule });
  }

  async setLearningMode(_deviceId: string, _enabled: boolean): Promise<void> {
    this.log.warn('Learning mode control is not available on the hosted API');
  }

  parseDeviceStatus(deviceId: string, response: DeviceStatusResponse): ThermostatState {
    const serial = response.device.serial;
    const sharedKey = `shared.${serial}`;
    const deviceKey = `device.${serial}`;

    const shared = response.state[sharedKey]?.value || {};
    const device = response.state[deviceKey]?.value || {};

    // Temperature values are in Celsius from the API
    const currentTemp = (shared['current_temperature'] as number) ?? 20;
    const targetTemp = (shared['target_temperature'] as number) ?? 20;
    const targetTempLow = (shared['target_temperature_low'] as number) ?? 18;
    const targetTempHigh = (shared['target_temperature_high'] as number) ?? 24;

    // HVAC mode mapping
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

    // Device name
    const name = response.device.name || `Nest ${serial.slice(-4)}`;

    return {
      deviceId,
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

  async getThermostatStates(): Promise<ThermostatState[]> {
    try {
      const devices = await this.getDevices();
      const states: ThermostatState[] = [];

      for (const device of devices) {
        try {
          const status = await this.getDeviceStatus(device.id);
          states.push(this.parseDeviceStatus(device.id, status));
        } catch (error) {
          this.log.error(`Failed to get status for device ${device.id}:`, error);
        }
      }

      return states;
    } catch (error) {
      this.log.error('Failed to get thermostat states:', error);
      return [];
    }
  }

  async getThermostatState(deviceId: string): Promise<ThermostatState | null> {
    try {
      const status = await this.getDeviceStatus(deviceId);
      return this.parseDeviceStatus(deviceId, status);
    } catch (error) {
      this.log.error(`Failed to get state for ${deviceId}:`, error);
      return null;
    }
  }
}
