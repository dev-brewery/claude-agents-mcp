import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

export interface Agent {
  id: number;
  name: string;
  category: string;
  content: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface GlobalConfig {
  id: number;
  config_type: string;
  content: string;
  updated_at: string;
}

export interface CustomCommand {
  id: number;
  name: string;
  content: string;
  description: string | null;
  updated_at: string;
}

export interface ProjectContext {
  id: number;
  project_id: string;
  context: string;
  updated_at: string;
}

export function initDatabase(dataPath: string): Database.Database {
  if (!existsSync(dataPath)) {
    mkdirSync(dataPath, { recursive: true });
  }

  const dbPath = join(dataPath, 'config.db');
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL CHECK(category IN ('roles', 'contexts', 'tasks', 'community', 'brahma')),
      content TEXT NOT NULL,
      version INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS global_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      config_type TEXT NOT NULL UNIQUE CHECK(config_type IN ('claude_md', 'session_init', 'constraints')),
      content TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS custom_commands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      description TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_contexts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL UNIQUE,
      context TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_name TEXT NOT NULL,
      action TEXT NOT NULL,
      timestamp TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_agents_category ON agents(category);
    CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);
    CREATE INDEX IF NOT EXISTS idx_sync_history_timestamp ON sync_history(timestamp);
  `);

  return db;
}

export class ConfigStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // Agent operations
  listAgents(category?: string): Agent[] {
    if (category) {
      return this.db.prepare('SELECT * FROM agents WHERE category = ? ORDER BY name').all(category) as Agent[];
    }
    return this.db.prepare('SELECT * FROM agents ORDER BY category, name').all() as Agent[];
  }

  getAgent(name: string): Agent | undefined {
    return this.db.prepare('SELECT * FROM agents WHERE name = ?').get(name) as Agent | undefined;
  }

  upsertAgent(name: string, category: string, content: string): Agent {
    const existing = this.getAgent(name);

    if (existing) {
      this.db.prepare(`
        UPDATE agents
        SET content = ?, category = ?, version = version + 1, updated_at = datetime('now')
        WHERE name = ?
      `).run(content, category, name);
    } else {
      this.db.prepare(`
        INSERT INTO agents (name, category, content) VALUES (?, ?, ?)
      `).run(name, category, content);
    }

    this.logSync('agent', name, existing ? 'update' : 'create');
    return this.getAgent(name)!;
  }

  deleteAgent(name: string): boolean {
    const result = this.db.prepare('DELETE FROM agents WHERE name = ?').run(name);
    if (result.changes > 0) {
      this.logSync('agent', name, 'delete');
      return true;
    }
    return false;
  }

  // Global config operations
  getGlobalConfig(configType: string): GlobalConfig | undefined {
    return this.db.prepare('SELECT * FROM global_config WHERE config_type = ?').get(configType) as GlobalConfig | undefined;
  }

  setGlobalConfig(configType: string, content: string): GlobalConfig {
    this.db.prepare(`
      INSERT INTO global_config (config_type, content) VALUES (?, ?)
      ON CONFLICT(config_type) DO UPDATE SET content = ?, updated_at = datetime('now')
    `).run(configType, content, content);

    this.logSync('global_config', configType, 'update');
    return this.getGlobalConfig(configType)!;
  }

  // Custom command operations
  listCommands(): CustomCommand[] {
    return this.db.prepare('SELECT * FROM custom_commands ORDER BY name').all() as CustomCommand[];
  }

  getCommand(name: string): CustomCommand | undefined {
    return this.db.prepare('SELECT * FROM custom_commands WHERE name = ?').get(name) as CustomCommand | undefined;
  }

  upsertCommand(name: string, content: string, description?: string): CustomCommand {
    this.db.prepare(`
      INSERT INTO custom_commands (name, content, description) VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET content = ?, description = ?, updated_at = datetime('now')
    `).run(name, content, description ?? null, content, description ?? null);

    this.logSync('command', name, 'update');
    return this.getCommand(name)!;
  }

  deleteCommand(name: string): boolean {
    const result = this.db.prepare('DELETE FROM custom_commands WHERE name = ?').run(name);
    if (result.changes > 0) {
      this.logSync('command', name, 'delete');
      return true;
    }
    return false;
  }

  // Project context operations
  getProjectContext(projectId: string): ProjectContext | undefined {
    return this.db.prepare('SELECT * FROM project_contexts WHERE project_id = ?').get(projectId) as ProjectContext | undefined;
  }

  setProjectContext(projectId: string, context: object): ProjectContext {
    const contextJson = JSON.stringify(context);
    this.db.prepare(`
      INSERT INTO project_contexts (project_id, context) VALUES (?, ?)
      ON CONFLICT(project_id) DO UPDATE SET context = ?, updated_at = datetime('now')
    `).run(projectId, contextJson, contextJson);

    this.logSync('project', projectId, 'update');
    return this.getProjectContext(projectId)!;
  }

  // Sync history
  private logSync(entityType: string, entityName: string, action: string): void {
    this.db.prepare(`
      INSERT INTO sync_history (entity_type, entity_name, action) VALUES (?, ?, ?)
    `).run(entityType, entityName, action);
  }

  getSyncHistory(limit = 50): Array<{ entity_type: string; entity_name: string; action: string; timestamp: string }> {
    return this.db.prepare(`
      SELECT entity_type, entity_name, action, timestamp
      FROM sync_history
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limit) as Array<{ entity_type: string; entity_name: string; action: string; timestamp: string }>;
  }
}
