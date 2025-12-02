import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { NoLongerEvilAPI, ThermostatState } from './api';
import { NestThermostatAccessory } from './thermostatAccessory';

export interface NoLongerEvilConfig extends PlatformConfig {
  apiKey?: string;
  serverUrl?: string;
  pollInterval?: number;
}

export class NoLongerEvilPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: PlatformAccessory[] = [];
  private readonly thermostatAccessories: Map<string, NestThermostatAccessory> = new Map();

  public readonly api_client: NoLongerEvilAPI;

  constructor(
    public readonly log: Logger,
    public readonly config: NoLongerEvilConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    // Validate configuration
    if (!config.apiKey) {
      this.log.error('Missing required configuration: apiKey');
      this.log.error('Please add your NoLongerEvil API key to the plugin configuration.');
      this.api_client = null!;
      return;
    }

    this.api_client = new NoLongerEvilAPI(config.apiKey, log, config.serverUrl);

    if (config.serverUrl) {
      this.log.info(`NoLongerEvil platform initialized (self-hosted: ${config.serverUrl})`);
    } else {
      this.log.info('NoLongerEvil platform initialized (using hosted API)');
    }

    // Wait for Homebridge to finish loading cached accessories
    this.api.on('didFinishLaunching', () => {
      this.log.debug('Finished restoring cached accessories');
      this.discoverDevices();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  async discoverDevices(): Promise<void> {
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

    } catch (error) {
      this.log.error('Failed to discover devices:', error);
    }
  }

  private addOrUpdateThermostat(state: ThermostatState): void {
    const uuid = this.api.hap.uuid.generate(state.serial);
    const existingAccessory = this.accessories.find(acc => acc.UUID === uuid);

    if (existingAccessory) {
      // Accessory already exists, update it
      this.log.info('Restoring existing accessory:', state.name);
      existingAccessory.context.device = state;

      // Create the accessory handler
      const thermostatAccessory = new NestThermostatAccessory(this, existingAccessory, state);
      this.thermostatAccessories.set(state.deviceId, thermostatAccessory);

    } else {
      // Create a new accessory
      this.log.info('Adding new accessory:', state.name);
      const accessory = new this.api.platformAccessory(state.name, uuid);
      accessory.context.device = state;

      // Create the accessory handler
      const thermostatAccessory = new NestThermostatAccessory(this, accessory, state);
      this.thermostatAccessories.set(state.deviceId, thermostatAccessory);

      // Register the accessory
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    }
  }

  private removeStaleAccessories(currentStates: ThermostatState[]): void {
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

      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleAccessories);
    }
  }
}
