# Claude Agents MCP Server

A centralized MCP (Model Context Protocol) server for managing Claude agent definitions, configurations, and custom commands across multiple devices without file synchronization issues.

## Why This Exists

When syncing Claude configuration files via Nextcloud (or other sync services), file locking issues occur because:
- Claude Code holds locks on `history.jsonl`, `.update.lock`, and IDE files
- Multiple devices competing for the same files cause sync conflicts
- Session data constantly changes, creating sync storms

This MCP server solves these problems by:
- Serving configurations via HTTP/stdio (no file locks)
- Centralizing agent definitions in a SQLite database
- Providing version control and conflict resolution
- Enabling live updates across all connected Claude sessions

## Architecture

```
Claude Code (any machine)
    |
    | MCP protocol (stdio)
    v
claude-agents-mcp server
    |
    +-- SQLite store (agents, configs, metadata)
    |     single-writer, no file locks to fight sync clients
    |
    +-- Export layer
          writes agent definitions back out as files
          when a target machine needs them on disk
```

One writer (SQLite) replaces many synced files. Sync services stop fighting
Claude Code over file locks because the canonical state is no longer a
directory of loose files; machines pull from the server and export what they
need locally.

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Run migration to import existing configs
npm run migrate -- --source "G:/Nextcloud"

# Start development server
npm run dev
```

### Docker Deployment

```bash
# Build and run
docker-compose up -d

# View logs
docker-compose logs -f claude-agents-mcp
```

### Configure Claude Code

**IMPORTANT**: MCP servers are registered in your **global Claude config file**:
- **Linux/Mac**: `~/.claude.json`
- **Windows**: `C:\Users\<username>\.claude.json`

Add the MCP server configuration to this file (Claude Code may auto-add it when you first build the server):

```json
{
  "mcpServers": {
    "claude-agents": {
      "command": "node",
      "args": ["/absolute/path/to/claude-agents-mcp/dist/index.js"],
      "env": {
        "CONFIG_DATA_PATH": "/absolute/path/to/claude-agents-mcp/data"
      }
    }
  }
}
```

**Note**:
- Use **absolute paths** to the built server
- The server runs via **stdio** (starts when Claude Code starts, stops when it exits)
- It does NOT run as a background service - data persists in SQLite, process does not

Or for network access via HTTP API:

```json
{
  "mcpServers": {
    "claude-agents": {
      "url": "http://localhost:8765"
    }
  }
}
```

## MCP Tools

### Agent Management

| Tool | Description |
|------|-------------|
| `list_agents` | List all agents, optionally filtered by category |
| `get_agent` | Retrieve a specific agent definition |
| `publish_agent` | Create or update an agent |
| `delete_agent` | Remove an agent |
| `search_agents` | Search agents by name or content |

### Global Configuration

| Tool | Description |
|------|-------------|
| `get_global_config` | Get CLAUDE.md, session_init, or constraints |
| `set_global_config` | Update global configuration |

### Custom Commands

| Tool | Description |
|------|-------------|
| `list_commands` | List all custom slash commands |
| `get_command` | Retrieve a command definition |
| `publish_command` | Create or update a command |
| `delete_command` | Remove a command |

### Project Context

| Tool | Description |
|------|-------------|
| `get_project_context` | Get project-specific settings |
| `set_project_context` | Save project context |

### Utilities

| Tool | Description |
|------|-------------|
| `get_sync_history` | View recent changes |

## HTTP API Endpoints

When running the API server (`src/api.ts`):

```
GET    /api/agents              # List all agents
GET    /api/agents/:category    # List agents by category
GET    /api/agent/:name         # Get agent content
POST   /api/agent               # Create/update agent
DELETE /api/agent/:name         # Delete agent

GET    /api/config/:type        # Get global config
POST   /api/config/:type        # Set global config

GET    /api/commands            # List commands
GET    /api/command/:name       # Get command
POST   /api/command             # Create/update command
DELETE /api/command/:name       # Delete command

GET    /api/project/:id         # Get project context
POST   /api/project/:id         # Set project context

GET    /api/search?q=query      # Search agents
GET    /api/history?limit=50    # Sync history
GET    /health                  # Health check
```

## Agent Categories

| Category | Description |
|----------|-------------|
| `roles` | Role-based agents (SeniorArchitect, etc.) |
| `contexts` | Context-specific prompts (GeneralCoding, etc.) |
| `tasks` | Task-oriented agents (Refactor, Review, etc.) |
| `community` | Community-contributed agents |
| `brahma` | Brahma-series specialized agents |

## Migration

Import existing configurations from Nextcloud:

```bash
npm run migrate -- --source "G:/Nextcloud" --data "./data"
```

This will import:
- All agent definitions from `AgentConfigs/.claude/agents/`
- Agent templates from `AgentPrompts/`
- Global configs (CLAUDE.md, SESSION_INIT.md, AGENT_CONSTRAINTS.md)
- Custom commands from `.claude/commands/`

## Directory Structure

```
claude-agents-mcp/
├── src/
│   ├── index.ts      # MCP server (stdio)
│   ├── api.ts        # HTTP API wrapper
│   ├── db.ts         # SQLite storage layer
│   └── migrate.ts    # Migration script
├── data/
│   └── config.db     # SQLite database
├── docker-compose.yml
├── Dockerfile
└── Dockerfile.api
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CONFIG_DATA_PATH` | `./data` | Path to data directory |
| `API_PORT` | `8765` | HTTP API port |
| `NODE_ENV` | `development` | Environment mode |

## Development

```bash
# Watch mode
npm run dev

# Build
npm run build

# Run migration
npm run migrate

# Start production
npm start
```

## License

MIT
