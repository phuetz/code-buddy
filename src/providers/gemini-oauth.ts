import { OAuth2Client, type Credentials } from 'google-auth-library';
import * as http from 'node:http';
import * as url from 'node:url';
import * as crypto from 'node:crypto';
import * as net from 'node:net';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import open from 'open';
import { logger } from '../utils/logger.js';

// Cloud Code First-Party Client ID & Secret
const OAUTH_CLIENT_ID = process.env.GEMINI_OAUTH_CLIENT_ID || '';
const OAUTH_CLIENT_SECRET = process.env.GEMINI_OAUTH_CLIENT_SECRET || '';

const OAUTH_SCOPE = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

const SIGN_IN_SUCCESS_URL = 'https://developers.google.com/gemini-code-assist/auth_success_gemini';
const SIGN_IN_FAILURE_URL = 'https://developers.google.com/gemini-code-assist/auth_failure_gemini';

function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        server.close();
        resolve(port);
      }
    });
    server.on('error', reject);
  });
}

function getCredentialsPath(): string {
  return path.join(os.homedir(), '.codebuddy', 'gemini-auth.json');
}

export async function clearGeminiCredentials(): Promise<void> {
  try {
    await fs.rm(getCredentialsPath(), { force: true });
    logger.info('Gemini credentials cleared.');
  } catch (error) {
    logger.error('Failed to clear Gemini credentials', { error });
  }
}

export async function getGeminiOauthTokens(forceLogin = false): Promise<Credentials> {
  const client = new OAuth2Client({
    clientId: OAUTH_CLIENT_ID,
    clientSecret: OAUTH_CLIENT_SECRET,
  });

  const credsPath = getCredentialsPath();
  
  if (!forceLogin) {
    try {
      const credsRaw = await fs.readFile(credsPath, 'utf-8');
      const creds = JSON.parse(credsRaw) as Credentials;
      client.setCredentials(creds);
      
      // Attempt to get access token to see if it's still valid or can be refreshed
      const { token } = await client.getAccessToken();
      if (token) {
        // Save the updated credentials if they were refreshed
        await fs.writeFile(credsPath, JSON.stringify(client.credentials, null, 2));
        return client.credentials;
      }
    } catch (_e) {
      // Ignore read errors or invalid JSON
    }
  }

  // If no valid tokens or forceLogin, initiate Web Login
  logger.info('Initiating Gemini OAuth web login...');
  const port = await getAvailablePort();
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const state = crypto.randomBytes(32).toString('hex');
  
  const authUrl = client.generateAuthUrl({
    redirect_uri: redirectUri,
    access_type: 'offline',
    scope: OAUTH_SCOPE,
    state,
  });

  return new Promise<Credentials>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        if (!req.url?.includes('/oauth2callback')) {
          res.writeHead(301, { Location: SIGN_IN_FAILURE_URL });
          res.end();
          return;
        }

        const qs = new url.URL(req.url, `http://127.0.0.1:${port}`).searchParams;
        if (qs.get('error')) {
          res.writeHead(301, { Location: SIGN_IN_FAILURE_URL });
          res.end();
          reject(new Error(`Google OAuth error: ${qs.get('error')}`));
        } else if (qs.get('state') !== state) {
          res.writeHead(301, { Location: SIGN_IN_FAILURE_URL });
          res.end('State mismatch. Possible CSRF attack');
          reject(new Error('OAuth state mismatch.'));
        } else if (qs.get('code')) {
          const { tokens } = await client.getToken({
            code: qs.get('code')!,
            redirect_uri: redirectUri,
          });
          
          client.setCredentials(tokens);
          
          // Save credentials to disk
          await fs.mkdir(path.dirname(credsPath), { recursive: true });
          await fs.writeFile(credsPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
          
          res.writeHead(301, { Location: SIGN_IN_SUCCESS_URL });
          res.end();
          resolve(tokens);
        } else {
          reject(new Error('No authorization code received.'));
        }
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });

    server.listen(port, '127.0.0.1', () => {
      logger.info(`Opening browser to authenticate...`);
      open(authUrl).catch((err) => {
        logger.error(`Failed to open browser automatically: ${err}`);
        console.log(`Please manually navigate to: ${authUrl}`);
      });
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Returns a configured authenticated fetch client (OAuth2Client).
 */
export async function getAuthenticatedClient(): Promise<OAuth2Client> {
  const tokens = await getGeminiOauthTokens();
  const client = new OAuth2Client({
    clientId: OAUTH_CLIENT_ID,
    clientSecret: OAUTH_CLIENT_SECRET,
  });
  client.setCredentials(tokens);
  return client;
}
