import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
export interface ServerConfig {
    apiKey: string;
    serverUrl?: string;
    name?: string;
}
export interface NoLongerEvilConfig extends PlatformConfig {
    apiKey?: string;
    serverUrl?: string;
    servers?: ServerConfig[];
    pollInterval?: number;
    enableScheduleSwitch?: boolean;
}
export declare class NoLongerEvilPlatform implements DynamicPlatformPlugin {
    readonly log: Logger;
    readonly config: NoLongerEvilConfig;
    readonly api: API;
    readonly Service: typeof Service;
    readonly Characteristic: typeof Characteristic;
    readonly accessories: PlatformAccessory[];
    private readonly thermostatAccessories;
    private readonly apiClients;
    private readonly deviceClientMap;
    constructor(log: Logger, config: NoLongerEvilConfig, api: API);
    private resolveServerConfigs;
    configureAccessory(accessory: PlatformAccessory): void;
    discoverDevices(): Promise<void>;
    private addOrUpdateThermostat;
    private removeStaleAccessories;
}
