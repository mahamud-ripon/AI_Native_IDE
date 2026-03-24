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
FROM nginx:1.27-alpine AS production

# Copy built files from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose port
EXPOSE 80
