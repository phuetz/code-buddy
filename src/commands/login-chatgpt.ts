import open from 'open';
import { loginInteractive, type ChatGptAuth } from '../providers/codex-oauth.js';

interface LoginOutput {
  stdout: (message: string) => unknown;
  warn: (message: string) => unknown;
}

/** Keep the callback alive so a failed browser launch can be completed manually. */
export function loginChatGptWithBrowser(output: LoginOutput): Promise<ChatGptAuth> {
  return loginInteractive(async (url) => {
    output.stdout('If the browser does not open, copy this entire URL into your browser:');
    output.stdout(url);
    output.stdout('Keep this terminal open until sign-in completes.\n');
    try {
      await open(url);
    } catch {
      output.warn('Could not open the browser automatically. Open the URL above manually; login is still waiting.');
    }
  });
}
