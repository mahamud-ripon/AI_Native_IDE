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

# Copy websocket-gateway package files
COPY services/websocket-gateway/package.json ./services/websocket-gateway/
COPY services/websocket-gateway/tsconfig.json ./services/websocket-gateway/

# Install dependencies for all workspace packages and websocket-gateway
RUN pnpm install --filter @workspace/database... --filter @workspace/config... --filter @workspace/shared-types... --filter @ai-ide/websocket-gateway...

# Generate Prisma client
RUN pnpm --filter @workspace/database db:generate

# Build workspace packages
RUN pnpm --filter @workspace/config build
RUN pnpm --filter @workspace/shared-types build
RUN pnpm --filter @workspace/database build

# Copy source code
COPY services/websocket-gateway/src ./services/websocket-gateway/src

# Build TypeScript
WORKDIR /app/services/websocket-gateway
RUN pnpm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Enable corepack and prepare pnpm
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S ws-gateway -u 1001

# Copy entire workspace structure from builder (preserves pnpm symlinks)
COPY --from=builder /app ./

# Expose port
EXPOSE 8012

# Switch to non-root user
USER ws-gateway

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8012/health || exit 1

# Run the service from workspace root (module resolution works via pnpm symlinks)
CMD ["node", "services/websocket-gateway/dist/index.js"]
