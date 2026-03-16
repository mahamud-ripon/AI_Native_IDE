/**
 * Test Generation Feature Module
 * 
 * AI-powered unit test generation.
 */

// Service
export {
  TestGenerationService,
  getTestGenerationService,
  createTestGenerationService,
  generateTests,
} from './test_generation_service.js';

// Types
export {
  TestFramework,
  TestType,
  TestGenerationStatus,
  CoverageLevel,
  TestGenerationRequest,
  TestTarget,
  TestGenerationOptions,
  GeneratedTest,
  TestCase,
  MockDefinition,
  FixtureDefinition,
  TestCoverage,
  TestGenerationResult,
  TestGenerationSummary,
  TestGenerationMetrics,
  TestFileTemplate,
  TestGenerationConfig,
  TEST_GENERATION_DEFAULTS,
  FRAMEWORK_TEMPLATES,
  COVERAGE_DESCRIPTIONS,
} from './test_generation_types.js';
