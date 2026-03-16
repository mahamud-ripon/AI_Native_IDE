# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Enable corepack and prepare pnpm
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Copy package files
COPY package.json pnpm-workspace.yaml* ./
COPY pnpm-lock.yaml* ./

# Copy workspace packages
COPY packages/database ./packages/database
COPY packages/shared-types ./packages/shared-types
COPY packages/config ./packages/config

# Copy project-service package files
COPY services/project-service/package.json ./services/project-service/
COPY services/project-service/tsconfig.json ./services/project-service/

# Install dependencies for all workspace packages and project-service
RUN pnpm install --filter @workspace/database... --filter @workspace/config... --filter @workspace/shared-types... --filter @ai-ide/project-service...

# Generate Prisma client
RUN pnpm --filter @workspace/database db:generate

# Build workspace packages
RUN pnpm --filter @workspace/config build
RUN pnpm --filter @workspace/shared-types build
RUN pnpm --filter @workspace/database build

# Copy source code
COPY services/project-service/src ./services/project-service/src

# Build TypeScript
WORKDIR /app/services/project-service
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
EXPOSE 8003

# Switch to non-root user
USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8003/health || exit 1

# Run the service from workspace root (module resolution works via pnpm symlinks)
CMD ["node", "services/project-service/dist/index.js"]
