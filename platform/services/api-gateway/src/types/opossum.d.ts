declare module 'opossum' {
  export interface CircuitBreakerOptions {
    timeout?: number;
    errorThresholdPercentage?: number;
    resetTimeout?: number;
    rollingCountTimeout?: number;
    rollingCountBuckets?: number;
    volumeThreshold?: number;
    name?: string;
  }

  export interface CircuitBreakerStats {
    failures: number;
    successes: number;
    fallbacks: number;
    rejects: number;
    fires: number;
  }

  export default class CircuitBreaker<T extends (...args: any[]) => any> {
    constructor(action: T, options?: CircuitBreakerOptions);
    
    fire(...args: Parameters<T>): Promise<ReturnType<T>>;
    
    readonly opened: boolean;
    readonly halfOpen: boolean;
    readonly shutdown: boolean;
    readonly stats: CircuitBreakerStats;
    
    on(event: 'open', listener: () => void): void;
    on(event: 'halfOpen', listener: () => void): void;
    on(event: 'close', listener: () => void): void;
    on(event: 'fallback', listener: (result: any) => void): void;
  }
}
