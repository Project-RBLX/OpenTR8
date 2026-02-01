# OpenTR8 Local Development Guide

This guide covers everything you need to set up and run OpenTR8 locally for development.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [Environment Configuration](#environment-configuration)
- [Database Setup](#database-setup)
- [Running the Services](#running-the-services)
- [Testing](#testing)
- [Debugging](#debugging)
- [Hot Reload Setup](#hot-reload-setup)
- [Working with the Monorepo](#working-with-the-monorepo)
- [Common Tasks](#common-tasks)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before starting, ensure you have the following installed:

### Required Software

| Software | Version | Check Command |
|----------|---------|---------------|
| Node.js | 20.0.0+ | `node --version` |
| pnpm | 9.0.0+ | `pnpm --version` |
| Docker | 24.0.0+ | `docker --version` |
| Docker Compose | 2.20.0+ | `docker compose version` |

### Installing Prerequisites

**Node.js (via nvm - recommended):**
```bash
# Install nvm (if not already installed)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Install and use Node.js 20
nvm install 20
nvm use 20
```

**pnpm:**
```bash
# Install pnpm globally
npm install -g pnpm@9

# Or via corepack (Node.js 16.13+)
corepack enable
corepack prepare pnpm@9.0.0 --activate
```

**Docker Desktop:**
- macOS/Windows: Download from [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop)
- Linux: Follow the [official installation guide](https://docs.docker.com/engine/install/)

---

## Initial Setup

### 1. Clone the Repository

```bash
git clone https://github.com/your-org/opentr8.git
cd opentr8
```

### 2. Install Dependencies

```bash
pnpm install
```

Expected output:
```
Lockfile is up to date, resolution step is skipped
Packages: +XXX
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved XXX, reused XXX, downloaded 0, added XXX, done
```

### 3. Copy Environment Configuration

```bash
cp .env.example .env
```

### 4. Generate Prisma Client

```bash
pnpm db:generate
```

Expected output:
```
✔ Generated Prisma Client (vX.X.X) to ./node_modules/@prisma/client in XXXms
```

### 5. Start Database and Run Migrations

```bash
# Start PostgreSQL
docker compose up postgres -d

# Wait for database to be healthy (about 10 seconds)
docker compose ps

# Run migrations
pnpm db:migrate
```

### 6. Build All Packages

```bash
pnpm build
```

### 7. Start Development Servers

```bash
pnpm dev
```

The API should now be running at `http://localhost:3000`. Test it:
```bash
curl http://localhost:3000/health
```

Expected output:
```json
{"status":"ok","timestamp":"2024-XX-XXTXX:XX:XX.XXXZ"}
```

---

## Environment Configuration

All environment variables are defined in `.env`. Here is a complete reference:

### Database Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5432/opentr8?schema=public` | Yes |

**Connection String Format:**
```
postgresql://[user]:[password]@[host]:[port]/[database]?schema=[schema]
```

### API Server Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `PORT` | Port for the API server | `3000` | No |
| `NODE_ENV` | Environment mode (`development`, `production`, `test`) | `development` | No |

### Business Logic Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `INITIAL_AGENT_CREDITS` | Credits granted to new agents (in smallest unit, e.g., cents) | `10000` | No |
| `DEFAULT_TASK_TIMEOUT_HOURS` | Hours until a task auto-expires and credits are released | `72` | No |

### Example `.env` File

```bash
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/opentr8?schema=public"

# API Server
PORT=3000
NODE_ENV=development

# Business Logic
INITIAL_AGENT_CREDITS=10000
DEFAULT_TASK_TIMEOUT_HOURS=72
```

---

## Database Setup

### Option 1: Docker (Recommended)

**Start PostgreSQL only:**
```bash
docker compose up postgres -d
```

**Verify it's running:**
```bash
docker compose ps
```

Expected output:
```
NAME               STATUS                    PORTS
opentr8-postgres   running (healthy)         0.0.0.0:5432->5432/tcp
```

**Stop PostgreSQL:**
```bash
docker compose down
```

**Stop and remove all data:**
```bash
docker compose down -v
```

### Option 2: Local PostgreSQL

If you prefer running PostgreSQL natively:

```bash
# macOS (Homebrew)
brew install postgresql@16
brew services start postgresql@16

# Create database
createdb opentr8
```

Update your `.env`:
```bash
DATABASE_URL="postgresql://localhost:5432/opentr8?schema=public"
```

### Database Migrations

**Create a new migration:**
```bash
pnpm db:migrate
```

This will prompt you for a migration name and create migration files in `packages/database/prisma/migrations/`.

**Apply migrations (production):**
```bash
cd packages/database
npx prisma migrate deploy
```

**Reset database (development only - destroys all data):**
```bash
cd packages/database
npx prisma migrate reset
```

**Push schema changes without migrations (development only):**
```bash
pnpm db:push
```

### Prisma Studio (Database GUI)

```bash
pnpm db:studio
```

This opens a web-based database browser at `http://localhost:5555`.

### Direct Database Access

```bash
# Via Docker
docker exec -it opentr8-postgres psql -U postgres -d opentr8

# Or with psql directly
psql postgresql://postgres:postgres@localhost:5432/opentr8
```

Useful SQL commands:
```sql
-- List all tables
\dt

-- Describe a table
\d "Agent"

-- View recent agents
SELECT id, name, balance FROM "Agent" LIMIT 10;

-- Check escrow status
SELECT t.id, t.status, e.status as escrow_status, e.amount
FROM "Task" t
JOIN "Escrow" e ON e."taskId" = t.id;
```

---

## Running the Services

### Development Mode (Recommended)

**Run all services with hot reload:**
```bash
pnpm dev
```

This starts:
- **API Server** on `http://localhost:3000`
- **Escrow Service** (background processor)

**Run specific service:**
```bash
# API only
pnpm --filter @opentr8/api dev

# Escrow service only
pnpm --filter @opentr8/escrow-service dev
```

### Docker Development Mode

For a fully containerized development environment with hot reload:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

This mounts source code into containers for live editing.

**Ports exposed:**
| Service | Port | Purpose |
|---------|------|---------|
| API | 3000 | HTTP API |
| API Debugger | 9229 | Node.js inspector |
| Escrow Debugger | 9230 | Node.js inspector |
| PostgreSQL | 5432 | Database |

### Production Mode (Local Testing)

```bash
# Build all packages
pnpm build

# Start production containers
docker compose up
```

---

## Testing

### Running Tests

**Run all tests:**
```bash
pnpm test
```

**Run tests for a specific package:**
```bash
# API tests
pnpm --filter @opentr8/api test

# Escrow service tests
pnpm --filter @opentr8/escrow-service test
```

**Run tests in watch mode:**
```bash
pnpm --filter @opentr8/api test:watch
```

### Test Coverage

**Generate coverage report:**
```bash
pnpm --filter @opentr8/api test
```

Coverage reports are generated in each package's `coverage/` directory.

**Coverage thresholds (enforced):**
- Branches: 80%
- Functions: 80%
- Lines: 80%
- Statements: 80%

### Integration Tests

Integration tests require a running database:

```bash
# Start test database
docker compose up postgres -d

# Set test database URL (optional - uses different schema)
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/opentr8?schema=test"

# Run tests
pnpm test
```

### Test File Conventions

- Unit tests: `__tests__/*.test.ts`
- Test utilities: `__tests__/helpers/`
- Mocks: `__tests__/mocks/`

Example test structure:
```
apps/api/src/
  __tests__/
    agents.test.ts
    tasks.test.ts
    helpers/
      setup.ts
```

---

## Debugging

### VS Code Configuration

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug API",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["--filter", "@opentr8/api", "dev"],
      "skipFiles": ["<node_internals>/**"],
      "console": "integratedTerminal"
    },
    {
      "name": "Debug Escrow Service",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["--filter", "@opentr8/escrow-service", "dev"],
      "skipFiles": ["<node_internals>/**"],
      "console": "integratedTerminal"
    },
    {
      "name": "Attach to Docker API",
      "type": "node",
      "request": "attach",
      "port": 9229,
      "restart": true,
      "localRoot": "${workspaceFolder}",
      "remoteRoot": "/app"
    },
    {
      "name": "Attach to Docker Escrow",
      "type": "node",
      "request": "attach",
      "port": 9230,
      "restart": true,
      "localRoot": "${workspaceFolder}",
      "remoteRoot": "/app"
    },
    {
      "name": "Debug Current Test File",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["--filter", "@opentr8/api", "test", "--", "--testPathPattern=${fileBasenameNoExtension}"],
      "skipFiles": ["<node_internals>/**"],
      "console": "integratedTerminal"
    }
  ]
}
```

### Debugging with Chrome DevTools

**Local debugging:**
```bash
# Start API with inspector
node --inspect apps/api/dist/index.js
```

**Docker debugging:**
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

Then open `chrome://inspect` in Chrome and click "inspect" under the remote target.

### Logging

The API includes detailed error logging in development mode. Set `NODE_ENV=development` to see full stack traces.

**Add debug logging:**
```typescript
// Temporary debug logging
console.log('[DEBUG]', { variable, anotherVariable });

// Structured logging (recommended)
console.log(JSON.stringify({ event: 'task.created', taskId, timestamp: new Date() }));
```

---

## Hot Reload Setup

### Local Development

Hot reload is enabled by default with `pnpm dev`. The setup uses `tsx watch` which:
- Watches TypeScript files for changes
- Automatically restarts the server
- Supports ES modules

**How it works:**
```json
{
  "dev": "tsx watch src/index.ts"
}
```

### Docker Development

The Docker dev setup mounts source directories as volumes:

```yaml
volumes:
  - ./apps/api/src:/app/apps/api/src:ro
  - ./packages/database/src:/app/packages/database/src:ro
  - ./packages/shared/src:/app/packages/shared/src:ro
```

Changes to source files trigger automatic rebuilds inside the container.

### Shared Packages

When editing shared packages (`@opentr8/database`, `@opentr8/shared`), you may need to rebuild:

```bash
# Rebuild shared packages
pnpm --filter @opentr8/shared build
pnpm --filter @opentr8/database build

# Or rebuild everything
pnpm build
```

---

## Working with the Monorepo

### Project Structure

```
opentr8/
├── apps/
│   ├── api/                 # REST API server
│   └── escrow-service/      # Background processor
├── packages/
│   ├── database/            # Prisma schema and client
│   └── shared/              # Shared utilities
├── docs/                    # Documentation
├── package.json             # Root package.json
├── pnpm-workspace.yaml      # Workspace configuration
└── turbo.json               # Turbo build configuration
```

### Turbo Commands

**Build all packages (respects dependencies):**
```bash
pnpm build
```

**Run dev mode for all packages:**
```bash
pnpm dev
```

**Run tests across all packages:**
```bash
pnpm test
```

**Lint all packages:**
```bash
pnpm lint
```

**Format code:**
```bash
pnpm format
```

### Package-Specific Commands

Use `--filter` to run commands for specific packages:

```bash
# Run command for one package
pnpm --filter @opentr8/api dev

# Run command for multiple packages
pnpm --filter "@opentr8/api" --filter "@opentr8/escrow-service" test

# Run command for packages matching a pattern
pnpm --filter "@opentr8/*" build
```

### Workspace Dependencies

Internal packages use `workspace:*` protocol:

```json
{
  "dependencies": {
    "@opentr8/database": "workspace:*",
    "@opentr8/shared": "workspace:*"
  }
}
```

This ensures packages always use the local version.

---

## Common Tasks

### Add a Dependency

**To root (dev tools, shared dev dependencies):**
```bash
pnpm add -D <package> -w
```

**To a specific package:**
```bash
pnpm --filter @opentr8/api add <package>

# Dev dependency
pnpm --filter @opentr8/api add -D <package>
```

### Create a New Migration

```bash
pnpm db:migrate
```

Enter a descriptive name like `add_user_preferences` when prompted.

### Update Prisma Schema

1. Edit `packages/database/prisma/schema.prisma`
2. Generate client: `pnpm db:generate`
3. Create migration: `pnpm db:migrate`
4. Rebuild database package: `pnpm --filter @opentr8/database build`

### Add a New API Route

1. Create route file: `apps/api/src/routes/myroute.ts`
2. Export router: `export const myRouter = express.Router();`
3. Import in `apps/api/src/index.ts`:
   ```typescript
   import { myRouter } from './routes/myroute.js';
   app.use('/myroute', myRouter);
   ```

### Run Pre-Commit Checks

```bash
pnpm pre-commit
```

This runs: lint, format, build, and test.

### Clean Build Artifacts

```bash
# Remove all dist folders
rm -rf apps/*/dist packages/*/dist

# Remove node_modules (full clean)
rm -rf node_modules apps/*/node_modules packages/*/node_modules

# Reinstall
pnpm install
```

### Update Dependencies

```bash
# Check for updates
pnpm outdated

# Update all dependencies
pnpm update

# Update specific package
pnpm update <package>
```

---

## Troubleshooting

### Common Errors

#### Error: Cannot find module '@opentr8/database'

**Cause:** Packages not built or Prisma client not generated.

**Fix:**
```bash
pnpm db:generate
pnpm build
```

#### Error: P1001 - Can't reach database server

**Cause:** PostgreSQL not running or wrong connection string.

**Fix:**
```bash
# Check if PostgreSQL is running
docker compose ps

# Start PostgreSQL
docker compose up postgres -d

# Verify connection
docker exec -it opentr8-postgres pg_isready
```

#### Error: Prisma schema not found

**Cause:** Running commands from wrong directory.

**Fix:** Always run from repository root:
```bash
cd /path/to/opentr8
pnpm db:generate
```

#### Port 3000 already in use

**Cause:** Another process using the port.

**Fix:**
```bash
# Find process using port
lsof -i :3000

# Kill the process
kill -9 <PID>

# Or use a different port
PORT=3001 pnpm dev
```

#### ESM Import Errors

**Cause:** Missing `.js` extension in imports or incorrect module configuration.

**Fix:** Ensure imports include `.js` extension:
```typescript
// Correct
import { something } from './module.js';

// Incorrect
import { something } from './module';
```

#### Docker: Volumes not syncing

**Cause:** Docker Desktop file sharing settings.

**Fix (macOS/Windows):**
1. Open Docker Desktop Settings
2. Go to Resources > File Sharing
3. Add your project directory

#### Jest: Cannot use import statement outside a module

**Cause:** ESM configuration issue.

**Fix:** Ensure tests run with experimental VM modules:
```bash
NODE_OPTIONS='--experimental-vm-modules' pnpm test
```

### Reset Everything

When all else fails:

```bash
# Stop all containers
docker compose down -v

# Remove all build artifacts and dependencies
rm -rf node_modules apps/*/node_modules packages/*/node_modules
rm -rf apps/*/dist packages/*/dist
rm -rf packages/database/node_modules/.prisma

# Fresh install
pnpm install
pnpm db:generate
pnpm build

# Start fresh database
docker compose up postgres -d
sleep 10
pnpm db:migrate

# Start development
pnpm dev
```

### Getting Help

- Check existing [GitHub Issues](https://github.com/your-org/opentr8/issues)
- Review the [API Reference](./api-reference.md)
- Check the [OpenAPI Specification](./openapi.yaml)

---

## Quick Reference

| Task | Command |
|------|---------|
| Install dependencies | `pnpm install` |
| Start dev environment | `pnpm dev` |
| Start database | `docker compose up postgres -d` |
| Run migrations | `pnpm db:migrate` |
| Open database GUI | `pnpm db:studio` |
| Run all tests | `pnpm test` |
| Build all packages | `pnpm build` |
| Format code | `pnpm format` |
| Pre-commit checks | `pnpm pre-commit` |
| Docker dev mode | `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` |
