
import { PlanTool } from '../../src/tools/plan-tool.js';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

describe('PlanTool', () => {
  let tool: PlanTool;
  let tempDir: string;
  let planPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plan-tool-test-'));
    tool = new PlanTool(tempDir);
    planPath = path.join(tempDir, 'PLAN.md');
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  it('should initialize a plan', async () => {
    const result = await tool.execute({ action: 'init', goal: 'Test Goal' });
    expect(result.success).toBe(true);
    
    const content = await fs.readFile(planPath, 'utf-8');
    expect(content).toContain('**Goal:** Test Goal');
    expect(content).toContain('## Steps');
  });

  it('should fail to read non-existent plan', async () => {
    const result = await tool.execute({ action: 'read' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('No PLAN.md found');
  });

  it('should append a step', async () => {
    await tool.execute({ action: 'init', goal: 'Test Goal' });
    
    const result = await tool.execute({ action: 'append', step: 'Step 1' });
    expect(result.success).toBe(true);
    
    const content = await fs.readFile(planPath, 'utf-8');
    expect(content).toContain('- [ ] Step 1');
  });

  it('should update a step status', async () => {
    await tool.execute({ action: 'init', goal: 'Test Goal' });
    await tool.execute({ action: 'append', step: 'Step 1' });
    
    const result = await tool.execute({ 
      action: 'update', 
      step: 'Step 1', 
      status: 'completed' 
    });
    
    expect(result.success).toBe(true);
    
    const content = await fs.readFile(planPath, 'utf-8');
    expect(content).toContain('- [x] Step 1');
  });

  it('should handle updating partial matches', async () => {
    await tool.execute({ action: 'init', goal: 'Test Goal' });
    await tool.execute({ action: 'append', step: 'Buy milk from store' });
    
    const result = await tool.execute({ 
      action: 'update', 
      step: 'milk', 
      status: 'in_progress' 
    });
    
    expect(result.success).toBe(true);
    
    const content = await fs.readFile(planPath, 'utf-8');
    expect(content).toContain('- [/] Buy milk from store');
  });
});
