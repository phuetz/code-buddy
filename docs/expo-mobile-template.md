# Expo / React Native mobile starter (`expo-rn`)

The built-in project templates previously supported web and Node.js applications only (`react-ts`, `react-tailwind`, `express-api`, `node-cli`). Asking App Studio or the scaffolding engine for a mobile project previously defaulted to a web layout.

The **`expo-rn`** template introduces a native mobile starter registered under category `mobile`.

## Template Capabilities

The template generates an Expo SDK 52 application structured with:

- **Expo Router:** File-based navigation with tab navigation (`app/(tabs)/`) and detail routes (`app/item/`).
- **Theming:** Light and dark theme palettes (`src/theme/`).
- **Network Sample:** Typed API client with mockable requests (`src/api/`).
- **Unit Tests:** Vitest test suite configured out of the box (`tests/`).
- **EAS Stub:** Minimal `eas.json` build profile stub for future cloud build configuration (**config only**).

Generated `package.json` scripts:
```json
{
  "scripts": {
    "dev": "expo start --web",
    "start": "expo start",
    "android": "expo start --android",
    "ios": "expo start --ios",
    "web": "expo start --web",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

## How to use it

There is **no** `buddy expo` command in the CLI. The command line does not expose an `expo` subcommand:

```bash
$ buddy expo --help
# Displays root CLI help; "expo" is not a standalone CLI command.
```

To scaffold an Expo project, use either:

### 1. Agent Tool (`scaffold_app`)
Invoke the `scaffold_app` tool from an agent session with:
```json
{
  "template": "expo-rn",
  "targetDir": "./my-mobile-app",
  "description": "Cross-platform mobile client"
}
```

### 2. Cowork App Studio
In Cowork's App Studio composer, any prompt containing one of the following intent keywords automatically selects the `expo-rn` template instead of the web default:
- `expo`
- `react native`
- `mobile`
- `android`
- `ios`
- `apk`

### Working with the generated project

In the scaffolded directory:
```bash
npm install        # Install Expo dependencies (requires network on cold cache)
npm run typecheck  # Verify TypeScript types
npm test           # Run unit tests
npm run dev        # Launch Metro web dev server
npm run start      # Launch Expo interactive dev tools for iOS/Android emulators
```

## What this feature does NOT do

- **Does NOT add a `buddy expo` CLI command:** Scaffolding is accessed through the `scaffold_app` agent tool or Cowork App Studio.
- **Does NOT create an Expo or EAS account:** No authentication or account creation is performed.
- **Does NOT execute cloud EAS builds:** `eas.json` is a configuration template only; `eas build` is never initiated.
- **Does NOT produce native APK or IPA binaries:** Code Buddy generates TypeScript/React Native source files; binary compilation requires the Expo CLI, Android SDK, or Xcode.
- **Does NOT publish to app stores:** Does not deploy to Google Play or the Apple App Store.
- **Does NOT work offline with an empty npm cache:** Dependencies must be installed via `npm install`, which requires network access unless cached locally.
- **Does NOT deploy via `buddy deploy run`:** `buddy deploy run` publishes web static bundles to Cloudflare Pages or Netlify; it does not deploy mobile native applications.
