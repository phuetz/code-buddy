/**
 * ActivityFeed — Claude Cowork parity Phase 2 step 18
 *
 * Cross-project activity log. Persists the last 200 events
 * (session start/end, subagent activity, notifications, checkpoints,
 * gui actions) in SQLite for cross-session visibility.
 *
 * @module main/activity/activity-feed
 */

import { logWarn } from '../utils/logger';
import type { DatabaseInstance } from '../db/database';

export type ActivityType =
  | 'session.start'
  | 'session.end'
  | 'subagent.spawned'
  | 'subagent.completed'
  | 'notification'
  | 'checkpoint.created'
  | 'gui.action'
  | 'task.complete'
  | 'project.created'
  | 'project.deleted'
  | 'workflow.run'
  | 'memory.added'
  | 'scheduledTask.started'
  | 'scheduledTask.failed'
  | 'fleet.dispatch'
  | 'fleet.saga.completed'
  | 'fleet.saga.failed'
  | 'fleet.saga.cancelled'
  | 'fleet.chatSession.started'
  | 'fleet.chatSession.turn'
  | 'fleet.chatSession.ended';

export interface ActivityEntry {
  id: number;
  type: ActivityType;
  title: string;
  description?: string;
  sessionId?: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

const MAX_ENTRIES = 200;

export class ActivityFeed {
  constructor(private db: DatabaseInstance) {
    this.ensureSchema();
  }

  private ensureSchema(): void {
    const database = this.db.raw;
    try {
      database
        .prepare(
          `CREATE TABLE IF NOT EXISTS activity_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            session_id TEXT,
            project_id TEXT,
            metadata TEXT,
            timestamp INTEGER NOT NULL
          )`
        )
        .run();
      database
        .prepare(
          `CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_log(timestamp DESC)`
        )
        .run();
      database
        .prepare(
          `CREATE INDEX IF NOT EXISTS idx_activity_project ON activity_log(project_id)`
        )
        .run();
    } catch (err) {
      logWarn('[ActivityFeed] schema setup failed:', err);
    }
  }

  record(entry: Omit<ActivityEntry, 'id' | 'timestamp'>): void {
    try {
      const database = this.db.raw;
      database
        .prepare(
          `INSERT INTO activity_log (type, title, description, session_id, project_id, metadata, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          entry.type,
          entry.title,
          entry.description ?? null,
          entry.sessionId ?? null,
          entry.projectId ?? null,
          entry.metadata ? JSON.stringify(entry.metadata) : null,
          Date.now()
        );

      // Trim to MAX_ENTRIES
      database
        .prepare(
          `DELETE FROM activity_log
           WHERE id NOT IN (
             SELECT id FROM activity_log ORDER BY timestamp DESC LIMIT ?
           )`
        )
        .run(MAX_ENTRIES);
    } catch (err) {
      logWarn('[ActivityFeed] record failed:', err);
    }
  }

  recent(limit = 100, projectId?: string): ActivityEntry[] {
    try {
      const database = this.db.raw;
      const rows = projectId
        ? (database
            .prepare(
              `SELECT id, type, title, description, session_id, project_id, metadata, timestamp
               FROM activity_log
               WHERE project_id = ?
               ORDER BY timestamp DESC
               LIMIT ?`
            )
            .all(projectId, limit) as Array<{
            id: number;
            type: string;
            title: string;
            description: string | null;
            session_id: string | null;
            project_id: string | null;
            metadata: string | null;
            timestamp: number;
          }>)
        : (database
            .prepare(
              `SELECT id, type, title, description, session_id, project_id, metadata, timestamp
               FROM activity_log
               ORDER BY timestamp DESC
               LIMIT ?`
            )
            .all(limit) as Array<{
            id: number;
            type: string;
            title: string;
            description: string | null;
            session_id: string | null;
            project_id: string | null;
            metadata: string | null;
            timestamp: number;
          }>);

      return rows.map((row) => {
        let metadata: Record<string, unknown> | undefined;
        if (row.metadata) {
          try {
            metadata = JSON.parse(row.metadata) as Record<string, unknown>;
          } catch {
            /* skip malformed */
          }
        }
        return {
          id: row.id,
          type: row.type as ActivityType,
          title: row.title,
          description: row.description ?? undefined,
          sessionId: row.session_id ?? undefined,
          projectId: row.project_id ?? undefined,
          metadata,
          timestamp: row.timestamp,
        };
      });
    } catch (err) {
      logWarn('[ActivityFeed] recent failed:', err);
      return [];
    }
  }

  clear(): void {
    try {
      this.db.raw.prepare(`DELETE FROM activity_log`).run();
    } catch (err) {
      logWarn('[ActivityFeed] clear failed:', err);
    }
  }
}
