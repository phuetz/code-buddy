/**
 * Trigger Registry
 *
 * CRUD operations for triggers with persistence to ~/.codebuddy/triggers.json.
 * Includes predefined trigger templates.
 */

import * as path from 'path';
import { homedir } from 'os';
import * as crypto from 'crypto';
import { EventTriggerManager, type Trigger, type TriggerType, type TriggerAction } from './event-trigger.js';
import { readJsonAtomic, writeJsonAtomic } from '../../utils/atomic-write.js';
import { logger } from '../../utils/logger.js';

const TRIGGERS_FILE = path.join(homedir(), '.codebuddy', 'triggers.json');

// Predefined trigger templates
export const TRIGGER_TEMPLATES: Record<string, Omit<Trigger, 'id' | 'createdAt' | 'fireCount'>> = {
  'file-change-notify': {
    name: 'File Change Notification',
    type: 'file_change',
    condition: 'src/**/*.ts',
    action: { type: 'notify', target: 'cli' },
    cooldownMs: 5000,
    enabled: true,
  },
  'screen-change-alert': {
    name: 'Screen Change Alert',
    type: 'screen_change',
    condition: '0.5',
    action: { type: 'notify', target: 'cli' },
    cooldownMs: 10000,
    enabled: true,
  },
  'webhook-handler': {
    name: 'Webhook Handler',
    type: 'webhook',
    condition: '*',
    action: { type: 'agent_message', target: 'Process incoming webhook' },
    cooldownMs: 1000,
    enabled: true,
  },
};

export class TriggerRegistry {
  private triggerManager: EventTriggerManager;

  constructor(triggerManager: EventTriggerManager) {
    this.triggerManager = triggerManager;
  }

  /**
   * Load triggers from disk
   */
  async load(): Promise<void> {
    try {
      const triggers = await readJsonAtomic<Trigger[]>(TRIGGERS_FILE, []);

      for (const trigger of triggers) {
        trigger.createdAt = new Date(trigger.createdAt);
        if (trigger.lastFiredAt) trigger.lastFiredAt = new Date(trigger.lastFiredAt);
        this.triggerManager.addTrigger(trigger);
      }

      logger.debug(`Loaded ${triggers.length} triggers`);
    } catch {
      // No triggers file yet
    }
  }

  /**
   * Save triggers to disk
   */
  async save(): Promise<void> {
    try {
      const triggers = this.triggerManager.listTriggers();
      await writeJsonAtomic(TRIGGERS_FILE, triggers);
    } catch (error) {
      logger.warn('Failed to save triggers', { error: String(error) });
    }
  }

  /**
   * Create a new trigger
   */
  async create(params: {
    name: string;
    type: TriggerType;
    condition: string;
    action: TriggerAction;
    cooldownMs?: number;
  }): Promise<Trigger> {
    const trigger: Trigger = {
      id: crypto.randomUUID(),
      name: params.name,
      type: params.type,
      condition: params.condition,
      action: params.action,
      cooldownMs: params.cooldownMs || 5000,
      enabled: true,
      createdAt: new Date(),
      fireCount: 0,
    };

    this.triggerManager.addTrigger(trigger);
    await this.save();
    return trigger;
  }

  /**
   * Create from template
   */
  async createFromTemplate(templateId: string): Promise<Trigger | null> {
    const template = TRIGGER_TEMPLATES[templateId];
    if (!template) return null;

    return this.create({
      name: template.name,
      type: template.type,
      condition: template.condition,
      action: template.action,
      cooldownMs: template.cooldownMs,
    });
  }

  /**
   * Delete a trigger
   */
  async delete(id: string): Promise<boolean> {
    const removed = this.triggerManager.removeTrigger(id);
    if (removed) await this.save();
    return removed;
  }

  /**
   * List templates
   */
  listTemplates(): string[] {
    return Object.keys(TRIGGER_TEMPLATES);
  }
}
