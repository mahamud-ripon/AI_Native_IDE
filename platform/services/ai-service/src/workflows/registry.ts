/**
 * Workflow Definition Registry
 * 
 * Central registry for workflow definitions.
 * Supports dynamic registration and lookup.
 */

import type { WorkflowDefinition, WorkflowRegistry } from './types.js';

class WorkflowRegistryImpl implements WorkflowRegistry {
  private workflows: Map<string, WorkflowDefinition> = new Map();

  get(name: string): WorkflowDefinition | undefined {
    return this.workflows.get(name);
  }

  register(definition: WorkflowDefinition): void {
    if (this.workflows.has(definition.name)) {
      console.warn(`Workflow "${definition.name}" already registered, overwriting`);
    }
    
    // Validate step indices are sequential
    for (let i = 0; i < definition.steps.length; i++) {
      if (definition.steps[i].stepIndex !== i) {
        throw new Error(
          `Invalid step index at position ${i}: expected ${i}, got ${definition.steps[i].stepIndex}`
        );
      }
    }
    
    this.workflows.set(definition.name, definition);
  }

  list(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  has(name: string): boolean {
    return this.workflows.has(name);
  }
}

// Singleton instance
let registryInstance: WorkflowRegistry | null = null;

/**
 * Get the global workflow registry instance
 */
export function getWorkflowRegistry(): WorkflowRegistry {
  if (!registryInstance) {
    registryInstance = new WorkflowRegistryImpl();
  }
  return registryInstance;
}

/**
 * Reset the registry (for testing)
 */
export function resetRegistry(): void {
  registryInstance = null;
}
