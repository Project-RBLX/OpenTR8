# syntax=docker/dockerfile:1

# ============================================
# Base stage - shared between build and runtime
# ============================================
FROM node:20-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

# Set working directory
WORKDIR /app

# ============================================
# Dependencies stage - install all dependencies
# ============================================
FROM base AS deps

# Copy workspace configuration files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/database/package.json ./packages/database/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ============================================
# Build stage - compile TypeScript
# ============================================
FROM base AS builder

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules

# Copy source code
COPY . .

# Generate Prisma Client
RUN pnpm --filter @opentr8/database db:generate

# Build all packages in dependency order
RUN pnpm build

# Prune dev dependencies
RUN pnpm prune --prod

# ============================================
# Production stage - minimal runtime image
# ============================================
FROM node:20-alpine AS runner

# Security: run as non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 opentr8

WORKDIR /app

# Copy production dependencies
COPY --from=builder --chown=opentr8:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=opentr8:nodejs /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder --chown=opentr8:nodejs /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=builder --chown=opentr8:nodejs /app/packages/shared/node_modules ./packages/shared/node_modules

# Copy built artifacts
COPY --from=builder --chown=opentr8:nodejs /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=opentr8:nodejs /app/apps/api/package.json ./apps/api/
COPY --from=builder --chown=opentr8:nodejs /app/packages/database/dist ./packages/database/dist
COPY --from=builder --chown=opentr8:nodejs /app/packages/database/package.json ./packages/database/
COPY --from=builder --chown=opentr8:nodejs /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=opentr8:nodejs /app/packages/shared/package.json ./packages/shared/

# Copy Prisma schema and generated client
COPY --from=builder --chown=opentr8:nodejs /app/packages/database/prisma ./packages/database/prisma

# Copy root package.json for workspace resolution
COPY --from=builder --chown=opentr8:nodejs /app/package.json ./
COPY --from=builder --chown=opentr8:nodejs /app/pnpm-workspace.yaml ./

USER opentr8

# Environment configuration
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the API
CMD ["node", "apps/api/dist/index.js"]
