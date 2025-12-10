#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { initDatabase, ConfigStore } from './db.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = process.env.CONFIG_DATA_PATH || join(__dirname, '..', 'data');

// Initialize database and store
const db = initDatabase(DATA_PATH);
const store = new ConfigStore(db);

// Define MCP tools
const tools: Tool[] = [
  {
    name: 'list_agents',
    description: 'List all available agent definitions. Optionally filter by category (roles, contexts, tasks, community, brahma).',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Filter by category: roles, contexts, tasks, community, or brahma',
          enum: ['roles', 'contexts', 'tasks', 'community', 'brahma'],
        },
      },
    },
  },
  {
    name: 'get_agent',
    description: 'Retrieve a specific agent definition by name.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the agent to retrieve',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'publish_agent',
    description: 'Create or update an agent definition.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the agent',
        },
        category: {
          type: 'string',
          description: 'Category: roles, contexts, tasks, community, or brahma',
          enum: ['roles', 'contexts', 'tasks', 'community', 'brahma'],
        },
        content: {
          type: 'string',
          description: 'Full markdown content of the agent definition',
        },
      },
      required: ['name', 'category', 'content'],
    },
  },
  {
    name: 'delete_agent',
    description: 'Delete an agent definition.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the agent to delete',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_global_config',
    description: 'Retrieve global configuration (CLAUDE.md, session init, or constraints).',
    inputSchema: {
      type: 'object',
      properties: {
        config_type: {
          type: 'string',
          description: 'Type of config: claude_md, session_init, or constraints',
          enum: ['claude_md', 'session_init', 'constraints'],
        },
      },
      required: ['config_type'],
    },
  },
  {
    name: 'set_global_config',
    description: 'Update global configuration.',
    inputSchema: {
      type: 'object',
      properties: {
        config_type: {
          type: 'string',
          description: 'Type of config: claude_md, session_init, or constraints',
          enum: ['claude_md', 'session_init', 'constraints'],
        },
        content: {
          type: 'string',
          description: 'Full content of the configuration',
        },
      },
      required: ['config_type', 'content'],
    },
  },
  {
    name: 'list_commands',
    description: 'List all custom slash commands.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_command',
    description: 'Retrieve a custom slash command by name.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the command (without slash)',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'publish_command',
    description: 'Create or update a custom slash command.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the command (without slash)',
        },
        content: {
          type: 'string',
          description: 'Full markdown content of the command',
        },
        description: {
          type: 'string',
          description: 'Short description of what the command does',
        },
      },
      required: ['name', 'content'],
    },
  },
  {
    name: 'delete_command',
    description: 'Delete a custom slash command.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the command to delete',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_project_context',
    description: 'Retrieve project-specific configuration.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Unique project identifier',
        },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'set_project_context',
    description: 'Save project-specific configuration.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Unique project identifier',
        },
        context: {
          type: 'object',
          description: 'Project context data (JSON object)',
        },
      },
      required: ['project_id', 'context'],
    },
  },
  {
    name: 'get_sync_history',
    description: 'Get recent synchronization history.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of entries to return (default 50)',
        },
      },
    },
  },
  {
    name: 'search_agents',
    description: 'Search agents by name or content.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (searches name and content)',
        },
      },
      required: ['query'],
    },
  },
];

// Create MCP server
const server = new Server(
  {
    name: 'claude-agents-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'list_agents': {
        const agents = store.listAgents(args?.category as string | undefined);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                agents.map((a) => ({
                  name: a.name,
                  category: a.category,
                  version: a.version,
                  updated_at: a.updated_at,
                })),
                null,
                2
              ),
            },
          ],
        };
      }

      case 'get_agent': {
        const agent = store.getAgent(args?.name as string);
        if (!agent) {
          return {
            content: [{ type: 'text', text: `Agent '${args?.name}' not found` }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: agent.content }],
        };
      }

      case 'publish_agent': {
        const agent = store.upsertAgent(
          args?.name as string,
          args?.category as string,
          args?.content as string
        );
        return {
          content: [
            {
              type: 'text',
              text: `Agent '${agent.name}' published (version ${agent.version})`,
            },
          ],
        };
      }

      case 'delete_agent': {
        const deleted = store.deleteAgent(args?.name as string);
        return {
          content: [
            {
              type: 'text',
              text: deleted
                ? `Agent '${args?.name}' deleted`
                : `Agent '${args?.name}' not found`,
            },
          ],
          isError: !deleted,
        };
      }

      case 'get_global_config': {
        const config = store.getGlobalConfig(args?.config_type as string);
        if (!config) {
          return {
            content: [
              { type: 'text', text: `Config '${args?.config_type}' not found` },
            ],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: config.content }],
        };
      }

      case 'set_global_config': {
        store.setGlobalConfig(args?.config_type as string, args?.content as string);
        return {
          content: [
            { type: 'text', text: `Config '${args?.config_type}' updated` },
          ],
        };
      }

      case 'list_commands': {
        const commands = store.listCommands();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                commands.map((c) => ({
                  name: c.name,
                  description: c.description,
                  updated_at: c.updated_at,
                })),
                null,
                2
              ),
            },
          ],
        };
      }

      case 'get_command': {
        const command = store.getCommand(args?.name as string);
        if (!command) {
          return {
            content: [{ type: 'text', text: `Command '${args?.name}' not found` }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: command.content }],
        };
      }

      case 'publish_command': {
        store.upsertCommand(
          args?.name as string,
          args?.content as string,
          args?.description as string | undefined
        );
        return {
          content: [{ type: 'text', text: `Command '${args?.name}' published` }],
        };
      }

      case 'delete_command': {
        const deleted = store.deleteCommand(args?.name as string);
        return {
          content: [
            {
              type: 'text',
              text: deleted
                ? `Command '${args?.name}' deleted`
                : `Command '${args?.name}' not found`,
            },
          ],
          isError: !deleted,
        };
      }

      case 'get_project_context': {
        const project = store.getProjectContext(args?.project_id as string);
        if (!project) {
          return {
            content: [
              { type: 'text', text: `Project '${args?.project_id}' not found` },
            ],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: project.context }],
        };
      }

      case 'set_project_context': {
        store.setProjectContext(
          args?.project_id as string,
          args?.context as object
        );
        return {
          content: [
            { type: 'text', text: `Project '${args?.project_id}' context saved` },
          ],
        };
      }

      case 'get_sync_history': {
        const history = store.getSyncHistory(args?.limit as number | undefined);
        return {
          content: [{ type: 'text', text: JSON.stringify(history, null, 2) }],
        };
      }

      case 'search_agents': {
        const allAgents = store.listAgents();
        const query = (args?.query as string).toLowerCase();
        const matches = allAgents.filter(
          (a) =>
            a.name.toLowerCase().includes(query) ||
            a.content.toLowerCase().includes(query)
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                matches.map((a) => ({
                  name: a.name,
                  category: a.category,
                  version: a.version,
                })),
                null,
                2
              ),
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Claude Agents MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
