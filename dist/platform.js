"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NoLongerEvilPlatform = void 0;
const settings_1 = require("./settings");
const api_1 = require("./api");
const selfHostedApi_1 = require("./selfHostedApi");
const thermostatAccessory_1 = require("./thermostatAccessory");
class NoLongerEvilPlatform {
    log;
    config;
    api;
    Service;
    Characteristic;
    accessories = [];
    thermostatAccessories = new Map();
    apiClients = [];
    deviceClientMap = new Map();
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;
        const serverConfigs = this.resolveServerConfigs(config);
        if (serverConfigs.length === 0) {
            this.log.error('No API sources configured. Add an apiKey or configure the servers array.');
            return;
        }
        for (const sc of serverConfigs) {
            if (!sc.apiKey) {
                this.log.warn(`Skipping server "${sc.name || 'unnamed'}" - missing apiKey`);
                continue;
            }
            if (sc.serverUrl) {
                this.apiClients.push(new selfHostedApi_1.SelfHostedAPI(sc.apiKey, sc.serverUrl, log));
            }
            else {
                this.apiClients.push(new api_1.NoLongerEvilAPI(sc.apiKey, log));
            }
        }
        if (this.apiClients.length === 0) {
            this.log.error('No valid API sources found after configuration. Check your apiKey settings.');
            return;
        }
        this.log.info(`NoLongerEvil platform initialized with ${this.apiClients.length} API source(s)`);
        for (const client of this.apiClients) {
            this.log.info(`  - ${client.sourceLabel}`);
        }
        // Wait for Homebridge to finish loading cached accessories
        this.api.on('didFinishLaunching', () => {
            this.log.debug('Finished restoring cached accessories');
            this.discoverDevices();
        });
    }
    resolveServerConfigs(config) {
        // If new servers array is present and non-empty, use it
        if (config.servers && config.servers.length > 0) {
            return config.servers;
        }
        // Fall back to legacy single-source fields
        if (config.apiKey) {
            return [{
                    apiKey: config.apiKey,
                    serverUrl: config.serverUrl,
                }];
        }
        return [];
    }
    configureAccessory(accessory) {
        this.log.info('Loading accessory from cache:', accessory.displayName);
        this.accessories.push(accessory);
    }
    async discoverDevices() {
        if (this.apiClients.length === 0) {
            this.log.error('No API clients initialized, skipping device discovery');
            return;
        }
        try {
            this.log.info('Discovering Nest thermostats...');
            const allStates = [];
            // Query all sources in parallel
            const results = await Promise.allSettled(this.apiClients.map(client => client.getThermostatStates()));
            for (let i = 0; i < results.length; i++) {
                const result = results[i];
                const client = this.apiClients[i];
                if (result.status === 'fulfilled') {
                    this.log.info(`Found ${result.value.length} thermostat(s) from ${client.sourceLabel}`);
                    for (const state of result.value) {
                        allStates.push(state);
                        this.deviceClientMap.set(state.deviceId, client);
                    }
                }
                else {
                    this.log.error(`Failed to discover devices from ${client.sourceLabel}:`, result.reason);
                }
            }
            // Deduplicate by serial (first source wins), warn on conflicts
            const seenSerials = new Map();
            const uniqueStates = [];
            for (const state of allStates) {
                const existingSource = seenSerials.get(state.serial);
                if (existingSource) {
                    const thisSource = this.deviceClientMap.get(state.deviceId)?.sourceLabel || 'unknown';
                    this.log.warn(`Thermostat ${state.serial} found on multiple sources (${existingSource}, ${thisSource}). Using first occurrence.`);
                }
                else {
                    seenSerials.set(state.serial, this.deviceClientMap.get(state.deviceId)?.sourceLabel || 'unknown');
                    uniqueStates.push(state);
                }
            }
            if (uniqueStates.length === 0) {
                this.log.warn('No thermostats found from any source. Make sure devices are registered.');
                return;
            }
            this.log.info(`Total: ${uniqueStates.length} unique thermostat(s)`);
            for (const state of uniqueStates) {
                this.addOrUpdateThermostat(state);
            }
            this.removeStaleAccessories(uniqueStates);
        }
        catch (error) {
            this.log.error('Failed to discover devices:', error);
        }
    }
    addOrUpdateThermostat(state) {
        const uuid = this.api.hap.uuid.generate(state.serial);
        const client = this.deviceClientMap.get(state.deviceId);
        if (!client) {
            this.log.error(`No API client found for device ${state.deviceId}, skipping`);
            return;
        }
        const existingAccessory = this.accessories.find(acc => acc.UUID === uuid);
        if (existingAccessory) {
            this.log.info('Restoring existing accessory:', state.name);
            existingAccessory.context.device = state;
            const thermostatAccessory = new thermostatAccessory_1.NestThermostatAccessory(this, existingAccessory, state, client);
            this.thermostatAccessories.set(state.serial, thermostatAccessory);
        }
        else {
            this.log.info('Adding new accessory:', state.name);
            const accessory = new this.api.platformAccessory(state.name, uuid);
            accessory.context.device = state;
            const thermostatAccessory = new thermostatAccessory_1.NestThermostatAccessory(this, accessory, state, client);
            this.thermostatAccessories.set(state.serial, thermostatAccessory);
            this.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [accessory]);
            this.accessories.push(accessory);
        }
    }
    removeStaleAccessories(currentStates) {
        const currentSerials = new Set(currentStates.map(s => s.serial));
        const staleAccessories = this.accessories.filter(accessory => {
            const serial = accessory.context.device?.serial;
            return serial && !currentSerials.has(serial);
        });
        if (staleAccessories.length > 0) {
            this.log.info(`Removing ${staleAccessories.length} stale accessory(ies)`);
            for (const accessory of staleAccessories) {
                const serial = accessory.context.device?.serial;
                if (serial) {
                    const thermostatAccessory = this.thermostatAccessories.get(serial);
                    if (thermostatAccessory) {
                        thermostatAccessory.stopPolling();
                        this.thermostatAccessories.delete(serial);
                    }
                }
            }
            this.api.unregisterPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, staleAccessories);
        }
    }
}
exports.NoLongerEvilPlatform = NoLongerEvilPlatform;
