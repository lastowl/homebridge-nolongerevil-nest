import { Logger } from 'homebridge';
import * as https from 'https';
import * as http from 'http';
import {
  ThermostatApiClient,
  ThermostatState,
  ThermostatSchedule,
  MAX_RETRIES,
  REQUEST_TIMEOUT_MS,
  FAILURE_LOG_THRESHOLD,
  httpError,
  isRetryable,
  backoffDelay,
  sleep,
} from './api';

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
    fan?: boolean;
  };
  capabilities?: {
    can_heat?: boolean;
    can_cool?: boolean;
    has_fan?: boolean;
  };
  fan_timer_active?: boolean;
  fan_timer_timeout?: number;
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
  // Tracks consecutive read failures per device so transient blips stay quiet.
  private readonly readFailures = new Map<string, number>();

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

  get supportsFanControl(): boolean {
    return true;
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
            reject(httpError('Invalid API key. Please check your self-hosted server configuration.', 401));
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
      const prevFailures = this.readFailures.get(deviceId) ?? 0;
      if (prevFailures > FAILURE_LOG_THRESHOLD) {
        this.log.info(`Recovered state updates for ${deviceId} after ${prevFailures} failed attempts`);
      }
      this.readFailures.delete(deviceId);

      const devices = response.devices || [];
      const device = devices.find(d => d.serial === deviceId);
      if (!device) {
        this.log.warn(`Device ${deviceId} not found during refresh`);
        return null;
      }
      return this.parseDevice(device);
    } catch (error) {
      const failures = (this.readFailures.get(deviceId) ?? 0) + 1;
      this.readFailures.set(deviceId, failures);
      const message = error instanceof Error ? error.message : String(error);

      // Cached state is retained on failure, so don't spam errors for short-lived
      // upstream blips. Log quietly at first, emit a single warn if it persists.
      if (failures <= FAILURE_LOG_THRESHOLD) {
        this.log.debug(`Failed to refresh device ${deviceId} (transient, attempt ${failures}): ${message}`);
      } else if (failures === FAILURE_LOG_THRESHOLD + 1) {
        this.log.warn(
          `Repeated failures refreshing device ${deviceId} — the server appears to be unreachable. ` +
          `Keeping cached values and suppressing further messages until it recovers. Last error: ${message}`,
        );
      }
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
    const hasFan = device.capabilities?.has_fan ?? false;
    const fanActive = device.fan_timer_active === true
      || (device.fan_timer_timeout ?? 0) > Math.floor(Date.now() / 1000);
    const fanRunning = device.hvac?.fan ?? false;
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
      hasFan,
      fanActive,
      fanRunning,
      name,
    };
  }

  async setTemperature(deviceId: string, temperature: number, mode: 'heat' | 'cool'): Promise<void> {
    void mode;
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

  async setFanActive(deviceId: string, active: boolean): Promise<void> {
    await this.request('POST', '/command', {
      serial: deviceId,
      command: 'set_fan',
      value: active ? 'on' : 'auto',
    });
  }
}
