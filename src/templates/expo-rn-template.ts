/**
 * Expo / React Native starter for the TemplateEngine.
 *
 * Same descriptor shape as the built-in web/api/cli templates: variables,
 * directories, interpolated files, postGenerate npm install + git init.
 * EAS is config-only (no account, no build).
 */
import type { ProjectTemplate } from './project-scaffolding.js';

export const EXPO_RN_TEMPLATE: ProjectTemplate = {
  name: 'expo-rn',
  description:
    'Expo React Native app with tab navigation, list/detail screens, light/dark themes, a sample network call, unit tests, and minimal EAS config (no account, no build)',
  category: 'mobile',
  version: '1.0.0',
  variables: [
    {
      name: 'description',
      description: 'Project description',
      type: 'string',
      default: 'An Expo React Native application',
    },
  ],
  directories: [
    'app',
    'app/(tabs)',
    'app/item',
    'src',
    'src/api',
    'src/theme',
    'tests',
  ],
  files: [
    {
      path: 'package.json',
      content: `{
  "name": "{{projectName}}",
  "version": "0.1.0",
  "private": true,
  "description": "{{description}}",
  "main": "expo-router/entry",
  "scripts": {
    "dev": "expo start --web",
    "start": "expo start",
    "android": "expo start --android",
    "ios": "expo start --ios",
    "web": "expo start --web",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@expo/metro-runtime": "~4.0.1",
    "@react-navigation/native": "^7.0.14",
    "expo": "~52.0.47",
    "expo-asset": "~11.0.5",
    "expo-constants": "~17.0.8",
    "expo-linking": "~7.0.5",
    "expo-router": "~4.0.21",
    "expo-status-bar": "~2.0.1",
    "expo-system-ui": "~4.0.9",
    "query-string": "^7.1.3",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "react-native": "0.76.9",
    "react-native-safe-area-context": "4.12.0",
    "react-native-screens": "~4.4.0",
    "react-native-web": "~0.19.13"
  },
  "devDependencies": {
    "@babel/core": "^7.25.2",
    "@types/react": "~18.3.12",
    "typescript": "~5.3.3",
    "vitest": "^2.1.9"
  }
}
`,
    },
    {
      path: 'app.json',
      content: `{
  "expo": {
    "name": "{{projectName}}",
    "slug": "{{projectName}}",
    "scheme": "{{projectName}}",
    "version": "1.0.0",
    "orientation": "portrait",
    "userInterfaceStyle": "automatic",
    "ios": {
      "supportsTablet": true
    },
    "android": {
      "adaptiveIcon": {
        "backgroundColor": "#0F172A"
      }
    },
    "web": {
      "bundler": "metro",
      "output": "single"
    },
    "plugins": [
      "expo-router"
    ],
    "experiments": {
      "typedRoutes": true
    }
  }
}
`,
    },
    {
      path: 'eas.json',
      content: `{
  "cli": {
    "version": ">= 13.2.0",
    "appVersionSource": "local",
    "requireCommit": false
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": {
        "simulator": true
      }
    },
    "preview": {
      "distribution": "internal"
    },
    "production": {
      "autoIncrement": false
    }
  },
  "submit": {
    "production": {}
  }
}
`,
    },
    {
      path: 'tsconfig.json',
      content: `{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true
  },
  "include": [
    "**/*.ts",
    "**/*.tsx",
    ".expo/types/**/*.ts",
    "expo-env.d.ts"
  ],
  "exclude": [
    "node_modules"
  ]
}
`,
    },
    {
      path: 'babel.config.js',
      content: `module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
`,
    },
    {
      path: 'vitest.config.ts',
      content: `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
`,
    },
    {
      path: 'expo-env.d.ts',
      content: `/// <reference types="expo/types" />
`,
    },
    {
      path: 'index.ts',
      content: `export { CATALOG_URL, SAMPLE_ITEMS, loadCatalog, parseCatalog } from './src/api/catalog';
export type { CatalogItem } from './src/api/catalog';
export { palettes, resolveScheme } from './src/theme/tokens';
export type { ColorScheme, ThemePalette } from './src/theme/tokens';
`,
    },
    {
      path: 'src/api/catalog.ts',
      content: `export interface CatalogItem {
  id: string;
  title: string;
  body: string;
}

export const CATALOG_URL = 'https://jsonplaceholder.typicode.com/posts?_limit=8';

export const SAMPLE_ITEMS: CatalogItem[] = [
  {
    id: '1',
    title: 'Welcome to {{projectName}}',
    body: 'Offline sample item. The list screen tries a network catalog first, then falls back here.',
  },
  {
    id: '2',
    title: 'List and detail',
    body: 'Tap a row to open the detail screen. Navigation uses Expo Router tabs plus a stack route.',
  },
  {
    id: '3',
    title: 'Light and dark',
    body: 'The About tab can pin light, dark, or follow the system color scheme.',
  },
];

export function parseCatalog(payload: unknown): CatalogItem[] {
  if (!Array.isArray(payload)) {
    throw new Error('Catalog payload must be an array');
  }

  return payload.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(\`Catalog item \${index} is not an object\`);
    }
    const record = entry as Record<string, unknown>;
    const id = record.id;
    const title = record.title;
    const body = typeof record.body === 'string' ? record.body : typeof record.excerpt === 'string' ? record.excerpt : '';
    if (typeof title !== 'string' || title.trim() === '') {
      throw new Error(\`Catalog item \${index} is missing a title\`);
    }
    return {
      id: id === undefined ? String(index + 1) : String(id),
      title: title.trim(),
      body,
    };
  });
}

export type CatalogFetcher = (
  input: string,
  init?: { method?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export async function loadCatalog(fetcher: CatalogFetcher): Promise<CatalogItem[]> {
  try {
    const response = await fetcher(CATALOG_URL, { method: 'GET' });
    if (!response.ok) {
      throw new Error(\`Catalog HTTP \${response.status}\`);
    }
    return parseCatalog(await response.json());
  } catch {
    return SAMPLE_ITEMS;
  }
}
`,
    },
    {
      path: 'src/theme/tokens.ts',
      content: `export type ColorScheme = 'light' | 'dark';

export interface ThemePalette {
  canvas: string;
  ink: string;
  muted: string;
  accent: string;
  accentContrast: string;
  card: string;
  border: string;
}

export const palettes: Record<ColorScheme, ThemePalette> = {
  light: {
    canvas: '#F8FAFC',
    ink: '#0F172A',
    muted: '#475569',
    accent: '#2563EB',
    accentContrast: '#FFFFFF',
    card: '#FFFFFF',
    border: '#CBD5E1',
  },
  dark: {
    canvas: '#0F172A',
    ink: '#F8FAFC',
    muted: '#94A3B8',
    accent: '#60A5FA',
    accentContrast: '#0F172A',
    card: '#1E293B',
    border: '#334155',
  },
};

export type ThemePreference = ColorScheme | 'system';

export function resolveScheme(preference: ThemePreference, systemScheme: ColorScheme): ColorScheme {
  return preference === 'system' ? systemScheme : preference;
}
`,
    },
    {
      path: 'src/theme/theme-context.tsx',
      content: `import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { palettes, resolveScheme, type ColorScheme, type ThemePalette, type ThemePreference } from './tokens';

interface ThemeContextValue {
  preference: ThemePreference;
  scheme: ColorScheme;
  palette: ThemePalette;
  setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [preference, setPreference] = useState<ThemePreference>('system');
  const value = useMemo(() => {
    const scheme = resolveScheme(preference, system);
    return { preference, scheme, palette: palettes[scheme], setPreference };
  }, [preference, system]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useAppTheme must be used inside ThemeProvider');
  }
  return value;
}
`,
    },
    {
      path: 'app/_layout.tsx',
      content: `import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ThemeProvider, useAppTheme } from '../src/theme/theme-context';

function RootNavigator() {
  const { scheme, palette } = useAppTheme();
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: palette.card },
          headerTintColor: palette.ink,
          contentStyle: { backgroundColor: palette.canvas },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="item/[id]" options={{ title: 'Detail' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootNavigator />
    </ThemeProvider>
  );
}
`,
    },
    {
      path: 'app/(tabs)/_layout.tsx',
      content: `import { Tabs } from 'expo-router';
import { useAppTheme } from '../../src/theme/theme-context';

export default function TabsLayout() {
  const { palette } = useAppTheme();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: palette.card },
        headerTintColor: palette.ink,
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.muted,
        tabBarStyle: { backgroundColor: palette.card, borderTopColor: palette.border },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Feed', tabBarLabel: 'Feed' }} />
      <Tabs.Screen name="about" options={{ title: 'About', tabBarLabel: 'About' }} />
    </Tabs>
  );
}
`,
    },
    {
      path: 'app/(tabs)/index.tsx',
      content: `import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { loadCatalog, type CatalogItem } from '../../src/api/catalog';
import { useAppTheme } from '../../src/theme/theme-context';

export default function FeedScreen() {
  const router = useRouter();
  const { palette } = useAppTheme();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromNetwork, setFromNetwork] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadCatalog(fetch).then((catalog) => {
      if (cancelled) return;
      setItems(catalog);
      setFromNetwork(catalog[0]?.body !== undefined && !catalog[0].body.includes('Offline sample item'));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: palette.canvas }]}>
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: palette.canvas }}
      contentContainerStyle={styles.list}
      data={items}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={
        <Text style={[styles.hint, { color: palette.muted }]}>
          {fromNetwork ? 'Loaded from the example catalog API.' : 'Showing the offline sample catalog (network unavailable).'}
        </Text>
      }
      renderItem={({ item }) => (
        <Pressable
          onPress={() => router.push(\`/item/\${item.id}?title=\${encodeURIComponent(item.title)}&body=\${encodeURIComponent(item.body)}\`)}
          style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}
        >
          <Text style={[styles.title, { color: palette.ink }]}>{item.title}</Text>
          <Text style={[styles.body, { color: palette.muted }]} numberOfLines={2}>
            {item.body}
          </Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 12 },
  hint: { marginBottom: 8, fontSize: 13 },
  card: { borderWidth: 1, borderRadius: 12, padding: 16 },
  title: { fontSize: 16, fontWeight: '600', marginBottom: 6 },
  body: { fontSize: 14, lineHeight: 20 },
});
`,
    },
    {
      path: 'app/(tabs)/about.tsx',
      content: `import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../../src/theme/theme-context';
import type { ThemePreference } from '../../src/theme/tokens';

const OPTIONS: ThemePreference[] = ['system', 'light', 'dark'];

export default function AboutScreen() {
  const { palette, preference, scheme, setPreference } = useAppTheme();

  return (
    <View style={[styles.screen, { backgroundColor: palette.canvas }]}>
      <Text style={[styles.title, { color: palette.ink }]}>{{projectName}}</Text>
      <Text style={[styles.body, { color: palette.muted }]}>{{description}}</Text>
      <Text style={[styles.meta, { color: palette.muted }]}>Active scheme: {scheme}</Text>
      <View style={styles.row}>
        {OPTIONS.map((option) => {
          const selected = preference === option;
          return (
            <Pressable
              key={option}
              onPress={() => setPreference(option)}
              style={[
                styles.chip,
                {
                  backgroundColor: selected ? palette.accent : palette.card,
                  borderColor: palette.border,
                },
              ]}
            >
              <Text style={{ color: selected ? palette.accentContrast : palette.ink }}>{option}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 22 },
  meta: { fontSize: 13 },
  row: { flexDirection: 'row', gap: 8, marginTop: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
});
`,
    },
    {
      path: 'app/item/[id].tsx',
      content: `import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SAMPLE_ITEMS } from '../../src/api/catalog';
import { useAppTheme } from '../../src/theme/theme-context';

export default function ItemDetailScreen() {
  const { palette } = useAppTheme();
  const params = useLocalSearchParams<{ id: string; title?: string; body?: string }>();
  const item = useMemo(() => {
    const fallback = SAMPLE_ITEMS.find((entry) => entry.id === params.id);
    return {
      id: params.id,
      title: typeof params.title === 'string' && params.title ? params.title : fallback?.title ?? 'Unknown item',
      body: typeof params.body === 'string' && params.body ? params.body : fallback?.body ?? 'No details available.',
    };
  }, [params.body, params.id, params.title]);

  return (
    <ScrollView style={{ backgroundColor: palette.canvas }} contentContainerStyle={styles.content}>
      <Text style={[styles.kicker, { color: palette.muted }]}>Item {item.id}</Text>
      <Text style={[styles.title, { color: palette.ink }]}>{item.title}</Text>
      <Text style={[styles.body, { color: palette.ink }]}>{item.body}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, gap: 12 },
  kicker: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  title: { fontSize: 22, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 24 },
});
`,
    },
    {
      path: 'tests/catalog.test.ts',
      content: `import { describe, expect, it, vi } from 'vitest';
import { CATALOG_URL, SAMPLE_ITEMS, loadCatalog, parseCatalog } from '../src/api/catalog';

describe('parseCatalog', () => {
  it('maps a JSON payload to catalog items', () => {
    expect(
      parseCatalog([
        { id: 11, title: ' Alpha ', body: 'Hello' },
        { id: '12', title: 'Beta', excerpt: 'World' },
      ]),
    ).toEqual([
      { id: '11', title: 'Alpha', body: 'Hello' },
      { id: '12', title: 'Beta', body: 'World' },
    ]);
  });

  it('rejects a non-array payload', () => {
    expect(() => parseCatalog({ title: 'nope' })).toThrow(/array/);
  });
});

describe('loadCatalog', () => {
  it('uses the injected fetcher and never talks to the network in tests', async () => {
    const fetcher = vi.fn(async (input: string) => {
      expect(input).toBe(CATALOG_URL);
      return {
        ok: true,
        status: 200,
        json: async () => [{ id: 7, title: 'Remote', body: 'From mock' }],
      };
    });

    await expect(loadCatalog(fetcher)).resolves.toEqual([{ id: '7', title: 'Remote', body: 'From mock' }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('falls back to the sample catalog when the fetcher fails', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('offline');
    });

    await expect(loadCatalog(fetcher)).resolves.toEqual(SAMPLE_ITEMS);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
`,
    },
    {
      path: 'tests/theme.test.ts',
      content: `import { describe, expect, it } from 'vitest';
import { palettes, resolveScheme } from '../src/theme/tokens';

describe('theme tokens', () => {
  it('exposes distinct light and dark palettes', () => {
    expect(palettes.light.canvas).not.toBe(palettes.dark.canvas);
    expect(palettes.light.ink).not.toBe(palettes.dark.ink);
    expect(palettes.light.accent).toMatch(/^#/);
  });

  it('resolves system preference to the host scheme', () => {
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('light', 'dark')).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');
  });
});
`,
    },
    {
      path: '.gitignore',
      content: `node_modules/
.expo/
dist/
web-build/
*.log
.DS_Store
.env
.env.*
coverage/
`,
    },
    {
      path: 'README.md',
      content: `# {{projectName}}

{{description}}

Expo / React Native starter generated by Code Buddy.

## What you get

- Tab navigation (Feed + About) via Expo Router
- List screen and detail screen
- Light / dark / system theme
- Example catalog fetch with an offline sample fallback
- Unit tests (Vitest, injected fetcher — no network)
- Minimal EAS config in \`eas.json\` — **no Expo account and no real build**

## Commands

\`\`\`bash
npm install
npm run typecheck
npm test
npm run web
\`\`\`

\`npm run web\` starts the Metro web bundler (default port 8081). Pass \`-- --port <n>\` for a disposable port.

## Offline install

\`npm install --prefer-offline --no-audit --no-fund\` reuses the local npm cache when the Expo SDK packages are already present. A **first** install of Expo / React Native / Metro **requires the npm registry** (those packages are not vendored in this template). Telemetry is not required.

## EAS (config only)

\`eas.json\` declares development / preview / production profiles so the project is ready later. Do **not** run \`eas login\` or \`eas build\` from this template: there is no \`extra.eas.projectId\`, no credentials, and no submit secrets. Building a binary is out of scope.
`,
    },
  ],
  postGenerate: [
    {
      name: 'Install dependencies',
      command: 'npm',
      args: ['install'],
    },
    {
      name: 'Initialize git',
      command: 'git',
      args: ['init'],
    },
  ],
};
