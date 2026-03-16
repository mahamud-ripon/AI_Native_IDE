/**
 * Test Generation Types
 * 
 * Type definitions for AI-powered test generation.
 */

// Test framework
export type TestFramework =
  | 'jest'
  | 'vitest'
  | 'mocha'
  | 'pytest'
  | 'go_test'
  | 'junit'
  | 'xctest';

// Test type
export type TestType =
  | 'unit'
  | 'integration'
  | 'e2e'
  | 'snapshot'
  | 'mutation';

// Test generation status
export type TestGenerationStatus =
  | 'pending'
  | 'analyzing'
  | 'generating'
  | 'validating'
  | 'completed'
  | 'failed';

// Test coverage level
export type CoverageLevel = 'basic' | 'standard' | 'comprehensive' | 'exhaustive';

// Test generation request
export interface TestGenerationRequest {
  id: string;
  workspaceId: string;
  userId: string;
  target: TestTarget;
  options?: TestGenerationOptions;
  timestamp: Date;
}

// Test target
export interface TestTarget {
  type: 'file' | 'function' | 'class' | 'module' | 'selection';
  path: string;
  content?: string;
  functionName?: string;
  className?: string;
  selection?: {
    startLine: number;
    endLine: number;
    content: string;
  };
  language: string;
}

// Test generation options
export interface TestGenerationOptions {
  framework?: TestFramework;
  testType?: TestType;
  coverageLevel?: CoverageLevel;
  includeEdgeCases?: boolean;
  includeErrorCases?: boolean;
  includeMocking?: boolean;
  generateFixtures?: boolean;
  maxTests?: number;
  outputDir?: string;
  namingConvention?: 'descriptive' | 'short' | 'behavioral';
}

// Generated test
export interface GeneratedTest {
  id: string;
  path: string;
  content: string;
  testCases: TestCase[];
  imports: string[];
  mocks: MockDefinition[];
  fixtures: FixtureDefinition[];
  coverage: TestCoverage;
}

// Test case
export interface TestCase {
  id: string;
  name: string;
  description: string;
  type: 'positive' | 'negative' | 'edge_case' | 'error';
  input?: unknown;
  expectedOutput?: unknown;
  assertions: string[];
}

// Mock definition
export interface MockDefinition {
  target: string;
  type: 'function' | 'module' | 'class';
  returnValue?: unknown;
  implementation?: string;
}

// Fixture definition
export interface FixtureDefinition {
  name: string;
  type: string;
  data: unknown;
}

// Test coverage
export interface TestCoverage {
  functions: number;
  branches: number;
  lines: number;
  statements: number;
  estimatedPercentage: number;
}

// Test generation result
export interface TestGenerationResult {
  id: string;
  requestId: string;
  success: boolean;
  status: TestGenerationStatus;
  tests: GeneratedTest[];
  summary: TestGenerationSummary;
  warnings?: string[];
  error?: string;
  metrics: TestGenerationMetrics;
}

// Test generation summary
export interface TestGenerationSummary {
  testsGenerated: number;
  testCasesCreated: number;
  filesCreated: number;
  estimatedCoverage: number;
  testFilePaths: string[];
}

// Test generation metrics
export interface TestGenerationMetrics {
  analysisMs: number;
  generationMs: number;
  validationMs: number;
  totalMs: number;
  tokensUsed: number;
}

// Test file template
export interface TestFileTemplate {
  framework: TestFramework;
  language: string;
  imports: string[];
  setup: string;
  teardown: string;
  testCaseTemplate: string;
}

// Test generation config
export interface TestGenerationConfig {
  defaultFramework: TestFramework;
  defaultCoverageLevel: CoverageLevel;
  maxTestsPerFile: number;
  includeEdgeCasesByDefault: boolean;
  includeErrorCasesByDefault: boolean;
  validateGeneratedTests: boolean;
}

// Default configuration
export const TEST_GENERATION_DEFAULTS: Required<TestGenerationConfig> = {
  defaultFramework: 'jest',
  defaultCoverageLevel: 'standard',
  maxTestsPerFile: 20,
  includeEdgeCasesByDefault: true,
  includeErrorCasesByDefault: true,
  validateGeneratedTests: true,
} as const;

// Framework templates
export const FRAMEWORK_TEMPLATES: Record<TestFramework, TestFileTemplate> = {
  jest: {
    framework: 'jest',
    language: 'typescript',
    imports: ["import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';"],
    setup: 'beforeEach(() => {\n  // setup\n});',
    teardown: 'afterEach(() => {\n  // cleanup\n});',
    testCaseTemplate: "it('should {{description}}', () => {\n  {{body}}\n});",
  },
  vitest: {
    framework: 'vitest',
    language: 'typescript',
    imports: ["import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';"],
    setup: 'beforeEach(() => {\n  // setup\n});',
    teardown: 'afterEach(() => {\n  // cleanup\n});',
    testCaseTemplate: "it('should {{description}}', () => {\n  {{body}}\n});",
  },
  mocha: {
    framework: 'mocha',
    language: 'javascript',
    imports: ["const { describe, it, beforeEach, afterEach } = require('mocha');", "const { expect } = require('chai');"],
    setup: 'beforeEach(() => {\n  // setup\n});',
    teardown: 'afterEach(() => {\n  // cleanup\n});',
    testCaseTemplate: "it('should {{description}}', () => {\n  {{body}}\n});",
  },
  pytest: {
    framework: 'pytest',
    language: 'python',
    imports: ['import pytest'],
    setup: '@pytest.fixture\ndef setup():\n    # setup\n    yield\n    # cleanup',
    teardown: '',
    testCaseTemplate: "def test_{{name}}():\n    {{body}}",
  },
  go_test: {
    framework: 'go_test',
    language: 'go',
    imports: ['import "testing"'],
    setup: '',
    teardown: '',
    testCaseTemplate: "func Test{{Name}}(t *testing.T) {\n    {{body}}\n}",
  },
  junit: {
    framework: 'junit',
    language: 'java',
    imports: ['import org.junit.jupiter.api.*;', 'import static org.junit.jupiter.api.Assertions.*;'],
    setup: '@BeforeEach\nvoid setUp() {\n    // setup\n}',
    teardown: '@AfterEach\nvoid tearDown() {\n    // cleanup\n}',
    testCaseTemplate: "@Test\nvoid test{{Name}}() {\n    {{body}}\n}",
  },
  xctest: {
    framework: 'xctest',
    language: 'swift',
    imports: ['import XCTest', '@testable import Module'],
    setup: 'override func setUp() {\n    super.setUp()\n}',
    teardown: 'override func tearDown() {\n    super.tearDown()\n}',
    testCaseTemplate: "func test{{Name}}() {\n    {{body}}\n}",
  },
} as const;

// Coverage level descriptions
export const COVERAGE_DESCRIPTIONS: Record<CoverageLevel, string> = {
  basic: 'Generate basic happy path tests only',
  standard: 'Include edge cases and error scenarios',
  comprehensive: 'Add boundary tests and mock external dependencies',
  exhaustive: 'Generate all possible test scenarios including mutations',
} as const;
