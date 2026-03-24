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

// Map: serviceName -> CircuitBreaker wrapping the real proxy fn
const circuitBreakers = new Map<string, CircuitBreaker<any>>();

/**
 * Create (or get) a circuit breaker that wraps a real async function.
 * The function passed here is what gets protected.
 */
export function createServiceBreaker<T extends (...args: any[]) => Promise<any>>(
  serviceName: string,
  fn: T,
  options?: Partial<CircuitBreakerOptions>
): CircuitBreaker<T> {
  if (circuitBreakers.has(serviceName)) {
    return circuitBreakers.get(serviceName)!;
  }

  // CORRECT: pass the real function to the constructor
  const breaker = new CircuitBreaker(fn, {
    ...defaultOptions,
    ...options,
    name: serviceName,
  });

  breaker.on('open', () => {
    console.error(`[CB] ${serviceName} OPEN`);
  });

  breaker.on('halfOpen', () => {
    console.warn(`[CB] ${serviceName} HALF-OPEN`);
  });

  breaker.on('close', () => {
    console.info(`[CB] ${serviceName} CLOSED`);
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
 * Get health status for all circuit breakers
 */
export function getAllCircuitBreakerStates(): Record<string, ReturnType<typeof getCircuitBreakerState>> {
  const states: Record<string, ReturnType<typeof getCircuitBreakerState>> = {};
  for (const [name] of circuitBreakers) {
    states[name] = getCircuitBreakerState(name);
  }
  return states;
}

/**
 * Get existing circuit breaker for a service (if created)
 */
export function getServiceBreaker(serviceName: string): CircuitBreaker<any> | undefined {
  return circuitBreakers.get(serviceName);
}
