"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NoLongerEvilPlatform = void 0;
const settings_1 = require("./settings");
const api_1 = require("./api");
const thermostatAccessory_1 = require("./thermostatAccessory");
class NoLongerEvilPlatform {
    log;
    config;
    api;
    Service;
    Characteristic;
    accessories = [];
    thermostatAccessories = new Map();
    api_client;
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;
        // Validate configuration
        if (!config.apiKey) {
            this.log.error('Missing required configuration: apiKey');
            this.log.error('Please add your NoLongerEvil API key to the plugin configuration.');
            this.api_client = null;
            return;
        }
        this.api_client = new api_1.NoLongerEvilAPI(config.apiKey, log);
        this.log.info('NoLongerEvil platform initialized');
        // Wait for Homebridge to finish loading cached accessories
        this.api.on('didFinishLaunching', () => {
            this.log.debug('Finished restoring cached accessories');
            this.discoverDevices();
        });
    }
    configureAccessory(accessory) {
        this.log.info('Loading accessory from cache:', accessory.displayName);
        this.accessories.push(accessory);
    }
    async discoverDevices() {
        if (!this.api_client) {
            this.log.error('API client not initialized, skipping device discovery');
            return;
        }
        try {
            this.log.info('Discovering Nest thermostats...');
            const thermostatStates = await this.api_client.getThermostatStates();
            if (thermostatStates.length === 0) {
                this.log.warn('No thermostats found. Make sure devices are registered with your NoLongerEvil account.');
                return;
            }
            this.log.info(`Found ${thermostatStates.length} thermostat(s)`);
            for (const state of thermostatStates) {
                this.addOrUpdateThermostat(state);
            }
            // Remove accessories that are no longer present
            this.removeStaleAccessories(thermostatStates);
        }
        catch (error) {
            this.log.error('Failed to discover devices:', error);
        }
    }
    addOrUpdateThermostat(state) {
        const uuid = this.api.hap.uuid.generate(state.serial);
        const existingAccessory = this.accessories.find(acc => acc.UUID === uuid);
        if (existingAccessory) {
            // Accessory already exists, update it
            this.log.info('Restoring existing accessory:', state.name);
            existingAccessory.context.device = state;
            // Create the accessory handler
            const thermostatAccessory = new thermostatAccessory_1.NestThermostatAccessory(this, existingAccessory, state);
            this.thermostatAccessories.set(state.deviceId, thermostatAccessory);
        }
        else {
            // Create a new accessory
            this.log.info('Adding new accessory:', state.name);
            const accessory = new this.api.platformAccessory(state.name, uuid);
            accessory.context.device = state;
            // Create the accessory handler
            const thermostatAccessory = new thermostatAccessory_1.NestThermostatAccessory(this, accessory, state);
            this.thermostatAccessories.set(state.deviceId, thermostatAccessory);
            // Register the accessory
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
                const deviceId = accessory.context.device?.deviceId;
                if (deviceId) {
                    const thermostatAccessory = this.thermostatAccessories.get(deviceId);
                    if (thermostatAccessory) {
                        thermostatAccessory.stopPolling();
                        this.thermostatAccessories.delete(deviceId);
                    }
                }
            }
            this.api.unregisterPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, staleAccessories);
        }
    }
}
exports.NoLongerEvilPlatform = NoLongerEvilPlatform;
