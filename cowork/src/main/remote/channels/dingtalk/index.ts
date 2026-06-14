import { ChannelBase } from '../channel-base';
import { DingTalkChannelConfig, RemoteResponse } from '../../types';

export class DingTalkChannel extends ChannelBase {
  readonly type = 'dingtalk';
  public config: DingTalkChannelConfig;

  constructor(config: DingTalkChannelConfig) {
    super();
    this.config = config;
  }

  async start(): Promise<void> {
    this._connected = true;
    this.logStatus('started');
  }

  async stop(): Promise<void> {
    this._connected = false;
    this.logStatus('stopped');
  }

  async send(response: RemoteResponse): Promise<void> {
    this.logStatus(`Sending response to ${response.channelId}`, { response });
  }
}
