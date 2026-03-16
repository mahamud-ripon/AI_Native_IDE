# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Enable corepack and prepare pnpm
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Copy package files
COPY package.json pnpm-workspace.yaml* ./
COPY pnpm-lock.yaml* ./

# Copy workspace packages (including tsconfig.json files)
COPY packages/database ./packages/database
COPY packages/shared-types ./packages/shared-types
COPY packages/config ./packages/config

# Copy api-gateway package files
COPY services/api-gateway/package.json ./services/api-gateway/
COPY services/api-gateway/tsconfig.json ./services/api-gateway/

# Install dependencies for all workspace packages and api-gateway
RUN pnpm install --filter @workspace/database... --filter @workspace/config... --filter @workspace/shared-types... --filter @ai-ide/api-gateway...

# Generate Prisma client
RUN pnpm --filter @workspace/database db:generate

# Build workspace packages
RUN pnpm --filter @workspace/config build
RUN pnpm --filter @workspace/shared-types build
RUN pnpm --filter @workspace/database build

# Copy source code
COPY services/api-gateway/src ./services/api-gateway/src

# Build TypeScript
WORKDIR /app/services/api-gateway
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
EXPOSE 8000

# Switch to non-root user
USER nodejs

# Run the service from workspace root (module resolution works via pnpm symlinks)
CMD ["node", "services/api-gateway/dist/index.js"]
