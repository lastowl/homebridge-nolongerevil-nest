"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SelfHostedAPI = void 0;
const https = __importStar(require("https"));
const http = __importStar(require("http"));
const api_1 = require("./api");
class SelfHostedAPI {
    baseUrl;
    apiKey;
    log;
    isHttps;
    // Tracks consecutive read failures per device so transient blips stay quiet.
    readFailures = new Map();
    constructor(apiKey, serverUrl, log) {
        this.baseUrl = serverUrl.replace(/\/$/, '');
        this.apiKey = apiKey;
        this.log = log;
        this.isHttps = this.baseUrl.startsWith('https://');
        this.log.debug(`Using self-hosted API URL: ${this.baseUrl}`);
    }
    get sourceLabel() {
        return `self-hosted@${this.baseUrl}`;
    }
    get supportsLearningMode() {
        return true;
    }
    get supportsFanControl() {
        return true;
    }
    async request(method, path, body) {
        for (let attempt = 0;; attempt++) {
            try {
                return await this.requestOnce(method, path, body);
            }
            catch (error) {
                // Only retry idempotent reads, and only for transient failures.
                const canRetry = method === 'GET' && attempt < api_1.MAX_RETRIES && (0, api_1.isRetryable)(error);
                if (!canRetry) {
                    throw error;
                }
                const wait = (0, api_1.backoffDelay)(attempt);
                this.log.debug(`Request ${method} ${path} failed (${error.message}); ` +
                    `retrying in ${wait}ms (attempt ${attempt + 2}/${api_1.MAX_RETRIES + 1})`);
                await (0, api_1.sleep)(wait);
            }
        }
    }
    requestOnce(method, path, body) {
        return new Promise((resolve, reject) => {
            const fullUrl = `${this.baseUrl}${path}`;
            const url = new URL(fullUrl);
            this.log.debug(`Self-Hosted API Request: ${method} ${fullUrl}`);
            const options = {
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
                            resolve(JSON.parse(data));
                        }
                        catch {
                            resolve(data);
                        }
                    }
                    else if (res.statusCode === 401) {
                        reject((0, api_1.httpError)('Invalid API key. Please check your self-hosted server configuration.', 401));
                    }
                    else {
                        reject((0, api_1.httpError)(`HTTP ${res.statusCode}: ${data}`, res.statusCode));
                    }
                });
            });
            req.setTimeout(api_1.REQUEST_TIMEOUT_MS, () => {
                req.destroy(new Error(`Request timed out after ${api_1.REQUEST_TIMEOUT_MS}ms`));
            });
            req.on('error', reject);
            if (body) {
                req.write(JSON.stringify(body));
            }
            req.end();
        });
    }
    async getThermostatStates() {
        try {
            const response = await this.request('GET', '/api/devices');
            const devices = response.devices || [];
            return devices
                .map(device => this.parseDevice(device))
                .filter((state) => state !== null);
        }
        catch (error) {
            this.log.error('Failed to get thermostat states from self-hosted server:', error);
            return [];
        }
    }
    async getThermostatState(deviceId) {
        try {
            const response = await this.request('GET', '/api/devices');
            const prevFailures = this.readFailures.get(deviceId) ?? 0;
            if (prevFailures > api_1.FAILURE_LOG_THRESHOLD) {
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
        }
        catch (error) {
            const failures = (this.readFailures.get(deviceId) ?? 0) + 1;
            this.readFailures.set(deviceId, failures);
            const message = error instanceof Error ? error.message : String(error);
            // Cached state is retained on failure, so don't spam errors for short-lived
            // upstream blips. Log quietly at first, emit a single warn if it persists.
            if (failures <= api_1.FAILURE_LOG_THRESHOLD) {
                this.log.debug(`Failed to refresh device ${deviceId} (transient, attempt ${failures}): ${message}`);
            }
            else if (failures === api_1.FAILURE_LOG_THRESHOLD + 1) {
                this.log.warn(`Repeated failures refreshing device ${deviceId} — the server appears to be unreachable. ` +
                    `Keeping cached values and suppressing further messages until it recovers. Last error: ${message}`);
            }
            return null;
        }
    }
    parseDevice(device) {
        if (!device || !device.serial) {
            return null;
        }
        const serial = device.serial;
        const currentTemp = device.current_temperature ?? 20;
        const targetTemp = Math.max(device.target_temperature ?? 20, 10);
        const targetTempLow = Math.max(device.target_temperature_low ?? 18, 10);
        const targetTempHigh = Math.max(device.target_temperature_high ?? 24, 10);
        // HVAC Mode mapping
        let hvacMode = 'off';
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
        let hvacState = 'off';
        if (device.hvac?.heater) {
            hvacState = 'heating';
        }
        else if (device.hvac?.ac) {
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
    async setTemperature(deviceId, temperature, mode) {
        void mode;
        await this.request('POST', '/command', {
            serial: deviceId,
            command: 'set_temperature',
            value: temperature,
        });
    }
    async setTemperatureRange(deviceId, lowTemperature, highTemperature) {
        await this.request('POST', '/command', {
            serial: deviceId,
            command: 'set_temperature',
            value: {
                low: lowTemperature,
                high: highTemperature,
            },
        });
    }
    async setMode(deviceId, mode) {
        await this.request('POST', '/command', {
            serial: deviceId,
            command: 'set_mode',
            value: mode,
        });
    }
    async setAwayMode(deviceId, away) {
        await this.request('POST', '/command', {
            serial: deviceId,
            command: 'set_away',
            value: away,
        });
    }
    async getSchedule(deviceId) {
        try {
            const response = await this.request('GET', `/api/schedule?serial=${encodeURIComponent(deviceId)}`);
            return response.schedule ?? null;
        }
        catch (error) {
            this.log.error(`Failed to get schedule for ${deviceId}:`, error);
            return null;
        }
    }
    async setSchedule(deviceId, schedule) {
        await this.request('POST', '/command', {
            serial: deviceId,
            command: 'set_schedule',
            value: schedule,
        });
    }
    async clearSchedule(deviceId) {
        const emptySchedule = {
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
    async setLearningMode(deviceId, enabled) {
        try {
            await this.request('POST', '/command', {
                serial: deviceId,
                command: 'set_device_setting',
                value: { learning_mode: enabled },
            });
        }
        catch (error) {
            this.log.debug('Failed to set learning mode:', error);
        }
    }
    async setFanActive(deviceId, active) {
        await this.request('POST', '/command', {
            serial: deviceId,
            command: 'set_fan',
            value: active ? 'on' : 'auto',
        });
    }
}
exports.SelfHostedAPI = SelfHostedAPI;
