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

# Copy collab-service package files
COPY services/collab-service/package.json ./services/collab-service/
COPY services/collab-service/tsconfig.json ./services/collab-service/

# Install dependencies for collab-service and its workspace dependencies
RUN pnpm install --filter @workspace/database... --filter @ai-ide/collab-service...

# Generate Prisma client
RUN pnpm --filter @workspace/database db:generate

# Copy source code
COPY services/collab-service/src ./services/collab-service/src

# Build TypeScript
WORKDIR /app/services/collab-service
RUN pnpm run build

# Production stage
FROM node:20-alpine AS runner

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
COPY --from=builder /app/services/collab-service/dist ./dist
COPY --from=builder /app/services/collab-service/package.json ./package.json

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Set environment
ENV NODE_ENV=production

# Expose port
EXPOSE 8008

# Switch to non-root user
USER nodejs

# Start the service
CMD ["node", "dist/index.js"]
