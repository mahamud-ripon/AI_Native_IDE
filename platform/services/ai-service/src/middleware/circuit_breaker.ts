import { config } from '../config.js';

export interface CircuitBreakerOptions {
  timeout?: number;
  errorThresholdPercentage?: number;
  resetTimeout?: number;
  volumeThreshold?: number;
}

export class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failures = 0;
  private lastFailureTime = 0;
  private nextAttempt = 0;
  
  private timeout: number;
  private errorThresholdPercentage: number;
  private resetTimeout: number;
  private volumeThreshold: number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.timeout = options.timeout || 30000;
    this.errorThresholdPercentage = options.errorThresholdPercentage || 50;
    this.resetTimeout = options.resetTimeout || 60000;
    this.volumeThreshold = options.volumeThreshold || 5;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker is open');
      }
      this.state = 'half-open';
    }

    try {
      const result = await this.executeWithTimeout(fn);
      
      if (this.state === 'half-open') {
        this.reset();
      }
      
      return result;
    } catch (error: any) {
      this.recordFailure();
      throw error;
    }
  }

  async *executeGenerator<T>(fn: () => AsyncGenerator<T>): AsyncGenerator<T> {
    if (this.state === 'open') {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker is open');
      }
      this.state = 'half-open';
    }

    try {
      for await (const item of fn()) {
        yield item;
      }
      if (this.state === 'half-open') {
        this.reset();
      }
    } catch (error: any) {
      this.recordFailure();
      throw error;
    }
  }

  private async executeWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Circuit breaker timeout'));
      }, this.timeout);

      fn()
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    const failurePercentage = (this.failures / this.volumeThreshold) * 100;
    
    if (failurePercentage >= this.errorThresholdPercentage || this.state === 'half-open') {
      this.state = 'open';
      this.nextAttempt = Date.now() + this.resetTimeout;
    }
  }

  private reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.lastFailureTime = 0;
    this.nextAttempt = 0;
  }

  getState(): { state: string; failures: number; nextAttempt: number } {
    return {
      state: this.state,
      failures: this.failures,
      nextAttempt: this.nextAttempt,
    };
  }
}

export const circuitBreaker = new CircuitBreaker({
  timeout: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT || '30000'),
  errorThresholdPercentage: parseInt(process.env.CIRCUIT_BREAKER_ERROR_THRESHOLD || '50'),
  resetTimeout: parseInt(process.env.CIRCUIT_BREAKER_RESET_TIMEOUT || '60000'),
  volumeThreshold: parseInt(process.env.CIRCUIT_BREAKER_VOLUME_THRESHOLD || '5'),
});
