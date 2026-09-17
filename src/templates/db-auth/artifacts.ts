import type { ProvisionTarget } from './types.js';

export const INIT_MIGRATION_VERSION = '0001_init';

export function migrationRelativePath(target: ProvisionTarget): string {
  return target === 'supabase'
    ? `supabase/migrations/${INIT_MIGRATION_VERSION}.sql`
    : `db/migrations/${INIT_MIGRATION_VERSION}.sql`;
}

export function localInitSql(): string {
  return `-- Versioned init for a local Postgres container (no remote account).
create extension if not exists pgcrypto;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now(),
  constraint app_users_email_format check (email ~* '^[^@]+@[^@]+\\.[^@]+$')
);

create table if not exists public.profiles (
  id uuid primary key references public.app_users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.sessions (
  token text primary key,
  user_id uuid not null references public.app_users(id) on delete cascade,
  expires_at timestamptz not null
);

create index if not exists sessions_user_id_idx on public.sessions (user_id);

create or replace function public.sign_up(p_email text, p_password text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  session_token text;
  normalized text;
begin
  normalized := lower(btrim(p_email));
  if normalized is null or normalized !~ '^[^@]+@[^@]+\\.[^@]+$' then
    raise exception 'invalid email';
  end if;
  if p_password is null or char_length(p_password) < 8 then
    raise exception 'password too short';
  end if;
  insert into public.app_users (email, password_hash)
  values (normalized, crypt(p_password, gen_salt('bf')))
  returning id into new_id;
  insert into public.profiles (id, display_name)
  values (new_id, split_part(normalized, '@', 1));
  session_token := encode(gen_random_bytes(32), 'hex');
  insert into public.sessions (token, user_id, expires_at)
  values (session_token, new_id, now() + interval '7 days');
  return json_build_object(
    'access_token', session_token,
    'user', json_build_object('id', new_id, 'email', normalized)
  );
end;
$$;

create or replace function public.sign_in(p_email text, p_password text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  found_id uuid;
  found_hash text;
  session_token text;
  normalized text;
begin
  normalized := lower(btrim(p_email));
  select id, password_hash into found_id, found_hash
  from public.app_users
  where email = normalized;
  if found_id is null or found_hash is distinct from crypt(p_password, found_hash) then
    raise exception 'invalid credentials';
  end if;
  session_token := encode(gen_random_bytes(32), 'hex');
  insert into public.sessions (token, user_id, expires_at)
  values (session_token, found_id, now() + interval '7 days');
  return json_build_object(
    'access_token', session_token,
    'user', json_build_object('id', found_id, 'email', normalized)
  );
end;
$$;

create or replace function public.sign_out(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.sessions where token = p_token;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.get_own_profile(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  found_id uuid;
  result json;
begin
  if p_token is null or char_length(p_token) = 0 then
    return null;
  end if;
  select user_id into found_id
  from public.sessions
  where token = p_token and expires_at > now();
  if found_id is null then
    return null;
  end if;
  select json_build_object(
    'id', p.id,
    'display_name', p.display_name,
    'created_at', p.created_at
  ) into result
  from public.profiles p
  where p.id = found_id;
  return result;
end;
$$;

grant execute on function public.sign_up(text, text) to public;
grant execute on function public.sign_in(text, text) to public;
grant execute on function public.sign_out(text) to public;
grant execute on function public.get_own_profile(text) to public;
`;
}

export function supabaseInitSql(): string {
  return `-- Versioned init for a hosted Supabase project (auth.users already exists).
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select
  using (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
  on public.profiles
  for insert
  with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

grant select, insert, update on table public.profiles to authenticated;
`;
}

export function envExample(target: ProvisionTarget): string {
  if (target === 'supabase') {
    return `# Copy to .env.local (gitignored). Leave values empty in this example file.
VITE_DB_TARGET=
VITE_DATABASE_URL=
VITE_ANON_KEY=
`;
  }
  return `# Copy to .env.local (gitignored). Leave values empty in this example file.
# docker compose reads the same keys from .env.local via env_file.
VITE_DB_TARGET=
VITE_DATABASE_URL=
VITE_ANON_KEY=
POSTGRES_USER=
POSTGRES_PASSWORD=
POSTGRES_DB=
POSTGRES_PORT=
POSTGREST_PORT=
PGRST_DB_URI=
PGRST_JWT_SECRET=
`;
}

export function dockerComposeYaml(): string {
  return `services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    env_file:
      - .env.local
    ports:
      - "127.0.0.1:\${POSTGRES_PORT:-5432}:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./db/migrations:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 5s
      timeout: 5s
      retries: 10

  postgrest:
    image: postgrest/postgrest:v12.2.3
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    env_file:
      - .env.local
    environment:
      PGRST_DB_SCHEMAS: public
      PGRST_DB_ANON_ROLE: \${POSTGRES_USER}
      PGRST_OPENAPI_SERVER_PROXY_URI: http://127.0.0.1:\${POSTGREST_PORT:-3001}
    ports:
      - "127.0.0.1:\${POSTGREST_PORT:-3001}:3000"

volumes:
  postgres-data:
`;
}

export function databaseClientSource(): string {
  return `export interface ProfileRow {
  id: string;
  display_name: string | null;
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: { id: string; display_name?: string | null };
        Update: { display_name?: string | null };
      };
    };
  };
}

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthSession {
  accessToken: string;
  user: AuthUser;
}

const SESSION_KEY = 'cb.auth.session';

type PublicEnv = {
  VITE_DB_TARGET?: string;
  VITE_DATABASE_URL?: string;
  VITE_ANON_KEY?: string;
};

function readEnv(name: keyof PublicEnv): string {
  const meta = import.meta as { env?: PublicEnv };
  const fromMeta = meta.env?.[name];
  if (typeof fromMeta === 'string' && fromMeta !== '') {
    return fromMeta;
  }
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const fromProc = proc?.env?.[name];
  if (typeof fromProc === 'string' && fromProc !== '') {
    return fromProc;
  }
  return '';
}

function config(): { target: 'supabase' | 'local'; url: string; anonKey: string } {
  const rawTarget = readEnv('VITE_DB_TARGET');
  const target = rawTarget === 'supabase' ? 'supabase' : 'local';
  return {
    target,
    url: readEnv('VITE_DATABASE_URL').replace(/\\/$/, ''),
    anonKey: readEnv('VITE_ANON_KEY'),
  };
}

function storage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  const g = globalThis as { localStorage?: Storage };
  return g.localStorage ?? null;
}

export function getSession(): AuthSession | null {
  const raw = storage()?.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed?.accessToken || !parsed.user?.id || !parsed.user?.email) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function persist(session: AuthSession | null): void {
  const store = storage();
  if (!store) {
    return;
  }
  if (session) {
    store.setItem(SESSION_KEY, JSON.stringify(session));
  } else {
    store.removeItem(SESSION_KEY);
  }
}

async function parseError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const json = JSON.parse(text) as { message?: string; error?: string; hint?: string };
    return json.message || json.error || json.hint || text || response.statusText;
  } catch {
    return text || response.statusText;
  }
}

async function postJson(url: string, body: unknown, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  if (response.status === 204) {
    return null;
  }
  return response.json() as Promise<unknown>;
}

function asSession(payload: unknown): AuthSession {
  const record = payload as {
    access_token?: string;
    accessToken?: string;
    user?: { id?: string; email?: string };
  };
  const accessToken = record.access_token ?? record.accessToken;
  const id = record.user?.id;
  const email = record.user?.email;
  if (!accessToken || !id || !email) {
    throw new Error('Malformed auth response');
  }
  return { accessToken, user: { id, email } };
}

export async function signUp(email: string, password: string): Promise<AuthSession> {
  const { target, url, anonKey } = config();
  if (!url) {
    throw new Error('VITE_DATABASE_URL is not set');
  }
  const payload =
    target === 'supabase'
      ? await postJson(
          \`\${url}/auth/v1/signup\`,
          { email, password },
          { apikey: anonKey, authorization: \`Bearer \${anonKey}\` },
        )
      : await postJson(\`\${url}/rpc/sign_up\`, { p_email: email, p_password: password }, {});
  const session = asSession(payload);
  persist(session);
  return session;
}

export async function signIn(email: string, password: string): Promise<AuthSession> {
  const { target, url, anonKey } = config();
  if (!url) {
    throw new Error('VITE_DATABASE_URL is not set');
  }
  const payload =
    target === 'supabase'
      ? await postJson(
          \`\${url}/auth/v1/token?grant_type=password\`,
          { email, password },
          { apikey: anonKey, authorization: \`Bearer \${anonKey}\` },
        )
      : await postJson(\`\${url}/rpc/sign_in\`, { p_email: email, p_password: password }, {});
  const session = asSession(payload);
  persist(session);
  return session;
}

export async function signOut(): Promise<void> {
  const session = getSession();
  const { target, url, anonKey } = config();
  persist(null);
  if (!session || !url) {
    return;
  }
  try {
    if (target === 'supabase') {
      await postJson(
        \`\${url}/auth/v1/logout\`,
        {},
        { apikey: anonKey, authorization: \`Bearer \${session.accessToken}\` },
      );
    } else {
      await postJson(\`\${url}/rpc/sign_out\`, { p_token: session.accessToken }, {});
    }
  } catch {
    // Session already cleared locally.
  }
}

export async function fetchOwnProfile(): Promise<ProfileRow | null> {
  const session = getSession();
  const { target, url, anonKey } = config();
  if (!session || !url) {
    return null;
  }
  if (target === 'supabase') {
    const headers: Record<string, string> = {
      authorization: \`Bearer \${session.accessToken}\`,
    };
    if (anonKey) {
      headers.apikey = anonKey;
    }
    const response = await fetch(
      \`\${url}/rest/v1/profiles?id=eq.\${encodeURIComponent(session.user.id)}&select=id,display_name,created_at\`,
      { headers },
    );
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    const rows = (await response.json()) as ProfileRow[];
    return rows[0] ?? null;
  }
  const payload = await postJson(
    \`\${url}/rpc/get_own_profile\`,
    { p_token: session.accessToken },
    {},
  );
  if (payload === null || typeof payload !== 'object') {
    return null;
  }
  const row = payload as ProfileRow;
  if (!row.id) {
    return null;
  }
  return row;
}
`;
}

export function signInPageSource(): string {
  return `import { useState } from 'react';
import { signIn, type AuthSession } from '../../lib/database';

export function SignInPage(props: {
  onSuccess: (session: AuthSession) => void;
  onSwitch: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: { preventDefault: () => void }): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await signIn(email, password);
      props.onSuccess(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Sign in</h1>
      <form onSubmit={onSubmit}>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event: { target: { value: string } }) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event: { target: { value: string } }) => setPassword(event.target.value)}
            required
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p>
        <button type="button" onClick={props.onSwitch}>
          Create an account
        </button>
      </p>
    </main>
  );
}
`;
}

export function signUpPageSource(): string {
  return `import { useState } from 'react';
import { signUp, type AuthSession } from '../../lib/database';

export function SignUpPage(props: {
  onSuccess: (session: AuthSession) => void;
  onSwitch: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: { preventDefault: () => void }): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await signUp(email, password);
      props.onSuccess(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Create an account</h1>
      <form onSubmit={onSubmit}>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event: { target: { value: string } }) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(event: { target: { value: string } }) => setPassword(event.target.value)}
            required
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Sign up'}
        </button>
      </form>
      <p>
        <button type="button" onClick={props.onSwitch}>
          I already have an account
        </button>
      </p>
    </main>
  );
}
`;
}

export function signOutPageSource(): string {
  return `import { useState } from 'react';
import { signOut } from '../../lib/database';

export function SignOutButton(props: { onSignedOut: () => void }) {
  const [busy, setBusy] = useState(false);

  async function onClick(): Promise<void> {
    setBusy(true);
    try {
      await signOut();
      props.onSignedOut();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={onClick} disabled={busy}>
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
`;
}

export function authAppSource(): string {
  return `import { useEffect, useState } from 'react';
import { fetchOwnProfile, getSession, type AuthSession } from '../lib/database';
import { SignInPage } from './pages/SignIn';
import { SignUpPage } from './pages/SignUp';
import { SignOutButton } from './pages/SignOut';

type View = 'signin' | 'signup' | 'home';

export default function AuthApp() {
  const [session, setSession] = useState<AuthSession | null>(getSession());
  const [view, setView] = useState<View>(session ? 'home' : 'signin');
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      setDisplayName(null);
      return;
    }
    let cancelled = false;
    fetchOwnProfile()
      .then((profile) => {
        if (!cancelled) {
          setDisplayName(profile?.display_name ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDisplayName(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (!session && view === 'signup') {
    return (
      <SignUpPage
        onSuccess={(next: AuthSession) => {
          setSession(next);
          setView('home');
        }}
        onSwitch={() => setView('signin')}
      />
    );
  }

  if (!session) {
    return (
      <SignInPage
        onSuccess={(next: AuthSession) => {
          setSession(next);
          setView('home');
        }}
        onSwitch={() => setView('signup')}
      />
    );
  }

  return (
    <main>
      <h1>Signed in</h1>
      <p>{displayName ?? session.user.email}</p>
      <SignOutButton
        onSignedOut={() => {
          setSession(null);
          setView('signin');
        }}
      />
    </main>
  );
}
`;
}

export function defaultMainSource(): string {
  return `import React from 'react';
import ReactDOM from 'react-dom/client';
import AuthApp from './auth/AuthApp';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthApp />
  </React.StrictMode>
);
`;
}

export function defaultIndexCss(): string {
  return `:root {
  font-family: Inter, system-ui, sans-serif;
  line-height: 1.5;
  color: #213547;
  background: #fff;
}
main {
  max-width: 28rem;
  margin: 3rem auto;
  display: grid;
  gap: 1rem;
}
label {
  display: grid;
  gap: 0.35rem;
  text-align: left;
}
input, button {
  font: inherit;
  padding: 0.5rem 0.7rem;
}
`;
}

export function gitignoreSnippet(): string {
  return `.env
.env.local
`;
}

export function dbReadme(target: ProvisionTarget): string {
  if (target === 'supabase') {
    return `# Database + auth (Supabase)

This overlay does **not** create a hosted project. With a local \`supabase\` CLI and \`SUPABASE_ACCESS_TOKEN\`, re-run with \`--apply\` to write files only.

Manual steps after apply:

1. Create the project yourself in the Supabase dashboard (or \`supabase projects create\` — never run by Code Buddy).
2. Put the project URL and anon key in \`.env.local\` (never commit it).
3. Apply \`supabase/migrations/0001_init.sql\` with the CLI you already use (\`supabase db push\` or the SQL editor).
`;
  }
  return `# Database + auth (local Postgres container)

No remote account. After \`--apply\`:

1. \`docker compose up -d\` from this directory (needs Docker; not started by Code Buddy).
2. Init SQL in \`db/migrations/\` is mounted into \`docker-entrypoint-initdb.d\`.
3. App talks to PostgREST at \`VITE_DATABASE_URL\` from \`.env.local\`.
4. Local sessions are opaque tokens (not PostgREST JWTs). Profile reads go through \`/rpc/get_own_profile\`.
`;
}

export function wireMainTsx(existing: string | null): string {
  if (!existing) {
    return defaultMainSource();
  }
  if (existing.includes('./auth/AuthApp')) {
    return existing;
  }
  let next = existing.replace(/import App from ['"]\.\/App['"];?/, "import AuthApp from './auth/AuthApp';");
  next = next.replace(/<App(\s*\/>|><\/App>)/g, '<AuthApp />');
  if (next === existing) {
    return `${existing.replace(/\s*$/, '')}

// Auth overlay: mount <AuthApp /> from './auth/AuthApp' in place of the root component.
`;
  }
  return next;
}

export function mergeGitignore(existing: string | null): string {
  const base = existing ?? '';
  const lines = new Set(base.split(/\r?\n/).map((line) => line.trimEnd()));
  let next = base;
  if (!lines.has('.env.local')) {
    next = next.endsWith('\n') || next === '' ? next : `${next}\n`;
    next += '.env.local\n';
  }
  if (!lines.has('.env')) {
    next = next.endsWith('\n') || next === '' ? next : `${next}\n`;
    next += '.env\n';
  }
  return next;
}

export function mergeEnvExample(existing: string | null, target: ProvisionTarget): string {
  const generated = envExample(target);
  if (!existing || existing.trim() === '') {
    return generated;
  }
  const have = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => line.split('=')[0]?.trim())
      .filter((key): key is string => typeof key === 'string' && key.length > 0 && !key.startsWith('#')),
  );
  const extras = generated
    .split('\n')
    .filter((line) => {
      const key = line.split('=')[0]?.trim();
      if (!key || key.startsWith('#') || line.trim() === '') {
        return false;
      }
      return !have.has(key);
    });
  if (extras.length === 0) {
    return existing.endsWith('\n') ? existing : `${existing}\n`;
  }
  const prefix = existing.endsWith('\n') ? existing : `${existing}\n`;
  return `${prefix}# database + auth overlay\n${extras.join('\n')}\n`;
}
