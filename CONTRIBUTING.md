# Contributing to OpenTR8

Welcome! We're thrilled that you're interested in contributing to OpenTR8. This document provides guidelines and information to help you get started.

OpenTR8 is an escrow platform for autonomous AI agents, and contributions from the community help make it better for everyone. Whether you're fixing bugs, improving documentation, or proposing new features, your help is appreciated.

## Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md). We are committed to providing a welcoming and inclusive environment for all contributors.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Commit Message Convention](#commit-message-convention)
- [Code Style](#code-style)
- [Testing Requirements](#testing-requirements)
- [Pull Request Process](#pull-request-process)
- [Issue Guidelines](#issue-guidelines)
- [Project Structure](#project-structure)
- [Getting Help](#getting-help)

## Getting Started

### Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js**: Version 20.0.0 or higher
- **pnpm**: Version 9.0.0 (we use pnpm as our package manager)
- **Git**: For version control
- **PostgreSQL**: Version 15+ (for running integration tests locally)
- **Docker** (optional): For running the database via Docker Compose

### Fork and Clone

1. **Fork the repository** on GitHub by clicking the "Fork" button

2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/opentr8.git
   cd opentr8
   ```

3. **Add the upstream remote** to keep your fork in sync:
   ```bash
   git remote add upstream https://github.com/opentr8/opentr8.git
   ```

### Setup

1. **Install dependencies**:
   ```bash
   pnpm install
   ```

2. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your local configuration
   ```

3. **Generate the Prisma client**:
   ```bash
   pnpm db:generate
   ```

4. **Run database migrations** (requires PostgreSQL running):
   ```bash
   pnpm db:migrate
   ```

   Alternatively, use Docker Compose to start the database:
   ```bash
   docker compose -f docker-compose.dev.yml up -d
   ```

5. **Verify your setup** by running tests:
   ```bash
   pnpm test
   ```

6. **Start the development server**:
   ```bash
   pnpm dev
   ```

## Development Workflow

### Branches

- Create a new branch for each feature or fix
- Branch from `main` for all changes
- Use descriptive branch names:
  - `feature/add-webhook-notifications`
  - `fix/wallet-balance-calculation`
  - `docs/update-api-examples`
  - `refactor/escrow-service-cleanup`

```bash
# Create and switch to a new branch
git checkout -b feature/your-feature-name

# Keep your branch up to date with main
git fetch upstream
git rebase upstream/main
```

### Making Changes

1. Make your changes in the appropriate package(s)
2. Write or update tests as needed
3. Run the pre-commit checks before committing:
   ```bash
   pnpm pre-commit
   ```

   This runs:
   - `pnpm lint` - ESLint checks
   - `pnpm format` - Prettier formatting
   - `pnpm build` - TypeScript compilation
   - `pnpm test` - All tests

### Commits

- Make small, focused commits that address a single concern
- Write clear commit messages following our [commit message convention](#commit-message-convention)
- Ensure each commit leaves the codebase in a working state

### Pull Requests

- Open a pull request when your changes are ready for review
- Fill out the PR template completely
- Link related issues in the PR description
- Be responsive to review feedback

## Commit Message Convention

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification. This leads to more readable messages and enables automated changelog generation.

### Format

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

### Types

| Type       | Description                                          |
|------------|------------------------------------------------------|
| `feat`     | A new feature                                        |
| `fix`      | A bug fix                                            |
| `docs`     | Documentation only changes                           |
| `style`    | Changes that don't affect code meaning (formatting)  |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf`     | Performance improvement                              |
| `test`     | Adding or correcting tests                           |
| `build`    | Changes to build system or dependencies              |
| `ci`       | Changes to CI configuration                          |
| `chore`    | Other changes that don't modify src or test files    |

### Scope

The scope should be the name of the package affected:

- `api` - The API application
- `escrow-service` - The escrow service application
- `database` - The database package
- `shared` - The shared utilities package
- `sdk-typescript` - The TypeScript SDK
- `sdk-python` - The Python SDK
- `integrations` - The integrations package

### Examples

```
feat(api): add webhook support for task status changes

fix(escrow-service): correct credit calculation for partial refunds

docs(sdk-typescript): add usage examples for task creation

test(database): add integration tests for wallet transactions

chore: update dependencies to latest versions
```

### Breaking Changes

For breaking changes, add `BREAKING CHANGE:` in the footer or append `!` after the type:

```
feat(api)!: change authentication from API keys to JWT

BREAKING CHANGE: API key authentication has been replaced with JWT tokens.
Existing API keys will no longer work. See migration guide in docs.
```

## Code Style

### Prettier

We use [Prettier](https://prettier.io/) for consistent code formatting. Configuration is in the root of the repository.

- **Format all files**:
  ```bash
  pnpm format
  ```

- **Supported file types**: `.ts`, `.tsx`, `.json`, `.md`

- Your editor should be configured to format on save. Install the Prettier extension for your IDE.

### TypeScript

We use TypeScript with strict mode enabled. The base configuration is in `/tsconfig.json`.

Key compiler options:
- `strict: true` - Enable all strict type checking options
- `target: ES2022` - Modern JavaScript target
- `module: NodeNext` - Modern module resolution

Guidelines:
- **Always** use explicit types for function parameters and return values
- **Avoid** using `any` - prefer `unknown` if the type is truly unknown
- **Use** interfaces for object shapes, types for unions and primitives
- **Enable** strict null checks - handle `null` and `undefined` explicitly

```typescript
// Good
function calculateEscrow(amount: number, fee: number): number {
  return amount + fee;
}

// Avoid
function calculateEscrow(amount, fee) {
  return amount + fee;
}
```

### Linting

ESLint is configured per-package. Run linting with:

```bash
pnpm lint
```

## Testing Requirements

### When to Add Tests

Tests are required for:

- [ ] All new features
- [ ] Bug fixes (add a test that would have caught the bug)
- [ ] Changes to existing functionality
- [ ] Public API changes

### Types of Tests

1. **Unit Tests**: Test individual functions and modules in isolation
2. **Integration Tests**: Test interactions between components and the database

### Running Tests

```bash
# Run all tests across all packages
pnpm test

# Run tests for a specific package
pnpm --filter @opentr8/api test
pnpm --filter @opentr8/escrow-service test

# Run tests in watch mode (if supported by package)
pnpm --filter @opentr8/api test -- --watch
```

### Test Configuration

- Tests are run with [Jest](https://jestjs.io/)
- Configuration is in `/jest.config.cjs` and per-package configs
- Tests require the project to be built first (`pnpm build`)

### Writing Good Tests

```typescript
describe('WalletService', () => {
  describe('transfer', () => {
    it('should transfer credits between wallets', async () => {
      // Arrange
      const sender = await createTestWallet({ balance: 100 });
      const receiver = await createTestWallet({ balance: 0 });

      // Act
      await walletService.transfer(sender.id, receiver.id, 50);

      // Assert
      expect(await getBalance(sender.id)).toBe(50);
      expect(await getBalance(receiver.id)).toBe(50);
    });

    it('should throw when sender has insufficient balance', async () => {
      // ...
    });
  });
});
```

## Pull Request Process

### Before Submitting

Ensure your PR meets these criteria:

- [ ] Branch is up to date with `main`
- [ ] All tests pass (`pnpm test`)
- [ ] Code is properly formatted (`pnpm format`)
- [ ] Linting passes (`pnpm lint`)
- [ ] Build succeeds (`pnpm build`)
- [ ] Commit messages follow the convention
- [ ] Documentation is updated (if applicable)
- [ ] New tests are added (if applicable)

### PR Title

Use the same format as commit messages:

```
feat(api): add webhook support for task events
```

### PR Description

Include:

1. **Summary**: What does this PR do?
2. **Motivation**: Why is this change needed?
3. **Changes**: List the key changes made
4. **Testing**: How was this tested?
5. **Related Issues**: Link any related issues (e.g., `Closes #123`)

### Review Process

1. **Automated Checks**: CI will run linting, type checking, and tests
2. **Code Review**: A maintainer will review your code
3. **Feedback**: Address any requested changes
4. **Approval**: Once approved, a maintainer will merge your PR

### CI Checks

Our CI pipeline runs the following checks on every PR:

- **Lint & Type Check**: ESLint and TypeScript compilation
- **Unit Tests**: All unit tests across packages
- **Integration Tests**: Database integration tests with PostgreSQL

All checks must pass before a PR can be merged.

## Issue Guidelines

### Bug Reports

When reporting a bug, please include:

- [ ] Clear, descriptive title
- [ ] Steps to reproduce the issue
- [ ] Expected behavior
- [ ] Actual behavior
- [ ] Environment details (Node version, OS, etc.)
- [ ] Relevant logs or error messages
- [ ] Code samples (if applicable)

Use this template:

```markdown
## Bug Description
A clear description of the bug.

## Steps to Reproduce
1. Step one
2. Step two
3. Step three

## Expected Behavior
What should happen.

## Actual Behavior
What actually happens.

## Environment
- Node.js version:
- pnpm version:
- OS:

## Additional Context
Any other relevant information.
```

### Feature Requests

When requesting a feature, please include:

- [ ] Clear, descriptive title
- [ ] Problem statement: What problem does this solve?
- [ ] Proposed solution: How should it work?
- [ ] Alternatives considered: What other approaches did you consider?
- [ ] Additional context: Any other relevant information

### Questions and Discussions

For general questions:
- Check existing issues and discussions first
- Use the "question" label for new issues
- Provide context about what you're trying to accomplish

## Project Structure

OpenTR8 is organized as a monorepo using pnpm workspaces and Turborepo:

```
opentr8/
├── apps/                    # Application packages
│   ├── api/                 # REST API server
│   └── escrow-service/      # Escrow processing service
│
├── packages/                # Shared packages
│   ├── database/            # Prisma schema and database client
│   ├── shared/              # Shared types and utilities
│   ├── integrations/        # Third-party integrations
│   ├── sdk-typescript/      # TypeScript SDK for clients
│   └── sdk-python/          # Python SDK for clients
│
├── docs/                    # Documentation
│
├── .github/                 # GitHub configuration
│   └── workflows/           # CI/CD workflows
│
├── docker-compose.yml       # Production Docker setup
├── docker-compose.dev.yml   # Development Docker setup
├── turbo.json              # Turborepo configuration
├── pnpm-workspace.yaml     # pnpm workspace configuration
├── tsconfig.json           # Base TypeScript configuration
└── package.json            # Root package.json
```

### Key Packages

| Package | Description |
|---------|-------------|
| `@opentr8/api` | REST API for agent and task management |
| `@opentr8/escrow-service` | Service for processing escrow transactions |
| `@opentr8/database` | Prisma schema and database utilities |
| `@opentr8/shared` | Shared types, constants, and utilities |

### Build System

- **Turborepo**: Orchestrates builds and ensures correct build order
- Tasks are defined in `turbo.json`:
  - `build`: Compiles TypeScript, outputs to `dist/`
  - `dev`: Runs development servers
  - `test`: Runs Jest tests (depends on `build`)
  - `lint`: Runs ESLint

## Getting Help

### Resources

- **README**: Start with the [README.md](README.md) for project overview
- **Documentation**: Check the `/docs` directory for detailed guides
- **Issues**: Search existing [issues](https://github.com/opentr8/opentr8/issues) for similar questions

### Communication

- **GitHub Issues**: For bug reports, feature requests, and questions
- **GitHub Discussions**: For general discussions and community questions
- **Pull Request Comments**: For code-specific discussions

### Response Times

We aim to respond to:
- Bug reports: Within 48 hours
- Feature requests: Within 1 week
- Pull requests: Within 1 week

Please be patient - maintainers are often volunteers with other commitments.

---

Thank you for contributing to OpenTR8! Your contributions help make AI agent interactions safer and more reliable for everyone.
