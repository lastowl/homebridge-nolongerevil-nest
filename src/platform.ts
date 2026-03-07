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
import { NoLongerEvilAPI, ThermostatApiClient, ThermostatState } from './api';
import { SelfHostedAPI } from './selfHostedApi';
import { NestThermostatAccessory } from './thermostatAccessory';

export interface ServerConfig {
  apiKey: string;
  serverUrl?: string;
  name?: string;
}

export interface NoLongerEvilConfig extends PlatformConfig {
  // Legacy single-source config (backward compatible)
  apiKey?: string;
  serverUrl?: string;
  // Multi-source config
  servers?: ServerConfig[];
  pollInterval?: number;
  enableScheduleSwitch?: boolean;
}

export class NoLongerEvilPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: PlatformAccessory[] = [];
  private readonly thermostatAccessories: Map<string, NestThermostatAccessory> = new Map();

  private readonly apiClients: ThermostatApiClient[] = [];
  private readonly deviceClientMap: Map<string, ThermostatApiClient> = new Map();

  constructor(
    public readonly log: Logger,
    public readonly config: NoLongerEvilConfig,
    public readonly api: API,
  ) {
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
        this.apiClients.push(new SelfHostedAPI(sc.apiKey, sc.serverUrl, log));
      } else {
        this.apiClients.push(new NoLongerEvilAPI(sc.apiKey, log));
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

  private resolveServerConfigs(config: NoLongerEvilConfig): ServerConfig[] {
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

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  async discoverDevices(): Promise<void> {
    if (this.apiClients.length === 0) {
      this.log.error('No API clients initialized, skipping device discovery');
      return;
    }

    try {
      this.log.info('Discovering Nest thermostats...');
      const allStates: ThermostatState[] = [];

      // Query all sources in parallel
      const results = await Promise.allSettled(
        this.apiClients.map(client => client.getThermostatStates()),
      );

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const client = this.apiClients[i];

        if (result.status === 'fulfilled') {
          this.log.info(`Found ${result.value.length} thermostat(s) from ${client.sourceLabel}`);
          for (const state of result.value) {
            allStates.push(state);
            this.deviceClientMap.set(state.deviceId, client);
          }
        } else {
          this.log.error(`Failed to discover devices from ${client.sourceLabel}:`, result.reason);
        }
      }

      // Deduplicate by serial (first source wins), warn on conflicts
      const seenSerials = new Map<string, string>();
      const uniqueStates: ThermostatState[] = [];

      for (const state of allStates) {
        const existingSource = seenSerials.get(state.serial);
        if (existingSource) {
          const thisSource = this.deviceClientMap.get(state.deviceId)?.sourceLabel || 'unknown';
          this.log.warn(
            `Thermostat ${state.serial} found on multiple sources (${existingSource}, ${thisSource}). Using first occurrence.`,
          );
        } else {
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
    } catch (error) {
      this.log.error('Failed to discover devices:', error);
    }
  }

  private addOrUpdateThermostat(state: ThermostatState): void {
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

      const thermostatAccessory = new NestThermostatAccessory(this, existingAccessory, state, client);
      this.thermostatAccessories.set(state.serial, thermostatAccessory);
    } else {
      this.log.info('Adding new accessory:', state.name);
      const accessory = new this.api.platformAccessory(state.name, uuid);
      accessory.context.device = state;

      const thermostatAccessory = new NestThermostatAccessory(this, accessory, state, client);
      this.thermostatAccessories.set(state.serial, thermostatAccessory);

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
        const serial = accessory.context.device?.serial;
        if (serial) {
          const thermostatAccessory = this.thermostatAccessories.get(serial);
          if (thermostatAccessory) {
            thermostatAccessory.stopPolling();
            this.thermostatAccessories.delete(serial);
          }
        }
      }

      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleAccessories);
    }
  }
}
