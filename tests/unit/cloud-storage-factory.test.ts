import {
  LocalStorage,
  createCloudStorage,
} from '../../src/sync/cloud/storage.js';

describe('createCloudStorage', () => {
  it('creates LocalStorage for local provider', () => {
    const storage = createCloudStorage({
      provider: 'local',
      bucket: 'test',
      endpoint: '.codebuddy/cloud-test',
    });

    expect(storage).toBeInstanceOf(LocalStorage);
  });

  it('fails fast for cloud providers without real adapters', () => {
    expect(() =>
      createCloudStorage({
        provider: 'gcs',
        bucket: 'test',
      })
    ).toThrow('Cloud provider "gcs" is not implemented');

    expect(() =>
      createCloudStorage({
        provider: 'azure',
        bucket: 'test',
      })
    ).toThrow('Cloud provider "azure" is not implemented');
  });
});
