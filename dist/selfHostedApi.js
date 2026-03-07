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
class SelfHostedAPI {
    baseUrl;
    apiKey;
    log;
    isHttps;
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
    request(method, path, body) {
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
                        reject(new Error('Invalid API key. Please check your self-hosted server configuration.'));
                    }
                    else {
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
    async getThermostatStates() {
        try {
            const devices = await this.request('GET', '/api/devices');
            const states = [];
            for (const device of devices) {
                try {
                    const state = await this.getThermostatState(device.serial);
                    if (state) {
                        states.push(state);
                    }
                }
                catch (error) {
                    this.log.error(`Failed to get status for device ${device.serial}:`, error);
                }
            }
            return states;
        }
        catch (error) {
            this.log.error('Failed to get thermostat states from self-hosted server:', error);
            return [];
        }
    }
    async getThermostatState(deviceId) {
        // deviceId is the serial for self-hosted
        const serial = deviceId;
        try {
            const response = await this.request('GET', `/status?serial=${encodeURIComponent(serial)}`);
            return this.parseStatus(serial, response);
        }
        catch (error) {
            this.log.error(`Failed to get state for ${serial}:`, error);
            return null;
        }
    }
    async setTemperature(deviceId, temperature, mode) {
        await this.request('POST', '/command', {
            serial: deviceId,
            action: 'temp',
            value: temperature,
            mode,
        });
    }
    async setTemperatureRange(deviceId, lowTemperature, highTemperature) {
        await this.request('POST', '/command', {
            serial: deviceId,
            action: 'temp',
            mode: 'range',
            target_temperature_low: lowTemperature,
            target_temperature_high: highTemperature,
        });
    }
    async setMode(deviceId, mode) {
        // Translate heat-cool -> range for the self-hosted API
        const apiMode = mode === 'heat-cool' ? 'range' : mode;
        await this.request('POST', '/command', {
            serial: deviceId,
            action: 'set',
            field: 'target_temperature_type',
            value: apiMode,
        });
    }
    async setAwayMode(deviceId, away) {
        await this.request('POST', '/command', {
            serial: deviceId,
            action: 'away',
            value: away,
        });
    }
    async getSchedule(_deviceId) {
        this.log.warn('Schedule management is not supported on self-hosted servers');
        return null;
    }
    async setSchedule(_deviceId, _schedule) {
        this.log.warn('Schedule management is not supported on self-hosted servers');
    }
    async clearSchedule(_deviceId) {
        this.log.warn('Schedule management is not supported on self-hosted servers');
    }
    async setLearningMode(deviceId, enabled) {
        // Nest thermostats use 'learning_mode' in device.{serial}
        // Some firmware versions also use 'auto_schedule_enable'
        try {
            await this.request('POST', '/command', {
                serial: deviceId,
                action: 'set',
                field: 'learning_mode',
                value: enabled,
            });
        }
        catch (error) {
            this.log.debug('Failed to set learning_mode, trying auto_schedule_enable:', error);
        }
        try {
            await this.request('POST', '/command', {
                serial: deviceId,
                action: 'set',
                field: 'auto_schedule_enable',
                value: enabled,
            });
        }
        catch (error) {
            this.log.debug('Failed to set auto_schedule_enable:', error);
        }
    }
    parseStatus(serial, response) {
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
        const currentTemp = shared['current_temperature'] ?? 20;
        const targetTemp = shared['target_temperature'] ?? 20;
        const targetTempLow = shared['target_temperature_low'] ?? 18;
        const targetTempHigh = shared['target_temperature_high'] ?? 24;
        // HVAC mode mapping (self-hosted uses 'range' instead of 'heat-cool')
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
        // Self-hosted doesn't provide a name in the device list
        const name = shared['name'] || `Nest ${serial.slice(-4)}`;
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
exports.SelfHostedAPI = SelfHostedAPI;
