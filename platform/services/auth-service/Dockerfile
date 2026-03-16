# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Enable corepack and prepare pnpm
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Copy package files
COPY package.json pnpm-workspace.yaml* ./
COPY pnpm-lock.yaml* ./

# Copy workspace packages
COPY packages/config ./packages/config
COPY packages/database ./packages/database
COPY packages/shared-types ./packages/shared-types

# Copy auth-service package files
COPY services/auth-service/package.json ./services/auth-service/
COPY services/auth-service/tsconfig.json ./services/auth-service/

# Install dependencies for all workspace packages and auth-service
RUN pnpm install --filter @workspace/database... --filter @workspace/config... --filter @workspace/shared-types... --filter @ai-ide/auth-service...

# Generate Prisma client
RUN pnpm --filter @workspace/database db:generate

# Build workspace packages
RUN pnpm --filter @workspace/config build
RUN pnpm --filter @workspace/shared-types build
RUN pnpm --filter @workspace/database build

# Copy source code
COPY services/auth-service/src ./services/auth-service/src

# Build TypeScript
WORKDIR /app/services/auth-service
RUN pnpm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Enable corepack and prepare pnpm
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy entire workspace structure from builder (preserves pnpm symlinks)
COPY --from=builder /app ./

# Expose port
EXPOSE 8002

# Switch to non-root user
USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8002/health || exit 1

# Run the service from workspace root (module resolution works via pnpm symlinks)
CMD ["node", "services/auth-service/dist/index.js"]
