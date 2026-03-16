import CircuitBreaker from 'opossum';

/**
 * Circuit Breaker Configuration for Downstream Services
 * 
 * If a microservice fails 50% of requests or takes >5000ms for 10 consecutive calls,
 * the Circuit Breaker trips to "OPEN", instantly failing with 503 Service Unavailable.
 * This allows the service time to recover without being overwhelmed.
 */

interface CircuitBreakerOptions {
  timeout: number;        // Time in ms before considering a failure
  errorThresholdPercentage: number;  // % of failures before opening circuit
  resetTimeout: number;   // Time before attempting to close circuit
  rollingCountTimeout: number;
  rollingCountBuckets: number;
  volumeThreshold: number;
}

const defaultOptions: CircuitBreakerOptions = {
  timeout: 5000,           // 5 seconds
  errorThresholdPercentage: 50,  // Open after 50% failure rate
  resetTimeout: 30000,     // Try to close after 30 seconds
  rollingCountTimeout: 10000,    // 10 second rolling window
  rollingCountBuckets: 10,       // 10 buckets in the window
  volumeThreshold: 10,           // Minimum 10 requests before checking health
};

// Store circuit breakers by service name
const circuitBreakers = new Map<string, CircuitBreaker<any>>();

/**
 * Create or get a Circuit Breaker for a downstream service
 */
export function getCircuitBreaker(serviceName: string, options?: Partial<CircuitBreakerOptions>): CircuitBreaker<any> {
  if (circuitBreakers.has(serviceName)) {
    return circuitBreakers.get(serviceName)!;
  }

  // Create a dummy function that will be replaced by the actual proxy call
  const breaker = new CircuitBreaker(async () => {}, {
    ...defaultOptions,
    ...options,
    name: serviceName,
  });

  // Event listeners for monitoring
  breaker.on('open', () => {
    console.error(`[CircuitBreaker] ${serviceName} is now OPEN (failing fast)`);
  });

  breaker.on('halfOpen', () => {
    console.warn(`[CircuitBreaker] ${serviceName} is HALF-OPEN (testing recovery)`);
  });

  breaker.on('close', () => {
    console.info(`[CircuitBreaker] ${serviceName} is now CLOSED (healthy)`);
  });

  breaker.on('fallback', (result) => {
    console.warn(`[CircuitBreaker] ${serviceName} fallback executed`, result);
  });

  circuitBreakers.set(serviceName, breaker);
  return breaker;
}

/**
 * Check if a service is available (circuit closed or half-open)
 */
export function isServiceAvailable(serviceName: string): boolean {
  const breaker = circuitBreakers.get(serviceName);
  if (!breaker) {
    return true; // No breaker means we haven't seen it yet, assume healthy
  }
  return breaker.opened === false;
}

/**
 * Get circuit breaker state for a service
 */
export function getCircuitBreakerState(serviceName: string): {
  opened: boolean;
  halfOpen: boolean;
  shutdown: boolean;
  stats: any;
} {
  const breaker = circuitBreakers.get(serviceName);
  if (!breaker) {
    return { opened: false, halfOpen: false, shutdown: false, stats: null };
  }

  return {
    opened: breaker.opened,
    halfOpen: breaker.halfOpen,
    shutdown: breaker.shutdown,
    stats: {
      failures: breaker.stats.failures,
      successes: breaker.stats.successes,
      fallbacks: breaker.stats.fallbacks,
      rejects: breaker.stats.rejects,
      fires: breaker.stats.fires,
    },
  };
}

/**
 * Wrap a proxy function with circuit breaker protection
 */
export function wrapWithCircuitBreaker<T extends (...args: any[]) => any>(
  serviceName: string,
  fn: T,
  options?: Partial<CircuitBreakerOptions>
): CircuitBreaker<any> {
  const breaker = getCircuitBreaker(serviceName, options);
  
  // Replace the fire function with our actual proxy function
  (breaker as any).fire = async (...args: Parameters<T>): Promise<any> => {
    return await fn(...args);
  };

  return breaker;
}

/**
 * Get health status for all circuit breakers
 */
export function getAllCircuitBreakerStates(): Record<string, ReturnType<typeof getCircuitBreakerState>> {
  const states: Record<string, ReturnType<typeof getCircuitBreakerState>> = {};
  for (const [name] of circuitBreakers) {
    states[name] = getCircuitBreakerState(name);
  }
  return states;
}
