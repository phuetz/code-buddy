/**
 * Tests for skill prompt integration via SkillManager.
 *
 * Verifies that when a skill is activated, getSkillPromptEnhancement()
 * returns the correct prompt block that gets injected into the system prompt
 * by PromptBuilder.
 */

import { SkillManager } from '../../src/skills/skill-manager';

// ---------------------------------------------------------------------------
// SkillManager – getSkillPromptEnhancement
// ---------------------------------------------------------------------------

describe('SkillManager – skill prompt enhancement', () => {
  let manager: SkillManager;

  beforeEach(() => {
    // Use a non-existent dir so no custom skills are loaded from disk
    manager = new SkillManager('/tmp/nonexistent-skill-test');
  });

  it('should return empty string when no skill is active', () => {
    expect(manager.getSkillPromptEnhancement()).toBe('');
  });

  it('should return prompt block when a predefined skill is activated', () => {
    const skill = manager.activateSkill('typescript-expert');
    expect(skill).not.toBeNull();

    const enhancement = manager.getSkillPromptEnhancement();
    expect(enhancement).toContain('ACTIVE SKILL: typescript-expert');
    expect(enhancement).toContain('END SKILL');
  });

  it('should include skill systemPrompt in the enhancement', () => {
    const skill = manager.activateSkill('typescript-expert');
    expect(skill).not.toBeNull();

    const enhancement = manager.getSkillPromptEnhancement();
    // The enhancement should contain the skill's systemPrompt content
    expect(enhancement).toContain(skill!.systemPrompt);
  });

  it('should return empty string after deactivating a skill', () => {
    manager.activateSkill('typescript-expert');
    expect(manager.getSkillPromptEnhancement()).not.toBe('');

    manager.deactivateSkill();
    expect(manager.getSkillPromptEnhancement()).toBe('');
  });

  it('should replace enhancement when activating a different skill', () => {
    manager.activateSkill('typescript-expert');
    const first = manager.getSkillPromptEnhancement();
    expect(first).toContain('typescript-expert');

    // Activate a different predefined skill
    const skills = manager.getAvailableSkills();
    const otherName = skills.find(s => s !== 'typescript-expert');
    if (otherName) {
      manager.activateSkill(otherName);
      const second = manager.getSkillPromptEnhancement();
      expect(second).toContain(`ACTIVE SKILL: ${otherName}`);
      expect(second).not.toContain('ACTIVE SKILL: typescript-expert');
    }
  });

  it('should return null from activateSkill for unknown skill name', () => {
    const result = manager.activateSkill('nonexistent-skill-xyz');
    expect(result).toBeNull();
    expect(manager.getSkillPromptEnhancement()).toBe('');
  });

  it('should report active skill via getActiveSkill()', () => {
    expect(manager.getActiveSkill()).toBeNull();

    manager.activateSkill('typescript-expert');
    const active = manager.getActiveSkill();
    expect(active).not.toBeNull();
    expect(active!.name).toBe('typescript-expert');
  });

  it('should emit skill:activated event on activation', () => {
    const handler = jest.fn();
    manager.on('skill:activated', handler);

    manager.activateSkill('typescript-expert');

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ skill: 'typescript-expert', manual: true })
    );
  });

  it('should emit skill:deactivated event on deactivation', () => {
    manager.activateSkill('typescript-expert');

    const handler = jest.fn();
    manager.on('skill:deactivated', handler);

    manager.deactivateSkill();

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ skill: 'typescript-expert' })
    );
  });
});
