import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
} from 'homebridge';
import { NoLongerEvilPlatform } from './platform';
import { ThermostatState } from './api';

export class NestThermostatAccessory {
  private readonly thermostatService: Service;
  private readonly humidityService: Service;

  private state: ThermostatState;
  private readonly pollInterval: number;
  private pollTimer?: NodeJS.Timeout;

  constructor(
    private readonly platform: NoLongerEvilPlatform,
    private readonly accessory: PlatformAccessory,
    initialState: ThermostatState,
  ) {
    this.state = initialState;
    this.pollInterval = this.platform.config.pollInterval || 30;

    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Nest')
      .setCharacteristic(this.platform.Characteristic.Model, 'Thermostat')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.state.serial);

    // Get or create thermostat service
    this.thermostatService = this.accessory.getService(this.platform.Service.Thermostat)
      || this.accessory.addService(this.platform.Service.Thermostat);

    this.thermostatService.setCharacteristic(
      this.platform.Characteristic.Name,
      this.state.name,
    );

    // Current Heating/Cooling State
    this.thermostatService.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.getCurrentHeatingCoolingState.bind(this));

    // Target Heating/Cooling State
    this.thermostatService.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onGet(this.getTargetHeatingCoolingState.bind(this))
      .onSet(this.setTargetHeatingCoolingState.bind(this));

    // Current Temperature
    this.thermostatService.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));

    // Target Temperature
    this.thermostatService.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .setProps({
        minValue: 10,
        maxValue: 32,
        minStep: 0.5,
      })
      .onGet(this.getTargetTemperature.bind(this))
      .onSet(this.setTargetTemperature.bind(this));

    // Cooling Threshold Temperature (for auto mode)
    this.thermostatService.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
      .setProps({
        minValue: 10,
        maxValue: 32,
        minStep: 0.5,
      })
      .onGet(this.getCoolingThresholdTemperature.bind(this))
      .onSet(this.setCoolingThresholdTemperature.bind(this));

    // Heating Threshold Temperature (for auto mode)
    this.thermostatService.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
      .setProps({
        minValue: 10,
        maxValue: 32,
        minStep: 0.5,
      })
      .onGet(this.getHeatingThresholdTemperature.bind(this))
      .onSet(this.setHeatingThresholdTemperature.bind(this));

    // Temperature Display Units
    this.thermostatService.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onGet(() => this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS)
      .onSet(() => { /* Read-only, ignore */ });

    // Humidity sensor service
    this.humidityService = this.accessory.getService(this.platform.Service.HumiditySensor)
      || this.accessory.addService(this.platform.Service.HumiditySensor);

    this.humidityService.setCharacteristic(
      this.platform.Characteristic.Name,
      `${this.state.name} Humidity`,
    );

    this.humidityService.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
      .onGet(this.getCurrentHumidity.bind(this));

    // Start polling for updates
    this.startPolling();
  }

  private startPolling(): void {
    this.pollTimer = setInterval(async () => {
      await this.refreshState();
    }, this.pollInterval * 1000);
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  async refreshState(): Promise<void> {
    const newState = await this.platform.api_client.getThermostatState(this.state.deviceId);
    if (newState) {
      this.state = newState;
      this.updateCharacteristics();
    }
  }

  private updateCharacteristics(): void {
    this.thermostatService.updateCharacteristic(
      this.platform.Characteristic.CurrentHeatingCoolingState,
      this.mapHvacStateToHomeKit(this.state.hvacState),
    );

    this.thermostatService.updateCharacteristic(
      this.platform.Characteristic.TargetHeatingCoolingState,
      this.mapHvacModeToHomeKit(this.state.hvacMode),
    );

    this.thermostatService.updateCharacteristic(
      this.platform.Characteristic.CurrentTemperature,
      this.state.currentTemperature,
    );

    this.thermostatService.updateCharacteristic(
      this.platform.Characteristic.TargetTemperature,
      this.state.targetTemperature,
    );

    this.thermostatService.updateCharacteristic(
      this.platform.Characteristic.CoolingThresholdTemperature,
      this.state.targetTemperatureHigh,
    );

    this.thermostatService.updateCharacteristic(
      this.platform.Characteristic.HeatingThresholdTemperature,
      this.state.targetTemperatureLow,
    );

    this.humidityService.updateCharacteristic(
      this.platform.Characteristic.CurrentRelativeHumidity,
      this.state.humidity,
    );
  }

  private mapHvacStateToHomeKit(state: ThermostatState['hvacState']): CharacteristicValue {
    switch (state) {
      case 'heating':
        return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
      case 'cooling':
        return this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
      case 'off':
      default:
        return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    }
  }

  private mapHvacModeToHomeKit(mode: ThermostatState['hvacMode']): CharacteristicValue {
    switch (mode) {
      case 'heat':
        return this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
      case 'cool':
        return this.platform.Characteristic.TargetHeatingCoolingState.COOL;
      case 'heat-cool':
        return this.platform.Characteristic.TargetHeatingCoolingState.AUTO;
      case 'off':
      default:
        return this.platform.Characteristic.TargetHeatingCoolingState.OFF;
    }
  }

  private mapHomeKitToHvacMode(value: CharacteristicValue): 'off' | 'heat' | 'cool' | 'heat-cool' {
    switch (value) {
      case this.platform.Characteristic.TargetHeatingCoolingState.HEAT:
        return 'heat';
      case this.platform.Characteristic.TargetHeatingCoolingState.COOL:
        return 'cool';
      case this.platform.Characteristic.TargetHeatingCoolingState.AUTO:
        return 'heat-cool';
      case this.platform.Characteristic.TargetHeatingCoolingState.OFF:
      default:
        return 'off';
    }
  }

  // Characteristic handlers
  getCurrentHeatingCoolingState(): CharacteristicValue {
    return this.mapHvacStateToHomeKit(this.state.hvacState);
  }

  getTargetHeatingCoolingState(): CharacteristicValue {
    return this.mapHvacModeToHomeKit(this.state.hvacMode);
  }

  async setTargetHeatingCoolingState(value: CharacteristicValue): Promise<void> {
    const mode = this.mapHomeKitToHvacMode(value);
    this.platform.log.info(`Setting ${this.state.name} mode to ${mode}`);

    try {
      await this.platform.api_client.setMode(this.state.deviceId, mode);
      this.state.hvacMode = mode;
    } catch (error) {
      this.platform.log.error('Failed to set mode:', error);
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
  }

  getCurrentTemperature(): CharacteristicValue {
    return this.state.currentTemperature;
  }

  getTargetTemperature(): CharacteristicValue {
    return this.state.targetTemperature;
  }

  async setTargetTemperature(value: CharacteristicValue): Promise<void> {
    const temperature = value as number;
    this.platform.log.info(`Setting ${this.state.name} target temperature to ${temperature}°C`);

    try {
      // Determine mode based on current HVAC mode
      const mode = this.state.hvacMode === 'cool' ? 'cool' : 'heat';
      await this.platform.api_client.setTemperature(this.state.deviceId, temperature, mode);
      this.state.targetTemperature = temperature;
    } catch (error) {
      this.platform.log.error('Failed to set temperature:', error);
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
  }

  getCoolingThresholdTemperature(): CharacteristicValue {
    return this.state.targetTemperatureHigh;
  }

  async setCoolingThresholdTemperature(value: CharacteristicValue): Promise<void> {
    const temperature = value as number;
    this.platform.log.info(`Setting ${this.state.name} cooling threshold to ${temperature}°C`);

    try {
      await this.platform.api_client.setTemperatureRange(
        this.state.deviceId,
        this.state.targetTemperatureLow,
        temperature,
      );
      this.state.targetTemperatureHigh = temperature;
    } catch (error) {
      this.platform.log.error('Failed to set cooling threshold:', error);
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
  }

  getHeatingThresholdTemperature(): CharacteristicValue {
    return this.state.targetTemperatureLow;
  }

  async setHeatingThresholdTemperature(value: CharacteristicValue): Promise<void> {
    const temperature = value as number;
    this.platform.log.info(`Setting ${this.state.name} heating threshold to ${temperature}°C`);

    try {
      await this.platform.api_client.setTemperatureRange(
        this.state.deviceId,
        temperature,
        this.state.targetTemperatureHigh,
      );
      this.state.targetTemperatureLow = temperature;
    } catch (error) {
      this.platform.log.error('Failed to set heating threshold:', error);
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
  }

  getCurrentHumidity(): CharacteristicValue {
    return this.state.humidity;
  }
}
