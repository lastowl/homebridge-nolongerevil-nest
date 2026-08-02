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
exports.NoLongerEvilAPI = exports.FAILURE_LOG_THRESHOLD = exports.REQUEST_TIMEOUT_MS = exports.RETRY_BASE_DELAY_MS = exports.MAX_RETRIES = exports.RETRYABLE_STATUS = void 0;
exports.httpError = httpError;
exports.isRetryable = isRetryable;
exports.backoffDelay = backoffDelay;
exports.sleep = sleep;
const https = __importStar(require("https"));
const http = __importStar(require("http"));
const HOSTED_API_URL = 'https://nolongerevil.com/api/v1';
// The hosted API occasionally returns transient upstream failures (Cloudflare-style
// 5xx, rate limiting, and intermittent 401s during those incidents). Idempotent GET
// reads are retried with backoff before an error is surfaced, which keeps both the
// polling path and the logs quiet through short-lived blips.
exports.RETRYABLE_STATUS = new Set([401, 408, 429, 500, 502, 503, 504]);
exports.MAX_RETRIES = 2;
exports.RETRY_BASE_DELAY_MS = 400;
exports.REQUEST_TIMEOUT_MS = 15000;
// Number of consecutive read failures logged quietly (debug) before one warn is emitted.
exports.FAILURE_LOG_THRESHOLD = 3;
function httpError(message, statusCode) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}
function isRetryable(error) {
    const status = error.statusCode;
    // Network/timeout errors carry no status code and are always treated as transient.
    return status === undefined || exports.RETRYABLE_STATUS.has(status);
}
function backoffDelay(attempt) {
    return exports.RETRY_BASE_DELAY_MS * Math.pow(2, attempt) + Math.floor(Math.random() * exports.RETRY_BASE_DELAY_MS);
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
class NoLongerEvilAPI {
    baseUrl;
    apiKey;
    log;
    isHttps;
    // Tracks consecutive read failures per device so transient blips stay quiet.
    readFailures = new Map();
    constructor(apiKey, log, serverUrl) {
        // Use custom server URL if provided, otherwise use hosted API
        this.baseUrl = serverUrl ? serverUrl.replace(/\/$/, '') : HOSTED_API_URL;
        this.apiKey = apiKey;
        this.log = log;
        this.isHttps = this.baseUrl.startsWith('https://');
        this.log.debug(`Using API URL: ${this.baseUrl}`);
    }
    get sourceLabel() {
        return this.baseUrl === HOSTED_API_URL ? 'hosted' : `hosted@${this.baseUrl}`;
    }
    get supportsLearningMode() {
        return false;
    }
    get supportsFanControl() {
        return false;
    }
    async request(method, path, body) {
        for (let attempt = 0;; attempt++) {
            try {
                return await this.requestOnce(method, path, body);
            }
            catch (error) {
                // Only retry idempotent reads, and only for transient failures.
                const canRetry = method === 'GET' && attempt < exports.MAX_RETRIES && isRetryable(error);
                if (!canRetry) {
                    throw error;
                }
                const wait = backoffDelay(attempt);
                this.log.debug(`Request ${method} ${path} failed (${error.message}); ` +
                    `retrying in ${wait}ms (attempt ${attempt + 2}/${exports.MAX_RETRIES + 1})`);
                await sleep(wait);
            }
        }
    }
    requestOnce(method, path, body) {
        return new Promise((resolve, reject) => {
            const fullUrl = `${this.baseUrl}${path}`;
            const url = new URL(fullUrl);
            this.log.debug(`API Request: ${method} ${fullUrl}`);
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
                    else if (res.statusCode === 429) {
                        reject(httpError('Rate limit exceeded. Please wait before making more requests.', 429));
                    }
                    else if (res.statusCode === 401) {
                        reject(httpError('Invalid API key. Please check your configuration.', 401));
                    }
                    else {
                        reject(httpError(`HTTP ${res.statusCode}: ${data}`, res.statusCode));
                    }
                });
            });
            req.setTimeout(exports.REQUEST_TIMEOUT_MS, () => {
                req.destroy(new Error(`Request timed out after ${exports.REQUEST_TIMEOUT_MS}ms`));
            });
            req.on('error', reject);
            if (body) {
                req.write(JSON.stringify(body));
            }
            req.end();
        });
    }
    async getDevices() {
        const response = await this.request('GET', '/devices');
        return response.devices;
    }
    async getDeviceStatus(deviceId) {
        return this.request('GET', `/thermostat/${deviceId}/status`);
    }
    async setTemperature(deviceId, temperature, mode) {
        await this.request('POST', `/thermostat/${deviceId}/temperature`, {
            value: temperature,
            mode,
            scale: 'C',
        });
    }
    async setTemperatureRange(deviceId, lowTemperature, highTemperature) {
        await this.request('POST', `/thermostat/${deviceId}/temperature/range`, {
            low: lowTemperature,
            high: highTemperature,
            scale: 'C',
        });
    }
    async setMode(deviceId, mode) {
        await this.request('POST', `/thermostat/${deviceId}/mode`, {
            mode,
        });
    }
    async setAwayMode(deviceId, away) {
        await this.request('POST', `/thermostat/${deviceId}/away`, {
            away,
        });
    }
    async getSchedule(deviceId) {
        try {
            const response = await this.request('GET', `/thermostat/${deviceId}/schedule`);
            return response.schedule;
        }
        catch (error) {
            this.log.error(`Failed to get schedule for ${deviceId}:`, error);
            return null;
        }
    }
    async setSchedule(deviceId, schedule) {
        await this.request('PUT', `/thermostat/${deviceId}/schedule`, { schedule });
    }
    async clearSchedule(deviceId) {
        const emptySchedule = {
            ver: 2,
            days: {},
            name: 'Cleared',
            schedule_mode: 'HEAT',
        };
        await this.request('PUT', `/thermostat/${deviceId}/schedule`, { schedule: emptySchedule });
    }
    async setLearningMode(deviceId, enabled) {
        void deviceId;
        void enabled;
        this.log.warn('Learning mode control is not available on the hosted API');
    }
    async setFanActive(deviceId, active) {
        void deviceId;
        void active;
        this.log.warn('Fan control is not available on the hosted API');
    }
    parseDeviceStatus(deviceId, response) {
        const serial = response.device.serial;
        const sharedKey = `shared.${serial}`;
        const deviceKey = `device.${serial}`;
        const shared = response.state[sharedKey]?.value || {};
        const device = response.state[deviceKey]?.value || {};
        // Temperature values are in Celsius from the API
        const currentTemp = shared['current_temperature'] ?? 20;
        const targetTemp = shared['target_temperature'] ?? 20;
        const targetTempLow = shared['target_temperature_low'] ?? 18;
        const targetTempHigh = shared['target_temperature_high'] ?? 24;
        // HVAC mode mapping
        const tempType = shared['target_temperature_type'] || 'off';
        let hvacMode = 'off';
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
        let hvacState = 'off';
        if (shared['hvac_heater_state'] === true) {
            hvacState = 'heating';
        }
        else if (shared['hvac_ac_state'] === true) {
            hvacState = 'cooling';
        }
        // Away mode (0 = home, 2 = away)
        const awayValue = shared['auto_away'];
        const awayMode = awayValue === 2;
        // Humidity
        const humidity = device['current_humidity'] ?? 50;
        // Device capabilities
        const canHeat = shared['can_heat'] ?? true;
        const canCool = shared['can_cool'] ?? false;
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
    async getThermostatStates() {
        try {
            const devices = await this.getDevices();
            const states = [];
            for (const device of devices) {
                try {
                    const status = await this.getDeviceStatus(device.id);
                    states.push(this.parseDeviceStatus(device.id, status));
                }
                catch (error) {
                    this.log.error(`Failed to get status for device ${device.id}:`, error);
                }
            }
            return states;
        }
        catch (error) {
            this.log.error('Failed to get thermostat states:', error);
            return [];
        }
    }
    async getThermostatState(deviceId) {
        try {
            const status = await this.getDeviceStatus(deviceId);
            const prevFailures = this.readFailures.get(deviceId) ?? 0;
            if (prevFailures > exports.FAILURE_LOG_THRESHOLD) {
                this.log.info(`Recovered state updates for ${deviceId} after ${prevFailures} failed attempts`);
            }
            this.readFailures.delete(deviceId);
            return this.parseDeviceStatus(deviceId, status);
        }
        catch (error) {
            const failures = (this.readFailures.get(deviceId) ?? 0) + 1;
            this.readFailures.set(deviceId, failures);
            const message = error instanceof Error ? error.message : String(error);
            // Cached state is retained on failure, so don't spam errors for short-lived
            // upstream blips. Log quietly at first, emit a single warn if it persists.
            if (failures <= exports.FAILURE_LOG_THRESHOLD) {
                this.log.debug(`Failed to get state for ${deviceId} (transient, attempt ${failures}): ${message}`);
            }
            else if (failures === exports.FAILURE_LOG_THRESHOLD + 1) {
                this.log.warn(`Repeated failures getting state for ${deviceId} — the upstream API appears to be down. ` +
                    `Keeping cached values and suppressing further messages until it recovers. Last error: ${message}`);
            }
            return null;
        }
    }
}
exports.NoLongerEvilAPI = NoLongerEvilAPI;
