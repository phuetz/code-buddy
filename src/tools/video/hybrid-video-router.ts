/** Routing policy for the MySoulmate hybrid image/video production fleet. */

export type ContentTier = 'safe' | 'sensual' | 'explicit';
export type HybridVideoUseCase =
  | 'avatar-lipsync'
  | 'bulk-variation'
  | 'hero-shot'
  | 'long-form-b-roll'
  | 'transition';
export type HybridVideoEngine =
  | 'darkstar-longcat'
  | 'darkstar-comfyui'
  | 'ministar-comfyui'
  | 'google-flow-veo31-lite'
  | 'google-flow-veo31-fast'
  | 'google-flow-veo31-quality';

export interface HybridVideoCapacity {
  darkstar: boolean;
  ministar: boolean;
  googleFlow: boolean;
  remainingFlowCredits: number;
  maxFlowCreditsPerBatch: number;
}

export interface HybridVideoRequest {
  id: string;
  useCase: HybridVideoUseCase;
  contentTier: ContentTier;
  quantity: number;
  requiresLipSync: boolean;
  premium: boolean;
  upscale4k?: boolean;
}

export interface HybridVideoRoute {
  requestId: string;
  primary: HybridVideoEngine;
  fallbacks: HybridVideoEngine[];
  executionMode: 'automatic-local' | 'browser-assisted';
  estimatedFlowCredits: number;
  reason: string;
}

const FLOW_CREDITS = {
  'google-flow-veo31-lite': 5,
  'google-flow-veo31-fast': 10,
  'google-flow-veo31-quality': 100,
} as const;

function localFallbacks(capacity: HybridVideoCapacity): HybridVideoEngine[] {
  return [
    ...(capacity.darkstar ? (['darkstar-comfyui'] as const) : []),
    ...(capacity.ministar ? (['ministar-comfyui'] as const) : []),
  ];
}

function flowCost(engine: keyof typeof FLOW_CREDITS, request: HybridVideoRequest): number {
  return request.quantity * FLOW_CREDITS[engine] + (request.upscale4k ? request.quantity * 50 : 0);
}

function canSpendFlow(capacity: HybridVideoCapacity, cost: number): boolean {
  return capacity.googleFlow &&
    cost <= capacity.remainingFlowCredits &&
    cost <= capacity.maxFlowCreditsPerBatch;
}

export function routeHybridVideo(
  request: HybridVideoRequest,
  capacity: HybridVideoCapacity,
): HybridVideoRoute {
  if (!request.id.trim() || !Number.isInteger(request.quantity) || request.quantity < 1) {
    throw new Error('Hybrid video request requires an ID and a positive integer quantity');
  }
  const fallbacks = localFallbacks(capacity);

  // Adult media is kept on infrastructure controlled by the project. Flow is
  // reserved for advertiser-safe YouTube and public companion assets.
  if (request.contentTier !== 'safe') {
    const primary = capacity.darkstar ? 'darkstar-comfyui' : 'ministar-comfyui';
    if (!capacity.darkstar && !capacity.ministar) throw new Error('No local engine is available for private media');
    return {
      requestId: request.id,
      primary,
      fallbacks: fallbacks.filter((engine) => engine !== primary),
      executionMode: 'automatic-local',
      estimatedFlowCredits: 0,
      reason: 'Private content remains on controlled local infrastructure',
    };
  }

  if (request.requiresLipSync || request.useCase === 'avatar-lipsync') {
    if (!capacity.darkstar) {
      if (!capacity.ministar) throw new Error('No avatar-capable local engine is available');
      return {
        requestId: request.id,
        primary: 'ministar-comfyui',
        fallbacks: [],
        executionMode: 'automatic-local',
        estimatedFlowCredits: 0,
        reason: 'Lip synchronization uses the local fallback while Darkstar is unavailable',
      };
    }
    return {
      requestId: request.id,
      primary: 'darkstar-longcat',
      fallbacks,
      executionMode: 'automatic-local',
      estimatedFlowCredits: 0,
      reason: 'LongCat preserves localized lip synchronization and companion identity',
    };
  }

  const preferredFlow: keyof typeof FLOW_CREDITS = request.premium || request.useCase === 'hero-shot'
    ? 'google-flow-veo31-quality'
    : request.useCase === 'bulk-variation'
      ? 'google-flow-veo31-lite'
      : 'google-flow-veo31-fast';
  const estimatedFlowCredits = flowCost(preferredFlow, request);
  if (canSpendFlow(capacity, estimatedFlowCredits)) {
    return {
      requestId: request.id,
      primary: preferredFlow,
      fallbacks,
      executionMode: 'browser-assisted',
      estimatedFlowCredits,
      reason: request.premium
        ? 'Veo Quality is reserved for an approved premium shot'
        : 'Google Flow credits accelerate safe visual exploration without API billing',
    };
  }

  if (!fallbacks.length) throw new Error('No engine is available within the configured credit guardrail');
  return {
    requestId: request.id,
    primary: fallbacks[0]!,
    fallbacks: fallbacks.slice(1),
    executionMode: 'automatic-local',
    estimatedFlowCredits: 0,
    reason: 'The Flow credit ceiling or availability guardrail selected a local engine',
  };
}

export function routeHybridVideoBatch(
  requests: readonly HybridVideoRequest[],
  capacity: HybridVideoCapacity,
): { routes: HybridVideoRoute[]; estimatedFlowCredits: number } {
  let remainingFlowCredits = capacity.remainingFlowCredits;
  let remainingBatchCredits = capacity.maxFlowCreditsPerBatch;
  const routes = requests.map((request) => {
    const route = routeHybridVideo(request, {
      ...capacity,
      remainingFlowCredits,
      maxFlowCreditsPerBatch: remainingBatchCredits,
    });
    remainingFlowCredits -= route.estimatedFlowCredits;
    remainingBatchCredits -= route.estimatedFlowCredits;
    return route;
  });
  return {
    routes,
    estimatedFlowCredits: routes.reduce((total, route) => total + route.estimatedFlowCredits, 0),
  };
}
