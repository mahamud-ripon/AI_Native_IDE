# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Enable corepack and prepare pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-workspace.yaml* ./
COPY pnpm-lock.yaml* ./

# Copy workspace packages
COPY packages/database ./packages/database
COPY packages/shared-types ./packages/shared-types
COPY packages/config ./packages/config

# Copy execution-service package files
COPY services/execution-service/package.json ./services/execution-service/
COPY services/execution-service/tsconfig.json ./services/execution-service/

# Install dependencies for execution-service and its workspace dependencies
RUN pnpm install --filter @workspace/database... --filter @ai-ide/execution-service...

# Generate Prisma client
RUN pnpm --filter @workspace/database db:generate

# Copy source code
COPY services/execution-service/src ./services/execution-service/src

# Build TypeScript
WORKDIR /app/services/execution-service
RUN pnpm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy package files from builder
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml* ./
COPY --from=builder /app/pnpm-lock.yaml* ./

# Copy workspace packages
COPY --from=builder /app/packages ./packages

# Copy built files from builder
COPY --from=builder /app/services/execution-service/dist ./dist
COPY --from=builder /app/services/execution-service/package.json ./package.json

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Expose port
EXPOSE 8004

# Switch to non-root user
USER nodejs

# Run the service
CMD ["node", "dist/index.js"]
