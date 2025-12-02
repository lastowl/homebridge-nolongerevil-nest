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
exports.NoLongerEvilAPI = void 0;
const https = __importStar(require("https"));
class NoLongerEvilAPI {
    baseUrl = 'https://nolongerevil.com/api/v1';
    apiKey;
    log;
    constructor(apiKey, log) {
        this.apiKey = apiKey;
        this.log = log;
    }
    request(method, path, body) {
        return new Promise((resolve, reject) => {
            const fullUrl = `${this.baseUrl}${path}`;
            const url = new URL(fullUrl);
            this.log.debug(`API Request: ${method} ${fullUrl}`);
            const options = {
                hostname: url.hostname,
                port: 443,
                path: url.pathname + url.search,
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                },
            };
            const req = https.request(options, (res) => {
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
                        reject(new Error('Rate limit exceeded. Please wait before making more requests.'));
                    }
                    else if (res.statusCode === 401) {
                        reject(new Error('Invalid API key. Please check your configuration.'));
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
            return this.parseDeviceStatus(deviceId, status);
        }
        catch (error) {
            this.log.error(`Failed to get state for ${deviceId}:`, error);
            return null;
        }
    }
}
exports.NoLongerEvilAPI = NoLongerEvilAPI;
