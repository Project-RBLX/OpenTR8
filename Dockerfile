# =============================================================================
# OpenTR8 Multi-Stage Dockerfile
# Builds slim production images for api and escrow-service
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Base - Common setup with pnpm
# -----------------------------------------------------------------------------
FROM node:20-alpine AS base

# Install pnpm globally
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Set working directory
WORKDIR /app

# Install dependencies required for Prisma and native builds
RUN apk add --no-cache openssl libc6-compat

# -----------------------------------------------------------------------------
# Stage 2: Dependencies - Install all dependencies
# -----------------------------------------------------------------------------
FROM base AS deps

# Copy package files for dependency installation
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/escrow-service/package.json ./apps/escrow-service/
COPY packages/database/package.json ./packages/database/
COPY packages/shared/package.json ./packages/shared/

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# Stage 3: Build - Compile TypeScript and generate Prisma client
# -----------------------------------------------------------------------------
FROM base AS build

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/apps/escrow-service/node_modules ./apps/escrow-service/node_modules
COPY --from=deps /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules

# Copy all source files
COPY . .

# Generate Prisma client
RUN pnpm --filter @opentr8/database db:generate

# Build all packages with Turbo
RUN pnpm build

# Prune dev dependencies for production
RUN pnpm prune --prod

# -----------------------------------------------------------------------------
# Stage 4: Production - API Service
# -----------------------------------------------------------------------------
FROM node:20-alpine AS api

# Install only runtime dependencies
RUN apk add --no-cache openssl libc6-compat

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 opentr8
USER opentr8

WORKDIR /app

# Copy only what's needed for production
COPY --from=build --chown=opentr8:nodejs /app/package.json ./
COPY --from=build --chown=opentr8:nodejs /app/pnpm-workspace.yaml ./
COPY --from=build --chown=opentr8:nodejs /app/node_modules ./node_modules

# Copy built packages
COPY --from=build --chown=opentr8:nodejs /app/packages/database/dist ./packages/database/dist
COPY --from=build --chown=opentr8:nodejs /app/packages/database/package.json ./packages/database/
COPY --from=build --chown=opentr8:nodejs /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=build --chown=opentr8:nodejs /app/packages/database/prisma ./packages/database/prisma

COPY --from=build --chown=opentr8:nodejs /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=opentr8:nodejs /app/packages/shared/package.json ./packages/shared/

# Copy API service
COPY --from=build --chown=opentr8:nodejs /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=opentr8:nodejs /app/apps/api/package.json ./apps/api/
COPY --from=build --chown=opentr8:nodejs /app/apps/api/node_modules ./apps/api/node_modules

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the API
CMD ["node", "apps/api/dist/index.js"]

# -----------------------------------------------------------------------------
# Stage 5: Production - Escrow Service
# -----------------------------------------------------------------------------
FROM node:20-alpine AS escrow-service

# Install only runtime dependencies
RUN apk add --no-cache openssl libc6-compat

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 opentr8
USER opentr8

WORKDIR /app

# Copy only what's needed for production
COPY --from=build --chown=opentr8:nodejs /app/package.json ./
COPY --from=build --chown=opentr8:nodejs /app/pnpm-workspace.yaml ./
COPY --from=build --chown=opentr8:nodejs /app/node_modules ./node_modules

# Copy built packages
COPY --from=build --chown=opentr8:nodejs /app/packages/database/dist ./packages/database/dist
COPY --from=build --chown=opentr8:nodejs /app/packages/database/package.json ./packages/database/
COPY --from=build --chown=opentr8:nodejs /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=build --chown=opentr8:nodejs /app/packages/database/prisma ./packages/database/prisma

COPY --from=build --chown=opentr8:nodejs /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=opentr8:nodejs /app/packages/shared/package.json ./packages/shared/

# Copy escrow service
COPY --from=build --chown=opentr8:nodejs /app/apps/escrow-service/dist ./apps/escrow-service/dist
COPY --from=build --chown=opentr8:nodejs /app/apps/escrow-service/package.json ./apps/escrow-service/
COPY --from=build --chown=opentr8:nodejs /app/apps/escrow-service/node_modules ./apps/escrow-service/node_modules

# Set environment
ENV NODE_ENV=production

# Health check (basic process check since this is a background worker)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD pgrep -x node || exit 1

# Start the escrow service
CMD ["node", "apps/escrow-service/dist/index.js"]
