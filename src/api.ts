#!/usr/bin/env node
/**
 * HTTP API wrapper for the Claude Agents MCP server
 * Provides REST endpoints for network access
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { initDatabase, ConfigStore } from './db.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = process.env.CONFIG_DATA_PATH || join(__dirname, '..', 'data');
const PORT = parseInt(process.env.API_PORT || '8765', 10);

// Initialize database and store
const db = initDatabase(DATA_PATH);
const store = new ConfigStore(db);

// Simple CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Parse JSON body
async function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// Send JSON response
function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...corsHeaders,
  });
  res.end(JSON.stringify(data, null, 2));
}

// Route handlers
const routes: Record<string, (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void>> = {
  // Agents
  'GET /api/agents': async (_req, res) => {
    const agents = store.listAgents();
    sendJson(res, 200, agents.map((a) => ({
      name: a.name,
      category: a.category,
      version: a.version,
      updated_at: a.updated_at,
    })));
  },

  'GET /api/agents/:category': async (_req, res, params) => {
    const agents = store.listAgents(params.category);
    sendJson(res, 200, agents.map((a) => ({
      name: a.name,
      category: a.category,
      version: a.version,
      updated_at: a.updated_at,
    })));
  },

  'GET /api/agent/:name': async (_req, res, params) => {
    const agent = store.getAgent(params.name);
    if (!agent) {
      sendJson(res, 404, { error: 'Agent not found' });
      return;
    }
    sendJson(res, 200, agent);
  },

  'POST /api/agent': async (req, res) => {
    const body = (await parseBody(req)) as { name: string; category: string; content: string };
    if (!body.name || !body.category || !body.content) {
      sendJson(res, 400, { error: 'Missing required fields: name, category, content' });
      return;
    }
    const agent = store.upsertAgent(body.name, body.category, body.content);
    sendJson(res, 200, { message: 'Agent saved', version: agent.version });
  },

  'DELETE /api/agent/:name': async (_req, res, params) => {
    const deleted = store.deleteAgent(params.name);
    if (!deleted) {
      sendJson(res, 404, { error: 'Agent not found' });
      return;
    }
    sendJson(res, 200, { message: 'Agent deleted' });
  },

  // Global config
  'GET /api/config/:type': async (_req, res, params) => {
    const config = store.getGlobalConfig(params.type);
    if (!config) {
      sendJson(res, 404, { error: 'Config not found' });
      return;
    }
    sendJson(res, 200, config);
  },

  'POST /api/config/:type': async (req, res, params) => {
    const body = (await parseBody(req)) as { content: string };
    if (!body.content) {
      sendJson(res, 400, { error: 'Missing required field: content' });
      return;
    }
    store.setGlobalConfig(params.type, body.content);
    sendJson(res, 200, { message: 'Config saved' });
  },

  // Commands
  'GET /api/commands': async (_req, res) => {
    const commands = store.listCommands();
    sendJson(res, 200, commands.map((c) => ({
      name: c.name,
      description: c.description,
      updated_at: c.updated_at,
    })));
  },

  'GET /api/command/:name': async (_req, res, params) => {
    const command = store.getCommand(params.name);
    if (!command) {
      sendJson(res, 404, { error: 'Command not found' });
      return;
    }
    sendJson(res, 200, command);
  },

  'POST /api/command': async (req, res) => {
    const body = (await parseBody(req)) as { name: string; content: string; description?: string };
    if (!body.name || !body.content) {
      sendJson(res, 400, { error: 'Missing required fields: name, content' });
      return;
    }
    store.upsertCommand(body.name, body.content, body.description);
    sendJson(res, 200, { message: 'Command saved' });
  },

  'DELETE /api/command/:name': async (_req, res, params) => {
    const deleted = store.deleteCommand(params.name);
    if (!deleted) {
      sendJson(res, 404, { error: 'Command not found' });
      return;
    }
    sendJson(res, 200, { message: 'Command deleted' });
  },

  // Project context
  'GET /api/project/:id': async (_req, res, params) => {
    const project = store.getProjectContext(params.id);
    if (!project) {
      sendJson(res, 404, { error: 'Project not found' });
      return;
    }
    sendJson(res, 200, JSON.parse(project.context));
  },

  'POST /api/project/:id': async (req, res, params) => {
    const body = await parseBody(req);
    store.setProjectContext(params.id, body as object);
    sendJson(res, 200, { message: 'Project context saved' });
  },

  // Search
  'GET /api/search': async (req, res) => {
    const url = new URL(req.url || '', `http://localhost:${PORT}`);
    const query = url.searchParams.get('q');
    if (!query) {
      sendJson(res, 400, { error: 'Missing query parameter: q' });
      return;
    }
    const allAgents = store.listAgents();
    const matches = allAgents.filter(
      (a) =>
        a.name.toLowerCase().includes(query.toLowerCase()) ||
        a.content.toLowerCase().includes(query.toLowerCase())
    );
    sendJson(res, 200, matches.map((a) => ({
      name: a.name,
      category: a.category,
      version: a.version,
    })));
  },

  // Sync history
  'GET /api/history': async (req, res) => {
    const url = new URL(req.url || '', `http://localhost:${PORT}`);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const history = store.getSyncHistory(limit);
    sendJson(res, 200, history);
  },

  // Health check
  'GET /health': async (_req, res) => {
    sendJson(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
  },
};

// Match route with params
function matchRoute(method: string, path: string): { handler: typeof routes[string]; params: Record<string, string> } | null {
  for (const [pattern, handler] of Object.entries(routes)) {
    const [routeMethod, routePath] = pattern.split(' ');
    if (method !== routeMethod) continue;

    const pathParts = path.split('/').filter(Boolean);
    const routeParts = routePath.split('/').filter(Boolean);

    if (pathParts.length !== routeParts.length) continue;

    const params: Record<string, string> = {};
    let matches = true;

    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(':')) {
        params[routeParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
      } else if (routeParts[i] !== pathParts[i]) {
        matches = false;
        break;
      }
    }

    if (matches) return { handler, params };
  }
  return null;
}

// Create HTTP server
const server = createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const method = req.method || 'GET';
  const path = url.pathname;

  console.log(`${new Date().toISOString()} ${method} ${path}`);

  try {
    const match = matchRoute(method, path);
    if (match) {
      await match.handler(req, res, match.params);
    } else {
      sendJson(res, 404, { error: 'Not found' });
    }
  } catch (error) {
    console.error('Error handling request:', error);
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Claude Agents API server running on http://localhost:${PORT}`);
  console.log(`Data path: ${DATA_PATH}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close();
  db.close();
  process.exit(0);
});
