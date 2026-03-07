/**
 * Observability module - Metrics dashboard and monitoring
 */

import * as Sentry from '@sentry/node';
import { logger } from '../utils/logger.js';
import { initTracing } from './tracing.js';

export * from "./dashboard.js";
export * from "./tracing.js";

let isSentryInitialized = false;

export function initObservability() {
  // Initialize OpenTelemetry
  initTracing();

  // Initialize Sentry
  if (!isSentryInitialized && process.env.SENTRY_DSN) {
    try {
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || 'development',
        release: process.env.npm_package_version,
        tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
      });
      isSentryInitialized = true;
      logger.info('Sentry initialized');
    } catch (error) {
      logger.error('Failed to initialize Sentry', { error });
    }
  }
}
