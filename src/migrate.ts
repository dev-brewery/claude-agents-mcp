#!/usr/bin/env node
/**
 * Migration script to import existing Claude configurations from Nextcloud
 * Usage: npm run migrate -- --source "G:/Nextcloud"
 */

import { initDatabase, ConfigStore } from './db.js';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface MigrationConfig {
  sourcePath: string;
  dataPath: string;
}

function parseArgs(): MigrationConfig {
  const args = process.argv.slice(2);
  let sourcePath = 'G:/Nextcloud';
  let dataPath = join(__dirname, '..', 'data');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' && args[i + 1]) {
      sourcePath = args[i + 1];
      i++;
    } else if (args[i] === '--data' && args[i + 1]) {
      dataPath = args[i + 1];
      i++;
    }
  }

  return { sourcePath, dataPath };
}

function findMarkdownFiles(dir: string): string[] {
  const files: string[] = [];

  if (!existsSync(dir)) return files;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...findMarkdownFiles(fullPath));
    } else if (entry.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

function categorizeAgent(filePath: string, name: string): string {
  const pathLower = filePath.toLowerCase();

  if (pathLower.includes('brahma') || name.startsWith('brahma-')) {
    return 'brahma';
  }
  if (pathLower.includes('/roles/') || pathLower.includes('\\roles\\')) {
    return 'roles';
  }
  if (pathLower.includes('/contexts/') || pathLower.includes('\\contexts\\')) {
    return 'contexts';
  }
  if (pathLower.includes('/tasks/') || pathLower.includes('\\tasks\\')) {
    return 'tasks';
  }
  if (pathLower.includes('/community') || pathLower.includes('\\community')) {
    return 'community';
  }

  // Default based on content analysis or fall back to community
  return 'community';
}

async function migrate() {
  const config = parseArgs();
  console.log(`\n🚀 Claude Agents MCP Migration`);
  console.log(`   Source: ${config.sourcePath}`);
  console.log(`   Target: ${config.dataPath}\n`);

  // Initialize database
  const db = initDatabase(config.dataPath);
  const store = new ConfigStore(db);

  let agentCount = 0;
  let configCount = 0;
  let commandCount = 0;

  // Define source locations
  const agentSources = [
    join(config.sourcePath, 'AgentConfigs', '.claude', 'agents'),
    join(config.sourcePath, 'AgentPrompts', '.claude', 'agents'),
    join(config.sourcePath, 'AgentPrompts', '01_Roles'),
    join(config.sourcePath, 'AgentPrompts', '02_Contexts'),
    join(config.sourcePath, 'AgentPrompts', '03_Tasks'),
    join(config.sourcePath, 'AgentPrompts', '04_CommunityAgents'),
  ];

  const configSources = [
    {
      path: join(config.sourcePath, 'AgentConfigs', '.claude', 'CLAUDE.md'),
      type: 'claude_md',
    },
    {
      path: join(config.sourcePath, 'AgentConfigs', '.claude', 'SESSION_INIT.md'),
      type: 'session_init',
    },
    {
      path: join(config.sourcePath, 'AgentConfigs', '.claude', 'AGENT_CONSTRAINTS.md'),
      type: 'constraints',
    },
    // Fallback locations
    {
      path: join(config.sourcePath, 'Agent_Prompts', 'Global_Rules', 'CLAUDE.md'),
      type: 'claude_md',
    },
  ];

  const commandSources = [
    join(config.sourcePath, 'AgentConfigs', '.claude', 'commands'),
    join(config.sourcePath, 'AgentPrompts', '.claude', 'commands'),
  ];

  // Import agents
  console.log('📦 Importing agents...');
  for (const source of agentSources) {
    if (!existsSync(source)) continue;

    const files = findMarkdownFiles(source);
    for (const file of files) {
      try {
        const content = readFileSync(file, 'utf-8');
        const name = basename(file, '.md');

        // Skip non-agent files
        if (['README', 'CLAUDE', 'SESSION_INIT', 'AGENT_CONSTRAINTS'].includes(name.toUpperCase())) {
          continue;
        }

        const category = categorizeAgent(file, name);

        // Try to parse frontmatter, but don't fail if it's malformed
        try {
          const { data: frontmatter, content: body } = matter(content);
        } catch (parseError) {
          console.log(`   ⚠ ${name} has malformed frontmatter, importing raw content`);
        }

        store.upsertAgent(name, category, content);
        console.log(`   ✓ ${name} (${category})`);
        agentCount++;
      } catch (error) {
        console.error(`   ✗ Failed to import ${file}: ${error}`);
      }
    }
  }

  // Import global configs
  console.log('\n⚙️  Importing global configurations...');
  const importedConfigs = new Set<string>();

  for (const { path, type } of configSources) {
    if (!existsSync(path) || importedConfigs.has(type)) continue;

    try {
      const content = readFileSync(path, 'utf-8');
      store.setGlobalConfig(type, content);
      importedConfigs.add(type);
      console.log(`   ✓ ${type} from ${basename(dirname(path))}`);
      configCount++;
    } catch (error) {
      console.error(`   ✗ Failed to import ${path}: ${error}`);
    }
  }

  // Import custom commands
  console.log('\n🔧 Importing custom commands...');
  for (const source of commandSources) {
    if (!existsSync(source)) continue;

    const files = findMarkdownFiles(source);
    for (const file of files) {
      try {
        const content = readFileSync(file, 'utf-8');
        const name = basename(file, '.md');

        // Try to extract description from first line or frontmatter
        const { data: frontmatter, content: body } = matter(content);
        const description =
          frontmatter.description ||
          body.split('\n').find((line: string) => line.trim())?.replace(/^#+\s*/, '') ||
          undefined;

        store.upsertCommand(name, content, description);
        console.log(`   ✓ ${name}`);
        commandCount++;
      } catch (error) {
        console.error(`   ✗ Failed to import ${file}: ${error}`);
      }
    }
  }

  // Summary
  console.log('\n' + '─'.repeat(50));
  console.log(`✅ Migration complete!`);
  console.log(`   Agents:   ${agentCount}`);
  console.log(`   Configs:  ${configCount}`);
  console.log(`   Commands: ${commandCount}`);
  console.log('─'.repeat(50) + '\n');

  db.close();
}

migrate().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
