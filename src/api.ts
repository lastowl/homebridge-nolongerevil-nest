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
  hasFan: boolean;
  fanActive: boolean;
  fanRunning: boolean;
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
  setFanActive(deviceId: string, active: boolean): Promise<void>;
  readonly supportsLearningMode: boolean;
  readonly supportsFanControl: boolean;
  readonly sourceLabel: string;
}

const HOSTED_API_URL = 'https://nolongerevil.com/api/v1';

// The hosted API occasionally returns transient upstream failures (Cloudflare-style
// 5xx, rate limiting, and intermittent 401s during those incidents). Idempotent GET
// reads are retried with backoff before an error is surfaced, which keeps both the
// polling path and the logs quiet through short-lived blips.
export const RETRYABLE_STATUS = new Set([401, 408, 429, 500, 502, 503, 504]);
export const MAX_RETRIES = 2;
export const RETRY_BASE_DELAY_MS = 400;
export const REQUEST_TIMEOUT_MS = 15000;
// Number of consecutive read failures logged quietly (debug) before one warn is emitted.
export const FAILURE_LOG_THRESHOLD = 3;

export type HttpError = Error & { statusCode?: number };

export function httpError(message: string, statusCode?: number): HttpError {
  const err = new Error(message) as HttpError;
  err.statusCode = statusCode;
  return err;
}

export function isRetryable(error: unknown): boolean {
  const status = (error as HttpError).statusCode;
  // Network/timeout errors carry no status code and are always treated as transient.
  return status === undefined || RETRYABLE_STATUS.has(status);
}

export function backoffDelay(attempt: number): number {
  return RETRY_BASE_DELAY_MS * Math.pow(2, attempt) + Math.floor(Math.random() * RETRY_BASE_DELAY_MS);
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class NoLongerEvilAPI implements ThermostatApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly log: Logger;
  private readonly isHttps: boolean;
  // Tracks consecutive read failures per device so transient blips stay quiet.
  private readonly readFailures = new Map<string, number>();

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

  get supportsFanControl(): boolean {
    return false;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.requestOnce<T>(method, path, body);
      } catch (error) {
        // Only retry idempotent reads, and only for transient failures.
        const canRetry = method === 'GET' && attempt < MAX_RETRIES && isRetryable(error);
        if (!canRetry) {
          throw error;
        }
        const wait = backoffDelay(attempt);
        this.log.debug(
          `Request ${method} ${path} failed (${(error as Error).message}); ` +
          `retrying in ${wait}ms (attempt ${attempt + 2}/${MAX_RETRIES + 1})`,
        );
        await sleep(wait);
      }
    }
  }

  private requestOnce<T>(
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
            reject(httpError('Rate limit exceeded. Please wait before making more requests.', 429));
          } else if (res.statusCode === 401) {
            reject(httpError('Invalid API key. Please check your configuration.', 401));
          } else {
            reject(httpError(`HTTP ${res.statusCode}: ${data}`, res.statusCode));
          }
        });
      });

      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`));
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

  async setLearningMode(deviceId: string, enabled: boolean): Promise<void> {
    void deviceId;
    void enabled;
    this.log.warn('Learning mode control is not available on the hosted API');
  }

  async setFanActive(deviceId: string, active: boolean): Promise<void> {
    void deviceId;
    void active;
    this.log.warn('Fan control is not available on the hosted API');
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
      hasFan: false,
      fanActive: false,
      fanRunning: false,
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
      const prevFailures = this.readFailures.get(deviceId) ?? 0;
      if (prevFailures > FAILURE_LOG_THRESHOLD) {
        this.log.info(`Recovered state updates for ${deviceId} after ${prevFailures} failed attempts`);
      }
      this.readFailures.delete(deviceId);
      return this.parseDeviceStatus(deviceId, status);
    } catch (error) {
      const failures = (this.readFailures.get(deviceId) ?? 0) + 1;
      this.readFailures.set(deviceId, failures);
      const message = error instanceof Error ? error.message : String(error);

      // Cached state is retained on failure, so don't spam errors for short-lived
      // upstream blips. Log quietly at first, emit a single warn if it persists.
      if (failures <= FAILURE_LOG_THRESHOLD) {
        this.log.debug(`Failed to get state for ${deviceId} (transient, attempt ${failures}): ${message}`);
      } else if (failures === FAILURE_LOG_THRESHOLD + 1) {
        this.log.warn(
          `Repeated failures getting state for ${deviceId} — the upstream API appears to be down. ` +
          `Keeping cached values and suppressing further messages until it recovers. Last error: ${message}`,
        );
      }
      return null;
    }
  }
}
