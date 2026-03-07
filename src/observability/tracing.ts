/**
 * Tracing Provider
 *
 * Initializes OpenTelemetry for distributed tracing.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { logger } from '../utils/logger.js';

let sdk: NodeSDK | null = null;

export async function initTracing(): Promise<void> {
  if (sdk) {
    return;
  }

  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  
  if (!otlpEndpoint) {
     logger.debug('OpenTelemetry tracing disabled (OTEL_EXPORTER_OTLP_ENDPOINT not set)');
     return;
  }

  try {
    const traceExporter = new OTLPTraceExporter({
      url: `${otlpEndpoint}/v1/traces`,
      // Add authentication headers if needed via environment variables
    });

    sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: 'codebuddy',
        [ATTR_SERVICE_VERSION]: process.env.npm_package_version || 'unknown',
      }),
      traceExporter,
      instrumentations: [
        new HttpInstrumentation(),
        // Add more instrumentations here (e.g., Express, SQLite if used)
      ],
    });

    sdk.start();
    logger.info('OpenTelemetry tracing initialized', { endpoint: otlpEndpoint });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      sdk?.shutdown()
        .then(() => logger.info('OpenTelemetry tracing shut down'))
        .catch((error) => logger.error('Error shutting down OpenTelemetry tracing', { error }));
    });

  } catch (error) {
     logger.error('Failed to initialize OpenTelemetry tracing', { error });
  }
}
