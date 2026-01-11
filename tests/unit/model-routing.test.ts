/**
 * Unit tests for Model Routing System
 */

import { 
  classifyTaskComplexity, 
  selectModel, 
  calculateCost, 
  ModelRouter,
  GROK_MODELS 
} from '../../src/optimization/model-routing';

describe('Model Routing', () => {
  describe('classifyTaskComplexity()', () => {
    it('should classify simple tasks', () => {
      const classification = classifyTaskComplexity('show me the file');
      expect(classification.complexity).toBe('simple');
    });

    it('should classify reasoning tasks', () => {
      const classification = classifyTaskComplexity('analyze this complex algorithm and explain why it is slow');
      expect(classification.complexity).toBe('reasoning_heavy');
      expect(classification.requiresReasoning).toBe(true);
    });

    it('should detect vision requirements', () => {
      const classification = classifyTaskComplexity('explain this image diagram.png');
      expect(classification.requiresVision).toBe(true);
    });

    it('should estimate token count', () => {
      const message = 'a'.repeat(400);
      const classification = classifyTaskComplexity(message);
      expect(classification.estimatedTokens).toBe(100);
    });
  });

  describe('selectModel()', () => {
    it('should select mini model for simple tasks', () => {
      const classification = classifyTaskComplexity('hi');
      const decision = selectModel(classification);
      expect(decision.recommendedModel).toBe('grok-3-mini');
    });

    it('should select vision model for vision tasks', () => {
      const classification = classifyTaskComplexity('check screenshot.png');
      const decision = selectModel(classification);
      expect(decision.recommendedModel).toBe('grok-2-vision');
    });

    it('should select reasoning model for heavy tasks', () => {
      const classification = classifyTaskComplexity('megathink about the architecture');
      const decision = selectModel(classification);
      expect(decision.recommendedModel).toBe('grok-3-reasoning');
    });

    it('should respect user preference', () => {
      const classification = classifyTaskComplexity('hi');
      const decision = selectModel(classification, 'grok-3');
      expect(decision.recommendedModel).toBe('grok-3');
    });
  });

  describe('calculateCost()', () => {
    it('should calculate cost correctly', () => {
      const tokens = 1000000; // 1M
      const cost = calculateCost(tokens, 'grok-3');
      // grok-3 is 3.0 per 1M, and we assume 1.5x for output
      expect(cost).toBe(4.5);
    });
  });

  describe('ModelRouter', () => {
    let router: ModelRouter;

    beforeEach(() => {
      router = new ModelRouter({ enabled: true });
    });

    it('should route and record usage', () => {
      const decision = router.route('simple task');
      expect(decision.recommendedModel).toBeDefined();
      
      router.recordUsage(decision.recommendedModel, 1000, decision.estimatedCost);
      
      const stats = router.getUsageStats();
      expect(stats.get(decision.recommendedModel)).toBeDefined();
      expect(router.getTotalCost()).toBeGreaterThan(0);
    });

    it('should respect cost sensitivity', () => {
      const routerHighSense = new ModelRouter({ 
        enabled: true,
        costSensitivity: 'high' 
      });
      
      // For moderate tasks, it might prefer the cheaper alternative if sensitivity is high
      const classification = classifyTaskComplexity('moderate task description that is long enough');
      const decision = routerHighSense.route(classification.complexity);
      
      expect(decision).toBeDefined();
    });

    it('should return default model when disabled', () => {
      const disabledRouter = new ModelRouter({ enabled: false, defaultModel: 'grok-3' });
      const decision = disabledRouter.route('any task');
      expect(decision.recommendedModel).toBe('grok-3');
      expect(decision.reason).toBe('Routing disabled');
    });
  });
});
