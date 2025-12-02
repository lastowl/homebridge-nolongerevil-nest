import { Logger } from 'homebridge';
export interface ApiDevice {
    id: string;
    serial: string;
    name: string | null;
    accessType: 'owner' | 'shared';
}
export interface DevicesResponse {
    devices: ApiDevice[];
}
export interface DeviceStatusResponse {
    device: {
        id: string;
        serial: string;
        name: string | null;
    };
    state: {
        [key: string]: {
            value: Record<string, unknown>;
        };
    };
}
export interface ThermostatState {
    deviceId: string;
    serial: string;
    currentTemperature: number;
    targetTemperature: number;
    targetTemperatureLow: number;
    targetTemperatureHigh: number;
    hvacMode: 'off' | 'heat' | 'cool' | 'heat-cool';
    hvacState: 'off' | 'heating' | 'cooling';
    humidity: number;
    awayMode: boolean;
    canHeat: boolean;
    canCool: boolean;
    name: string;
}
export declare class NoLongerEvilAPI {
    private readonly baseUrl;
    private readonly apiKey;
    private readonly log;
    constructor(apiKey: string, log: Logger);
    private request;
    getDevices(): Promise<ApiDevice[]>;
    getDeviceStatus(deviceId: string): Promise<DeviceStatusResponse>;
    setTemperature(deviceId: string, temperature: number, mode: 'heat' | 'cool'): Promise<void>;
    setTemperatureRange(deviceId: string, lowTemperature: number, highTemperature: number): Promise<void>;
    setMode(deviceId: string, mode: 'off' | 'heat' | 'cool' | 'heat-cool'): Promise<void>;
    setAwayMode(deviceId: string, away: boolean): Promise<void>;
    parseDeviceStatus(deviceId: string, response: DeviceStatusResponse): ThermostatState;
    getThermostatStates(): Promise<ThermostatState[]>;
    getThermostatState(deviceId: string): Promise<ThermostatState | null>;
}
