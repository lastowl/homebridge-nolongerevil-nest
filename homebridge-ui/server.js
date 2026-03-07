const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils');
const http = require('http');
const https = require('https');
const fs = require('fs');

const HOSTED_API_URL = 'https://nolongerevil.com/api/v1';

class ScheduleUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();

    this.onRequest('/devices', this.getDevices.bind(this));
    this.onRequest('/schedule', this.getSchedule.bind(this));
    this.onRequest('/schedule/update', this.updateSchedule.bind(this));
    this.onRequest('/raw-state', this.getRawState.bind(this));

    this.ready();
  }

  getApiConfig() {
    const configPath = this.homebridgeConfigPath;
    if (!configPath) {
      throw new Error('Could not determine Homebridge config path');
    }

    const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const config = (rawConfig.platforms || []).find(
      (p) => p.platform === 'NoLongerEvilNest',
    );

    if (!config) {
      throw new Error('Plugin configuration not found. Save your settings first.');
    }

    const sources = [];

    if (config.servers && config.servers.length > 0) {
      for (const server of config.servers) {
        if (server.apiKey) {
          sources.push({
            apiKey: server.apiKey,
            baseUrl: server.serverUrl ? server.serverUrl.replace(/\/$/, '') : HOSTED_API_URL,
            name: server.name || (server.serverUrl ? server.serverUrl : 'Hosted'),
            isSelfHosted: !!server.serverUrl,
          });
        }
      }
    } else if (config.apiKey) {
      sources.push({
        apiKey: config.apiKey,
        baseUrl: config.serverUrl ? config.serverUrl.replace(/\/$/, '') : HOSTED_API_URL,
        name: config.serverUrl ? config.serverUrl : 'Hosted',
        isSelfHosted: !!config.serverUrl,
      });
    }

    if (sources.length === 0) {
      throw new Error('No API sources configured. Add an API key in the settings below.');
    }

    return sources;
  }

  apiRequest(baseUrl, apiKey, method, path, body) {
    return new Promise((resolve, reject) => {
      const fullUrl = `${baseUrl}${path}`;
      const url = new URL(fullUrl);
      const isHttps = baseUrl.startsWith('https://');

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      };

      const client = isHttps ? https : http;

      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve(data);
            }
          } else {
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
    const sources = this.getApiConfig();
    const allDevices = [];

    for (const source of sources) {
      try {
        if (source.isSelfHosted) {
          const devices = await this.apiRequest(source.baseUrl, source.apiKey, 'GET', '/api/devices');
          for (const d of devices) {
            allDevices.push({
              id: d.serial,
              serial: d.serial,
              name: `Nest ${d.serial.slice(-4)}`,
              source: source.name,
              isSelfHosted: true,
            });
          }
        } else {
          const response = await this.apiRequest(source.baseUrl, source.apiKey, 'GET', '/devices');
          for (const d of response.devices) {
            allDevices.push({
              id: d.id,
              serial: d.serial,
              name: d.name || `Nest ${d.serial.slice(-4)}`,
              source: source.name,
              isSelfHosted: false,
            });
          }
        }
      } catch (error) {
        allDevices.push({
          id: null,
          error: `Failed to load from ${source.name}: ${error.message}`,
        });
      }
    }

    return allDevices;
  }

  async getSchedule(payload) {
    const { deviceId, isSelfHosted } = payload;
    const sources = this.getApiConfig();
    const source = isSelfHosted
      ? sources.find((s) => s.isSelfHosted)
      : sources.find((s) => !s.isSelfHosted);

    if (!source) {
      throw new Error('No matching API source found');
    }

    if (isSelfHosted) {
      throw new Error('Schedule management is not supported on self-hosted servers');
    }

    const response = await this.apiRequest(
      source.baseUrl,
      source.apiKey,
      'GET',
      `/thermostat/${deviceId}/schedule`,
    );
    return response;
  }

  async updateSchedule(payload) {
    const { deviceId, schedule, isSelfHosted } = payload;
    const sources = this.getApiConfig();
    const source = isSelfHosted
      ? sources.find((s) => s.isSelfHosted)
      : sources.find((s) => !s.isSelfHosted);

    if (!source) {
      throw new Error('No matching API source found');
    }

    if (isSelfHosted) {
      throw new Error('Schedule management is not supported on self-hosted servers');
    }

    await this.apiRequest(
      source.baseUrl,
      source.apiKey,
      'PUT',
      `/thermostat/${deviceId}/schedule`,
      { schedule },
    );

    return { success: true };
  }

  async getRawState(payload) {
    const { deviceId, isSelfHosted } = payload;
    const sources = this.getApiConfig();
    const source = isSelfHosted
      ? sources.find((s) => s.isSelfHosted)
      : sources.find((s) => !s.isSelfHosted);

    if (!source) {
      throw new Error('No matching API source found');
    }

    if (isSelfHosted) {
      const response = await this.apiRequest(source.baseUrl, source.apiKey, 'GET', `/status?serial=${deviceId}`);
      return response;
    }

    const response = await this.apiRequest(source.baseUrl, source.apiKey, 'GET', `/thermostat/${deviceId}/status`);
    return response;
  }
}

(() => new ScheduleUiServer())();
