# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY services/background-worker/package.json pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./

# Copy workspace packages
COPY packages/database ./packages/database
COPY packages/shared-types ./packages/shared-types
COPY packages/config ./packages/config

# Install dependencies
RUN pnpm install

# Copy source code
COPY services/background-worker/src ./src
COPY services/background-worker/tsconfig.json ./

# Build TypeScript
RUN pnpm build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY services/background-worker/package.json pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./

# Copy workspace packages
COPY packages/database ./packages/database
COPY packages/shared-types ./packages/shared-types
COPY packages/config ./packages/config

# Install production dependencies only
RUN pnpm install --prod

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Run the service
CMD ["node", "dist/index.js"]
