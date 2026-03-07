import {
  CloudStorage,
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

  it('creates storage instances for gcs and azure providers', () => {
    const gcs = createCloudStorage({
      provider: 'gcs',
      bucket: 'test',
    });
    const azure = createCloudStorage({
      provider: 'azure',
      bucket: 'test',
    });

    expect(gcs).toBeInstanceOf(CloudStorage);
    expect(azure).toBeInstanceOf(CloudStorage);
  });
});
