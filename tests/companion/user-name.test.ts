import { resolveUserName, DEFAULT_USER_NAME } from '../../src/companion/user-name.js';

describe('resolveUserName', () => {
  it('uses CODEBUDDY_USER_NAME when set', () => {
    expect(resolveUserName({ CODEBUDDY_USER_NAME: 'Alex' } as NodeJS.ProcessEnv)).toBe('Alex');
    expect(resolveUserName({ CODEBUDDY_USER_NAME: '  Marie  ' } as NodeJS.ProcessEnv)).toBe(
      'Marie'
    );
  });

  it('falls back to the default when unset or empty', () => {
    expect(DEFAULT_USER_NAME).toBe('l’utilisateur');
    expect(resolveUserName({} as NodeJS.ProcessEnv)).toBe(DEFAULT_USER_NAME);
    expect(resolveUserName({ CODEBUDDY_USER_NAME: '   ' } as NodeJS.ProcessEnv)).toBe(
      DEFAULT_USER_NAME
    );
  });
});
