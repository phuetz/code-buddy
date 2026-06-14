import { ChannelBase } from '../channel-base';
import { WeChatChannelConfig, RemoteResponse } from '../../types';

export class WeChatChannel extends ChannelBase {
  readonly type = 'wechat';
  public config: WeChatChannelConfig;

  constructor(config: WeChatChannelConfig) {
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
