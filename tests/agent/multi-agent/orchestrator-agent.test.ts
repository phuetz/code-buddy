import { describe, expect, it } from 'vitest';

import { OrchestratorAgent } from '../../../src/agent/multi-agent/agents/orchestrator-agent.js';
import type { ExecutionPlan } from '../../../src/agent/multi-agent/types.js';

function parsePlan(agent: OrchestratorAgent, output: string, goal = 'ship swarm'): ExecutionPlan {
  return (agent as unknown as {
    parsePlan: (output: string, goal: string) => ExecutionPlan;
  }).parsePlan(output, goal);
}

describe('OrchestratorAgent planning parser', () => {
  it('normalizes legacy OpenClaw roles to available workflow agents', () => {
    const agent = new OrchestratorAgent('test-key', 'https://api.x.ai/v1');
    const plan = parsePlan(agent, `
<plan complexity="complex">
<goal>ship swarm</goal>
<summary>Exercise legacy roles</summary>
<phase order="1" parallelizable="true">
  <name>Discovery</name>
  <description>Map the work</description>
  <task priority="high" agent="researcher">
    <title>Map repo</title>
    <description>Find the relevant files</description>
  </task>
  <task priority="high" agent="architect">
    <title>Shape design</title>
    <description>Decide boundaries</description>
  </task>
  <task priority="medium" agent="debugger">
    <title>Fix failure</title>
    <description>Patch the broken path</description>
  </task>
  <task priority="medium" agent="documenter">
    <title>Write notes</title>
    <description>Document the outcome</description>
  </task>
</phase>
</plan>`);

    const tasks = plan.phases[0].tasks;

    expect(tasks.map((task) => task.assignedTo)).toEqual([
      'orchestrator',
      'orchestrator',
      'coder',
      'coder',
    ]);
    expect(tasks.map((task) => task.metadata.originalAssignedTo)).toEqual([
      'researcher',
      'architect',
      'debugger',
      'documenter',
    ]);
    expect(plan.requiredAgents).toEqual(['orchestrator', 'coder']);
  });

  it('advertises only roles that MultiAgentSystem actually instantiates', () => {
    const agent = new OrchestratorAgent('test-key', 'https://api.x.ai/v1');
    const prompt = agent.getSpecializedPrompt();

    expect(prompt).toContain('agent="orchestrator|coder|reviewer|tester"');
    expect(prompt).toContain('Use only these exact task agent values');
    expect(prompt).not.toContain('**Researcher**');
    expect(prompt).not.toContain('**Debugger**');
    expect(prompt).not.toContain('**Architect**');
    expect(prompt).not.toContain('**Documenter**');
  });
});
