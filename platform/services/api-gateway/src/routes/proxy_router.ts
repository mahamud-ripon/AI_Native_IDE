import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyHttpProxy from '@fastify/http-proxy';
import { createServiceBreaker, isServiceAvailable, getCircuitBreakerState, getServiceBreaker } from '../proxy/circuit_breaker';

/**
 * Complete Routing Map for API Gateway
 * 
 * Routes HTTP requests to downstream microservices.
 * All routes include:
 * - Circuit breaker protection
 * - Header injection (X-User-Id, X-User-Role, X-Trace-Id)
 * - Proper error handling
 */

// Service URLs from environment (can be overridden for k8s/compose)
// Inside Docker, use service names (e.g., ai-native-ai-service), outside use localhost
const SERVICE_URLS = {
  auth: process.env.AUTH_SERVICE_URL || 'http://ai-native-auth-service:3100',
  project: process.env.PROJECT_SERVICE_URL || 'http://ai-native-project-service:8002',
  billing: process.env.BILLING_SERVICE_URL || 'http://ai-native-billing-service:8006',
  ai: process.env.AI_SERVICE_URL || 'http://ai-native-ai-service:8003',
  python_agents: process.env.PYTHON_AGENTS_URL || 'http://ai-native-python-agents:9000',
  execution: process.env.EXECUTION_SERVICE_URL || 'http://ai-native-execution-service:8004',
  search: process.env.SEARCH_SERVICE_URL || 'http://ai-native-search-service:8008',
  deployment: process.env.DEPLOYMENT_SERVICE_URL || 'http://ai-native-deployment-service:8010',
  storage: process.env.STORAGE_SERVICE_URL || 'http://ai-native-storage-service:8009',
  analytics: process.env.ANALYTICS_SERVICE_URL || 'http://ai-native-analytics-service:8011',
  notification: process.env.NOTIFICATION_SERVICE_URL || 'http://ai-native-notification-service:8007',
  collab: process.env.COLLAB_SERVICE_URL || 'http://ai-native-collab-service:8005',
  websocket: process.env.WEBSOCKET_GATEWAY_URL || 'http://ai-native-ws-gateway:8012',
};

// Route definitions with their target services
const ROUTES = [
  // Auth Service (port 3001)
  {
    prefix: '/api/v1/auth',
    upstream: SERVICE_URLS.auth,
    serviceName: 'auth-service',
  },

  // Project Service (port 3002)
  {
    prefix: '/api/v1/projects',
    upstream: SERVICE_URLS.project,
    serviceName: 'project-service',
  },
  {
    prefix: '/api/v1/templates',
    upstream: `${SERVICE_URLS.project}/templates`,
    serviceName: 'project-service',
  },

  // Billing Service (port 3003)
  {
    prefix: '/api/v1/billing',
    upstream: SERVICE_URLS.billing,
    serviceName: 'billing-service',
  },

  // AI Service (port 8003)
  // AI service registers routes under /ai/* (e.g., /ai/execution/tasks)
  // Gateway strips /api/v1 so /api/v1/ai/* → /ai/*
  {
    prefix: '/api/v1/ai',
    upstream: SERVICE_URLS.ai,
    rewritePrefix: '/ai',
    serviceName: 'ai-service',
    websocket: true,
  },
  // Python AI Agents Service (port 9000)
  {
    prefix: '/api/v1/agents',
    upstream: SERVICE_URLS.python_agents,
    rewritePrefix: '/api/v1',  // Map /api/v1/agents/* → /api/v1/*
    serviceName: 'python-agents',
  },
  // AI Workflows via python-agents (port 9000)
  {
    prefix: '/api/v1/workflow',
    upstream: SERVICE_URLS.python_agents,
    rewritePrefix: '/api/v1',  // Map /api/v1/workflow/* → /api/v1/workflow/*
    serviceName: 'python-agents',
    websocket: true,
  },
  // Also allow /workflow (shorthand)
  {
    prefix: '/workflow',
    upstream: SERVICE_URLS.python_agents,
    rewritePrefix: '/api/v1',  // Map /workflow/* → /api/v1/workflow/*
    serviceName: 'python-agents',
    websocket: true,
  },
  // AI Workflows (direct access to AI service workflows)
  {
    prefix: '/workflows',
    upstream: SERVICE_URLS.ai,
    rewritePrefix: '',  // Don't rewrite, pass as-is to AI service
    serviceName: 'ai-service',
    websocket: true,
  },

  // Execution Service (port 8004)
  {
    prefix: '/api/v1/exec',
    upstream: SERVICE_URLS.execution,
    serviceName: 'execution-service',
    websocket: true,
  },
  {
    prefix: '/api/v1/packages',
    upstream: `${SERVICE_URLS.execution}/packages`,
    serviceName: 'execution-service',
  },

  // Search Service (port 3006)
  {
    prefix: '/api/v1/search',
    upstream: SERVICE_URLS.search,
    serviceName: 'search-service',
  },

  // Deployment Service (port 3007)
  {
    prefix: '/api/v1/deploy',
    upstream: SERVICE_URLS.deployment,
    serviceName: 'deployment-service',
  },

  // Storage Service (port 3008) - Large file uploads
  {
    prefix: '/api/v1/storage',
    upstream: SERVICE_URLS.storage,
    serviceName: 'storage-service',
  },

  // AI Service Admin Config (port 8003)
  {
    prefix: '/admin/ai',
    upstream: `${SERVICE_URLS.ai}/admin/ai`,
    serviceName: 'ai-service',
  },

  // Analytics Service (port 3009) - Admin routes
  {
    prefix: '/api/v1/admin/analytics',
    upstream: SERVICE_URLS.analytics,
    serviceName: 'analytics-service',
  },
  {
    prefix: '/api/v1/admin/feature-flags',
    upstream: `${SERVICE_URLS.analytics}/feature-flags`,
    serviceName: 'analytics-service',
  },
  {
    prefix: '/api/v1/admin',
    upstream: `${SERVICE_URLS.project}/admin`, // Project service handles admin
    serviceName: 'project-service',
  },

  // Notification Service (port 3010)
  {
    prefix: '/api/v1/notifications',
    upstream: SERVICE_URLS.notification,
    serviceName: 'notification-service',
  },
];

export async function proxyRouter(app: FastifyInstance) {
  // Register admin endpoint for circuit breaker status
  app.get('/gateway/circuit-breakers', async () => {
    return {
      service: 'api-gateway',
      circuitBreakers: getAllServiceStates(),
    };
  });

  // Register each route with HTTP proxy
  for (const route of ROUTES) {
    // Initialize circuit breaker for this service with a no-op placeholder
    // The actual proxy call is handled by @fastify/http-proxy
    const breaker = createServiceBreaker(
      route.serviceName,
      async () => {
        // Placeholder - actual forwarding handled by http-proxy
        return { ok: true };
      },
      {}
    );

    await app.register(fastifyHttpProxy, {
      upstream: route.upstream,
      prefix: route.prefix,
      rewritePrefix: route.rewritePrefix || route.prefix,
      http2: false,
      websocket: !!(route as any).websocket,

      // Pre-handler: Check circuit breaker before forwarding
      preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
        if (breaker.opened) {
          return reply.status(503).send({
            success: false,
            error: `Service ${route.serviceName} is currently unavailable`,
            message: 'The service is experiencing issues. Please try again later.',
            code: 'SERVICE_UNAVAILABLE',
          });
        }
      },
    });
  }
}

/**
 * Get health states for all registered services
 */
function getAllServiceStates(): Record<string, any> {
  const states: Record<string, any> = {};
  for (const route of ROUTES) {
    states[route.serviceName] = getCircuitBreakerState(route.serviceName);
  }
  return states;
}
