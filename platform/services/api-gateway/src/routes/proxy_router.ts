import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyHttpProxy from '@fastify/http-proxy';
import { getCircuitBreaker, isServiceAvailable, getCircuitBreakerState } from '../proxy/circuit_breaker';

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
  auth: process.env.AUTH_SERVICE_URL || 'http://ai-native-auth-service:8002',
  project: process.env.PROJECT_SERVICE_URL || 'http://ai-native-project-service:8003',
  billing: process.env.BILLING_SERVICE_URL || 'http://ai-native-billing-service:8006',
  ai: process.env.AI_SERVICE_URL || 'http://ai-native-ai-service:8005',  // AI service port
  python_agents: process.env.PYTHON_AGENTS_URL || 'http://ai-native-python-agents:9000',  // Python AI Agents
  execution: process.env.EXECUTION_SERVICE_URL || 'http://ai-native-execution-service:8004',
  search: process.env.SEARCH_SERVICE_URL || 'http://ai-native-search-service:8007',
  deployment: process.env.DEPLOYMENT_SERVICE_URL || 'http://ai-native-deployment-service:8011',
  storage: process.env.STORAGE_SERVICE_URL || 'http://ai-native-storage-service:8009',
  analytics: process.env.ANALYTICS_SERVICE_URL || 'http://ai-native-analytics-service:8007',
  notification: process.env.NOTIFICATION_SERVICE_URL || 'http://ai-native-notification-service:8010',
  collab: process.env.COLLAB_SERVICE_URL || 'http://ai-native-collab-service:8008',
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

  // AI Service (port 8005)
  {
    prefix: '/api/v1/ai',
    upstream: SERVICE_URLS.ai,
    serviceName: 'ai-service',
  },
  // Python AI Agents Service (port 9000)
  {
    prefix: '/api/v1/agents',
    upstream: SERVICE_URLS.python_agents,
    rewritePrefix: '/api/v1',  // Map /api/v1/agents/* → /api/v1/*
    serviceName: 'python-agents',
  },
  // AI Workflows (direct access to AI service workflows)
  {
    prefix: '/workflows',
    upstream: SERVICE_URLS.ai,
    rewritePrefix: '',  // Don't rewrite, pass as-is to AI service
    serviceName: 'ai-service',
  },

  // Execution Service (port 3005)
  {
    prefix: '/api/v1/exec',
    upstream: SERVICE_URLS.execution,
    serviceName: 'execution-service',
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
    // Initialize circuit breaker for this service
    getCircuitBreaker(route.serviceName, {});

    await app.register(fastifyHttpProxy, {
      upstream: route.upstream,
      prefix: route.prefix,
      rewritePrefix: route.rewritePrefix || route.prefix,  // Use custom rewritePrefix if provided
      http2: false,

      // Pre-handler: Check circuit breaker before forwarding
      preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
        if (!isServiceAvailable(route.serviceName)) {
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
