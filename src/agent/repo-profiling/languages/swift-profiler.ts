/**
 * Swift / iOS profiler.
 *
 * Detects Swift Package Manager (Package.swift), Xcode projects, CocoaPods.
 */

import fs from 'fs';
import path from 'path';
import type { LanguageProfiler } from './language-profiler.js';
import type { ProfilingContext } from '../types.js';
import type { FsHelpers } from '../fs-helpers.js';

export const swiftProfiler: LanguageProfiler = {
  id: 'swift',

  detect(ctx: ProfilingContext, fsh: FsHelpers): boolean {
    const packageSwift = path.join(ctx.cwd, 'Package.swift');
    const hasSPM = fsh.exists(packageSwift);
    const xcodeprojs = fsh.glob(ctx.cwd, '*.xcodeproj');
    const xcworkspaces = fsh.glob(ctx.cwd, '*.xcworkspace');
    const hasPodfile = fsh.exists(path.join(ctx.cwd, 'Podfile'));
    const hasXcode = xcodeprojs.length > 0 || xcworkspaces.length > 0;

    if (!hasSPM && !hasXcode) return false;

    ctx.languages.push('Swift');

    if (hasSPM) {
      ctx.packageManager = ctx.packageManager || 'swift';
      ctx.configMtime = ctx.configMtime || fsh.mtime(packageSwift);
      ctx.commands.test = ctx.commands.test || 'swift test';
      ctx.commands.build = ctx.commands.build || 'swift build';
    } else if (hasPodfile) {
      ctx.packageManager = ctx.packageManager || 'cocoapods';
      ctx.configMtime = ctx.configMtime || fsh.mtime(path.join(ctx.cwd, 'Podfile'));
      ctx.commands.build = ctx.commands.build || 'xcodebuild';
    } else {
      ctx.packageManager = ctx.packageManager || 'swift';
      if (xcodeprojs.length > 0) ctx.configMtime = ctx.configMtime || fsh.mtime(path.join(ctx.cwd, xcodeprojs[0]));
      ctx.commands.build = ctx.commands.build || 'xcodebuild';
    }

    ctx.commands.lint = ctx.commands.lint || 'swiftlint';
    ctx.commands.format = ctx.commands.format || 'swiftformat .';

    return true;
  },

  profile(ctx: ProfilingContext, fsh: FsHelpers): void {
    if (!ctx.languages.includes('Swift')) return;

    const packageSwift = path.join(ctx.cwd, 'Package.swift');

    // Parse Package.swift for name and dependencies
    if (fsh.exists(packageSwift)) {
      try {
        const content = fs.readFileSync(packageSwift, 'utf-8');

        // Project name
        if (!ctx.projectName) {
          const nameMatch = content.match(/name:\s*"([^"]+)"/);
          if (nameMatch) ctx.projectName = nameMatch[1];
        }

        // Swift tools version
        const toolsMatch = content.match(/swift-tools-version:\s*([0-9.]+)/);
        if (toolsMatch) ctx.nodeVersion = ctx.nodeVersion || `Swift tools ${toolsMatch[1]}`;

        // Dependencies from .package(url:)
        const pkgDeps = [...content.matchAll(/\.package\s*\(\s*url:\s*"[^"]*\/([^"/]+?)(?:\.git)?"/g)];
        const swiftNotable = new Set([
          'Alamofire', 'Moya', 'Kingfisher', 'SnapKit', 'RxSwift',
          'Combine', 'SwiftNIO', 'Vapor', 'Kitura', 'Perfect',
          'swift-argument-parser', 'swift-log', 'swift-metrics',
          'swift-protobuf', 'grpc-swift',
          'Realm', 'GRDB', 'SQLite.swift', 'CoreStore',
          'Quick', 'Nimble', 'XCTest',
          'PointFree', 'ComposableArchitecture', 'TCA',
          'Swinject', 'Factory',
          'Lottie', 'Hero', 'IQKeyboardManager',
        ]);
        for (const [, dep] of pkgDeps) {
          if (swiftNotable.has(dep) && !ctx.keyDependencies.includes(dep)) {
            ctx.keyDependencies.push(dep);
          }
        }

        // Framework detection
        if (!ctx.framework) {
          if (content.includes('Vapor') || ctx.keyDependencies.includes('Vapor')) ctx.framework = 'Vapor (server)';
          else if (content.includes('ComposableArchitecture') || content.includes('TCA')) ctx.framework = 'SwiftUI + TCA';
        }
      } catch { /* ignore */ }
    }

    // Detect SwiftUI vs UIKit from source files
    if (!ctx.framework) {
      const srcDirs = ['Sources', 'src', ctx.projectName].filter(Boolean) as string[];
      for (const dir of srcDirs) {
        const dirPath = path.join(ctx.cwd, dir);
        if (!fsh.exists(dirPath)) continue;
        try {
          const files = fs.readdirSync(dirPath, { recursive: true }) as string[];
          const swiftFiles = files.filter(f => String(f).endsWith('.swift')).slice(0, 20);
          let swiftUICount = 0;
          let uiKitCount = 0;
          for (const file of swiftFiles) {
            try {
              const content = fs.readFileSync(path.join(dirPath, String(file)), 'utf-8').slice(0, 2000);
              if (content.includes('import SwiftUI')) swiftUICount++;
              if (content.includes('import UIKit')) uiKitCount++;
            } catch { /* ignore */ }
          }
          if (swiftUICount > 0 || uiKitCount > 0) {
            ctx.framework = swiftUICount >= uiKitCount ? 'SwiftUI' : 'UIKit';
            break;
          }
        } catch { /* ignore */ }
      }
    }

    // Platform detection from Xcode project structure
    const platforms: string[] = [];
    if (fsh.exists(path.join(ctx.cwd, 'ios')) || fsh.glob(ctx.cwd, '*.xcodeproj').length > 0) platforms.push('iOS');
    if (fsh.exists(path.join(ctx.cwd, 'macos')) || fsh.exists(path.join(ctx.cwd, 'macOS'))) platforms.push('macOS');
    if (fsh.exists(path.join(ctx.cwd, 'watchos')) || fsh.exists(path.join(ctx.cwd, 'watchOS'))) platforms.push('watchOS');
    if (fsh.exists(path.join(ctx.cwd, 'tvos')) || fsh.exists(path.join(ctx.cwd, 'tvOS'))) platforms.push('tvOS');
    if (fsh.exists(path.join(ctx.cwd, 'visionos')) || fsh.exists(path.join(ctx.cwd, 'visionOS'))) platforms.push('visionOS');

    if (platforms.length > 1 && ctx.framework) {
      ctx.framework = `${ctx.framework} (${platforms.join(', ')})`;
    }

    // CocoaPods dependencies
    const podfilePath = path.join(ctx.cwd, 'Podfile');
    if (fsh.exists(podfilePath)) {
      try {
        const podContent = fs.readFileSync(podfilePath, 'utf-8');
        const pods = [...podContent.matchAll(/pod\s+['"]([^'"]+)['"]/g)];
        const podNotable = new Set([
          'Alamofire', 'SwiftyJSON', 'Kingfisher', 'SnapKit', 'RxSwift', 'RxCocoa',
          'Firebase', 'FirebaseAuth', 'FirebaseFirestore',
          'Realm', 'RealmSwift', 'MBProgressHUD', 'SVProgressHUD',
          'Moya', 'ObjectMapper', 'R.swift', 'SwiftLint',
          'lottie-ios', 'Hero', 'IQKeyboardManagerSwift',
        ]);
        for (const [, pod] of pods) {
          const basePod = pod.split('/')[0]; // Handle subspecs like Firebase/Auth
          if (podNotable.has(basePod) && !ctx.keyDependencies.includes(basePod)) {
            ctx.keyDependencies.push(basePod);
          }
        }
      } catch { /* ignore */ }
    }

    // Project name fallback from xcodeproj
    if (!ctx.projectName) {
      const xcodeprojs = fsh.glob(ctx.cwd, '*.xcodeproj');
      if (xcodeprojs.length > 0) {
        ctx.projectName = xcodeprojs[0].replace('.xcodeproj', '');
      }
    }

    // Conventions
    if (!ctx.conventions.naming) ctx.conventions.naming = 'camelCase (Swift)';
    if (!ctx.linter) {
      if (fsh.exists(path.join(ctx.cwd, '.swiftlint.yml'))) ctx.linter = 'SwiftLint';
    }
    if (!ctx.formatter) {
      if (fsh.exists(path.join(ctx.cwd, '.swiftformat'))) ctx.formatter = 'SwiftFormat';
    }

    // Test framework
    if (!ctx.testFramework) {
      if (ctx.keyDependencies.includes('Quick')) ctx.testFramework = 'Quick + Nimble';
      else ctx.testFramework = 'XCTest';
    }

    // Entry points
    if (ctx.entryPoints.length === 0) {
      for (const f of ['Sources/main.swift', 'Sources/App/main.swift', `Sources/${ctx.projectName || 'App'}/App.swift`]) {
        if (fsh.exists(path.join(ctx.cwd, f))) { ctx.entryPoints.push(f); break; }
      }
    }
  },
};
