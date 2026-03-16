# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY apps/ide/package.json pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./

# Install dependencies
RUN pnpm install

# Copy source code
COPY apps/ide/src ./src
COPY apps/ide/index.html ./
COPY apps/ide/tsconfig.json ./
COPY apps/ide/vite.config.ts ./

# Build the application
RUN pnpm build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY apps/ide/package.json pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./

# Install production dependencies
RUN pnpm install --prod

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Expose port
EXPOSE 3000

# Run the application
CMD ["pnpm", "dev"]
