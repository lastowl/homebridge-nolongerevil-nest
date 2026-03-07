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
export interface ScheduleEntry {
    temp: number;
    time: number;
    type: 'HEAT' | 'COOL' | 'RANGE';
    entry_type: 'setpoint' | 'continuation';
}
export interface ThermostatSchedule {
    ver: number;
    days: Record<string, Record<string, ScheduleEntry>>;
    name: string;
    schedule_mode: 'HEAT' | 'COOL' | 'RANGE';
}
export interface ScheduleResponse {
    device: {
        id: string;
        serial: string;
        name: string | null;
    };
    schedule: ThermostatSchedule | null;
}
export interface ThermostatApiClient {
    getThermostatStates(): Promise<ThermostatState[]>;
    getThermostatState(deviceId: string): Promise<ThermostatState | null>;
    setTemperature(deviceId: string, temperature: number, mode: 'heat' | 'cool'): Promise<void>;
    setTemperatureRange(deviceId: string, lowTemperature: number, highTemperature: number): Promise<void>;
    setMode(deviceId: string, mode: 'off' | 'heat' | 'cool' | 'heat-cool'): Promise<void>;
    setAwayMode(deviceId: string, away: boolean): Promise<void>;
    getSchedule(deviceId: string): Promise<ThermostatSchedule | null>;
    setSchedule(deviceId: string, schedule: ThermostatSchedule): Promise<void>;
    clearSchedule(deviceId: string): Promise<void>;
    setLearningMode(deviceId: string, enabled: boolean): Promise<void>;
    readonly supportsLearningMode: boolean;
    readonly sourceLabel: string;
}
export declare class NoLongerEvilAPI implements ThermostatApiClient {
    private readonly baseUrl;
    private readonly apiKey;
    private readonly log;
    private readonly isHttps;
    constructor(apiKey: string, log: Logger, serverUrl?: string);
    get sourceLabel(): string;
    get supportsLearningMode(): boolean;
    private request;
    getDevices(): Promise<ApiDevice[]>;
    getDeviceStatus(deviceId: string): Promise<DeviceStatusResponse>;
    setTemperature(deviceId: string, temperature: number, mode: 'heat' | 'cool'): Promise<void>;
    setTemperatureRange(deviceId: string, lowTemperature: number, highTemperature: number): Promise<void>;
    setMode(deviceId: string, mode: 'off' | 'heat' | 'cool' | 'heat-cool'): Promise<void>;
    setAwayMode(deviceId: string, away: boolean): Promise<void>;
    getSchedule(deviceId: string): Promise<ThermostatSchedule | null>;
    setSchedule(deviceId: string, schedule: ThermostatSchedule): Promise<void>;
    clearSchedule(deviceId: string): Promise<void>;
    setLearningMode(_deviceId: string, _enabled: boolean): Promise<void>;
    parseDeviceStatus(deviceId: string, response: DeviceStatusResponse): ThermostatState;
    getThermostatStates(): Promise<ThermostatState[]>;
    getThermostatState(deviceId: string): Promise<ThermostatState | null>;
}
