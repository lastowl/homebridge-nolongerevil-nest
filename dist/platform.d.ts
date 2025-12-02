import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { NoLongerEvilAPI } from './api';
export interface NoLongerEvilConfig extends PlatformConfig {
    apiKey?: string;
    pollInterval?: number;
}
export declare class NoLongerEvilPlatform implements DynamicPlatformPlugin {
    readonly log: Logger;
    readonly config: NoLongerEvilConfig;
    readonly api: API;
    readonly Service: typeof Service;
    readonly Characteristic: typeof Characteristic;
    readonly accessories: PlatformAccessory[];
    private readonly thermostatAccessories;
    readonly api_client: NoLongerEvilAPI;
    constructor(log: Logger, config: NoLongerEvilConfig, api: API);
    configureAccessory(accessory: PlatformAccessory): void;
    discoverDevices(): Promise<void>;
    private addOrUpdateThermostat;
    private removeStaleAccessories;
}
