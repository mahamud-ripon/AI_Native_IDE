/**
 * Test Generation Service
 * 
 * AI-powered unit test generation for code.
 */

import * as crypto from 'crypto';
import * as path from 'path';
import {
  TestGenerationRequest,
  TestGenerationResult,
  TestGenerationStatus,
  GeneratedTest,
  TestCase,
  MockDefinition,
  FixtureDefinition,
  TestCoverage,
  TestGenerationSummary,
  TestGenerationMetrics,
  TestGenerationConfig,
  TestFramework,
  CoverageLevel,
  TEST_GENERATION_DEFAULTS,
  FRAMEWORK_TEMPLATES,
  COVERAGE_DESCRIPTIONS,
} from './test_generation_types.js';
import { WorkspaceFS } from '../../coding/workspace/workspace_fs.js';
import { LLMProvider, LLMMessage } from '../../coding/agent/agent_types.js';
import { getLLMProvider } from '../../coding/agent/plan_generator.js';
import { getTracer } from '../../observability/agent_tracing.js';
import { recordTokenUsage } from '../../observability/token_usage.js';

/**
 * Test Generation Service
 */
export class TestGenerationService {
  private config: Required<TestGenerationConfig>;
  private provider: LLMProvider | null = null;

  constructor(config?: Partial<TestGenerationConfig>) {
    this.config = { ...TEST_GENERATION_DEFAULTS, ...config } as Required<TestGenerationConfig>;
    this.provider = getLLMProvider();
  }

  /**
   * Set LLM provider
   */
  setProvider(provider: LLMProvider): void {
    this.provider = provider;
  }

  /**
   * Generate tests
   */
  async generateTests(
    request: TestGenerationRequest,
    workspace?: WorkspaceFS
  ): Promise<TestGenerationResult> {
    const startTime = Date.now();
    const tracer = getTracer();

    const traceId = tracer.startAgentTrace({
      agentId: 'test-generation',
      workspaceId: request.workspaceId,
      userId: request.userId,
      prompt: `Generate tests for ${request.target.path}`,
    });

    let analysisMs = 0;
    let generationMs = 0;
    let validationMs = 0;
    let tokensUsed = 0;

    try {
      // Get target content
      let targetContent = request.target.content;
      if (!targetContent && workspace) {
        targetContent = await workspace.readFile(request.target.path);
      }

      if (!targetContent) {
        throw new Error('No content available for test generation');
      }

      // Phase 1: Analyze target
      const analysisStart = Date.now();
      const analysis = this.analyzeTarget(targetContent, request.target);
      analysisMs = Date.now() - analysisStart;

      // Phase 2: Generate tests
      const generationStart = Date.now();
      const tests = await this.generateTestFiles(
        request,
        targetContent,
        analysis,
        workspace
      );
      generationMs = Date.now() - generationStart;

      // Phase 3: Validate tests (if enabled)
      if (this.config.validateGeneratedTests && workspace) {
        const validationStart = Date.now();
        await this.validateTests(tests, workspace);
        validationMs = Date.now() - validationStart;
      }

      // Write test files
      if (workspace && tests.length > 0) {
        await this.writeTestFiles(tests, workspace, request.options?.outputDir);
      }

      // Build summary
      const summary: TestGenerationSummary = {
        testsGenerated: tests.length,
        testCasesCreated: tests.reduce((sum, t) => sum + t.testCases.length, 0),
        filesCreated: tests.length,
        estimatedCoverage: tests.reduce((sum, t) => sum + t.coverage.estimatedPercentage, 0) / tests.length,
        testFilePaths: tests.map(t => t.path),
      };

      // Record token usage
      recordTokenUsage({
        workspaceId: request.workspaceId,
        userId: request.userId,
        provider: 'default',
        model: 'default',
        promptTokens: tokensUsed,
        completionTokens: 0,
      });

      tracer.endAgentTrace(traceId, true);

      const metrics: TestGenerationMetrics = {
        analysisMs,
        generationMs,
        validationMs,
        totalMs: Date.now() - startTime,
        tokensUsed,
      };

      return {
        id: this.generateId(),
        requestId: request.id,
        success: true,
        status: 'completed',
        tests,
        summary,
        metrics,
      };
    } catch (error) {
      tracer.endAgentTrace(traceId, false, error instanceof Error ? error.message : 'Unknown error');

      return {
        id: this.generateId(),
        requestId: request.id,
        success: false,
        status: 'failed',
        tests: [],
        summary: {
          testsGenerated: 0,
          testCasesCreated: 0,
          filesCreated: 0,
          estimatedCoverage: 0,
          testFilePaths: [],
        },
        error: error instanceof Error ? error.message : 'Unknown error',
        metrics: {
          analysisMs,
          generationMs,
          validationMs,
          totalMs: Date.now() - startTime,
          tokensUsed,
        },
      };
    }
  }

  /**
   * Analyze target code
   */
  private analyzeTarget(
    content: string,
    target: TestGenerationRequest['target']
  ): {
    functions: string[];
    classes: string[];
    exports: string[];
    dependencies: string[];
  } {
    const functions = this.extractFunctions(content);
    const classes = this.extractClasses(content);
    const exports = this.extractExports(content);
    const dependencies = this.extractDependencies(content);

    return { functions, classes, exports, dependencies };
  }

  /**
   * Extract function names
   */
  private extractFunctions(content: string): string[] {
    const functions: string[] = [];
    const regex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(/g;

    let match;
    while ((match = regex.exec(content)) !== null) {
      if (match[1]) functions.push(match[1]);
      if (match[2]) functions.push(match[2]);
    }

    return functions;
  }

  /**
   * Extract class names
   */
  private extractClasses(content: string): string[] {
    const classes: string[] = [];
    const regex = /(?:export\s+)?class\s+(\w+)/g;

    let match;
    while ((match = regex.exec(content)) !== null) {
      classes.push(match[1]);
    }

    return classes;
  }

  /**
   * Extract exports
   */
  private extractExports(content: string): string[] {
    const exports: string[] = [];
    const regex = /export\s+(?:{([^}]+)}|(\w+))/g;

    let match;
    while ((match = regex.exec(content)) !== null) {
      if (match[1]) {
        exports.push(...match[1].split(',').map(s => s.trim()));
      }
      if (match[2]) {
        exports.push(match[2]);
      }
    }

    return exports;
  }

  /**
   * Extract dependencies
   */
  private extractDependencies(content: string): string[] {
    const dependencies: string[] = [];
    const regex = /import\s+.*?from\s+['"]([^'"]+)['"]/g;

    let match;
    while ((match = regex.exec(content)) !== null) {
      dependencies.push(match[1]);
    }

    return dependencies;
  }

  /**
   * Generate test files
   */
  private async generateTestFiles(
    request: TestGenerationRequest,
    content: string,
    analysis: ReturnType<TestGenerationService['analyzeTarget']>,
    workspace?: WorkspaceFS
  ): Promise<GeneratedTest[]> {
    if (!this.provider) {
      throw new Error('LLM provider not configured');
    }

    const framework = request.options?.framework ?? this.config.defaultFramework;
    const coverageLevel = request.options?.coverageLevel ?? this.config.defaultCoverageLevel;
    const template = FRAMEWORK_TEMPLATES[framework];

    const tests: GeneratedTest[] = [];

    // Generate tests for each function/class
    const targets = [
      ...analysis.functions.map(f => ({ type: 'function', name: f })),
      ...analysis.classes.map(c => ({ type: 'class', name: c })),
    ];

    for (const target of targets.slice(0, request.options?.maxTests ?? this.config.maxTestsPerFile)) {
      const testFile = await this.generateTestForTarget(
        target.name,
        target.type,
        content,
        framework,
        coverageLevel,
        request.options,
        analysis
      );

      tests.push(testFile);
    }

    return tests;
  }

  /**
   * Generate test for a specific target
   */
  private async generateTestForTarget(
    targetName: string,
    targetType: string,
    sourceContent: string,
    framework: TestFramework,
    coverageLevel: CoverageLevel,
    options: TestGenerationRequest['options'],
    analysis: ReturnType<TestGenerationService['analyzeTarget']>
  ): Promise<GeneratedTest> {
    const template = FRAMEWORK_TEMPLATES[framework];

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `You are a test generation expert. Generate comprehensive unit tests using ${framework}.

Coverage level: ${coverageLevel} - ${COVERAGE_DESCRIPTIONS[coverageLevel]}

Requirements:
1. Include ${options?.includeEdgeCases ?? this.config.includeEdgeCasesByDefault ? 'edge cases' : ''}
2. Include ${options?.includeErrorCases ?? this.config.includeErrorCasesByDefault ? 'error scenarios' : ''}
3. ${options?.includeMocking ? 'Mock external dependencies' : 'Use real dependencies where possible'}
4. Follow ${options?.namingConvention ?? 'descriptive'} naming convention

Output the test code in a code block with the test file content.`,
      },
      {
        role: 'user',
        content: `Generate tests for ${targetType} "${targetName}":

\`\`\`${analysis.exports.length > 0 ? 'typescript' : 'javascript'}
${sourceContent.slice(0, 2000)}
\`\`\`

Dependencies: ${analysis.dependencies.join(', ') || 'none'}

Generate a complete test file.`,
      },
    ];

    if (!this.provider) {
      throw new Error('LLM provider not configured');
    }

    const response = await this.provider.complete(messages, {
      temperature: 0.3,
      maxTokens: 2000,
    });

    // Parse generated test
    const testContent = this.extractCodeBlock(response.content) ?? '';
    const testCases = this.parseTestCases(testContent, framework);
    const mocks = this.parseMocks(testContent);
    const fixtures = this.parseFixtures(testContent);

    // Estimate coverage
    const coverage: TestCoverage = {
      functions: targetType === 'function' ? 100 : 0,
      branches: coverageLevel === 'exhaustive' ? 90 : coverageLevel === 'comprehensive' ? 75 : 50,
      lines: 80,
      statements: 80,
      estimatedPercentage: coverageLevel === 'exhaustive' ? 90 : coverageLevel === 'comprehensive' ? 75 : 60,
    };

    const testPath = this.generateTestPath(targetName, framework);

    return {
      id: this.generateId(),
      path: testPath,
      content: testContent,
      testCases,
      imports: template.imports,
      mocks,
      fixtures,
      coverage,
    };
  }

  /**
   * Extract code block from response
   */
  private extractCodeBlock(content: string): string | null {
    const match = content.match(/```(?:\w+)?\n([\s\S]*?)```/);
    return match ? match[1].trim() : null;
  }

  /**
   * Parse test cases from content
   */
  private parseTestCases(content: string, framework: TestFramework): TestCase[] {
    const testCases: TestCase[] = [];

    // Match test definitions based on framework
    const patterns: Record<TestFramework, RegExp> = {
      jest: /it\s*\(\s*['"`]([^'"`]+)['"`]/g,
      vitest: /it\s*\(\s*['"`]([^'"`]+)['"`]/g,
      mocha: /it\s*\(\s*['"`]([^'"`]+)['"`]/g,
      pytest: /def\s+(test_\w+)/g,
      go_test: /func\s+(Test\w+)/g,
      junit: /void\s+(test\w+)/g,
      xctest: /func\s+(test\w+)/g,
    };

    const regex = patterns[framework];
    let match;
    let id = 0;

    while ((match = regex.exec(content)) !== null) {
      const name = match[1];
      if (name) {
        testCases.push({
          id: `tc-${id++}`,
          name,
          description: name,
          type: this.inferTestCaseType(name),
          assertions: [],
        });
      }
    }

    return testCases;
  }

  /**
   * Infer test case type from name
   */
  private inferTestCaseType(name: string): TestCase['type'] {
    const lower = name.toLowerCase();
    if (lower.includes('error') || lower.includes('fail') || lower.includes('throw')) {
      return 'error';
    }
    if (lower.includes('edge') || lower.includes('boundary') || lower.includes('limit')) {
      return 'edge_case';
    }
    if (lower.includes('invalid') || lower.includes('wrong') || lower.includes('bad')) {
      return 'negative';
    }
    return 'positive';
  }

  /**
   * Parse mocks from content
   */
  private parseMocks(content: string): MockDefinition[] {
    const mocks: MockDefinition[] = [];
    const regex = /jest\.mock\s*\(\s*['"`]([^'"`]+)['"`]/g;

    let match;
    while ((match = regex.exec(content)) !== null) {
      mocks.push({
        target: match[1],
        type: 'module',
      });
    }

    return mocks;
  }

  /**
   * Parse fixtures from content
   */
  private parseFixtures(content: string): FixtureDefinition[] {
    // Simple fixture extraction
    return [];
  }

  /**
   * Generate test file path
   */
  private generateTestPath(targetName: string, framework: TestFramework): string {
    const extensions: Record<TestFramework, string> = {
      jest: '.test.ts',
      vitest: '.test.ts',
      mocha: '.test.js',
      pytest: '_test.py',
      go_test: '_test.go',
      junit: 'Test.java',
      xctest: 'Tests.swift',
    };

    return `${targetName}${extensions[framework]}`;
  }

  /**
   * Validate generated tests
   */
  private async validateTests(
    tests: GeneratedTest[],
    workspace: WorkspaceFS
  ): Promise<void> {
    for (const test of tests) {
      // Basic syntax validation
      const openBraces = (test.content.match(/{/g) || []).length;
      const closeBraces = (test.content.match(/}/g) || []).length;

      if (openBraces !== closeBraces) {
        console.warn(`Unbalanced braces in test file: ${test.path}`);
      }
    }
  }

  /**
   * Write test files to workspace
   */
  private async writeTestFiles(
    tests: GeneratedTest[],
    workspace: WorkspaceFS,
    outputDir?: string
  ): Promise<void> {
    for (const test of tests) {
      const testPath = outputDir
        ? path.join(outputDir, test.path)
        : test.path;

      await workspace.writeFile(testPath, test.content);
    }
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    const hash = crypto.createHash('md5');
    hash.update(`test-${Date.now()}-${Math.random()}`);
    return hash.digest('hex').slice(0, 12);
  }
}

// Singleton instance
let defaultService: TestGenerationService | null = null;

/**
 * Get default test generation service
 */
export function getTestGenerationService(): TestGenerationService {
  if (!defaultService) {
    defaultService = new TestGenerationService();
  }
  return defaultService;
}

/**
 * Create test generation service
 */
export function createTestGenerationService(
  config?: Partial<TestGenerationConfig>
): TestGenerationService {
  return new TestGenerationService(config);
}

/**
 * Generate tests helper
 */
export async function generateTests(
  request: TestGenerationRequest,
  workspace?: WorkspaceFS
): Promise<TestGenerationResult> {
  return getTestGenerationService().generateTests(request, workspace);
}
