/**
 * Intent Classifier Service
 *
 * Classifies user prompts to determine the appropriate AI service:
 * - conversation: General chat, questions, explanations → Groq
 * - simple_edit: Quick edits, fixes, single file changes → ai-service
 * - complex_build: Full apps, features, multi-file changes → ai-agents
 */

export type Intent = 'conversation' | 'simple_edit' | 'complex_build';

export interface IntentResult {
  intent: Intent;
  confidence: number;
  reason?: string;
}

/**
 * Classify user prompt intent using rule-based matching
 * 
 * @param prompt - User's input message
 * @returns Intent classification result
 * 
 * @example
 * classify("hello") → { intent: 'conversation', confidence: 0.9 }
 * classify("build a todo app") → { intent: 'complex_build', confidence: 0.95 }
 * classify("fix this function") → { intent: 'simple_edit', confidence: 0.85 }
 */
export function classifyIntent(prompt: string): IntentResult {
  const p = prompt.toLowerCase().trim();
  
  // Score for each intent category
  let conversationScore = 0;
  let simpleEditScore = 0;
  let complexBuildScore = 0;
  
  // === CONVERSATION PATTERNS ===
  // Patterns that indicate general conversation or questions
  const conversationPatterns = [
    { pattern: /^hi|^hello|^hey|^hey,? (you|there)/i, score: 0.9 },
    { pattern: /^(what|how|why|when|where|who|can you|could you)/i, score: 0.85 },
    { pattern: /\?$/i, score: 0.7 }, // Ends with question mark
    { pattern: /(explain|understand|learn|help me understand)/i, score: 0.8 },
    { pattern: /^(tell me|show me|what is|what are)/i, score: 0.8 },
    { pattern: /(what does|what is the|what are the)/i, score: 0.85 },
    { pattern: /^(thanks|thank you|appreciate)/i, score: 0.9 },
    { pattern: /(working on|stuck on|confused about)/i, score: 0.6 },
    { pattern: /(best way|how to best|recommend)/i, score: 0.7 },
    { pattern: /^(help|help me)/i, score: 0.7 },
    { pattern: /(compare|diff|versus|vs\.?)/i, score: 0.8 },
    { pattern: /(tips|tricks|best practices)/i, score: 0.75 },
    // Code explanation requests (not creation)
    { pattern: /(explain|describe|what does|how does|what is).*(code|function|method|class)/i, score: 0.85 },
  ];
  
  // === SIMPLE EDIT PATTERNS ===
  // Patterns that indicate quick code edits/fixes
  const simpleEditPatterns = [
    { pattern: /^(fix|repair|debug|correct)\s+(this|the|an?)\s*/i, score: 0.9 },
    { pattern: /(add|insert)\s+.*(log|console|import)/i, score: 0.85 },
    { pattern: /(change|update|modify|edit)\s+.*(function|method|class|variable)/i, score: 0.8 },
    { pattern: /^(refactor|simplify|clean up)\s+(this|the)/i, score: 0.85 },
    { pattern: /(remove|delete|strip)\s+.*(code|line|comment)/i, score: 0.8 },
    { pattern: /^(write|create)\s+.*(function|method|hook|component)/i, score: 0.7 },
    { pattern: /(rename|rename variable|rename function)/i, score: 0.9 },
    { pattern: /(add|type)\s+.*(props|state|interface|type)/i, score: 0.75 },
    { pattern: /^(make|turn).*(work|functional|working)/i, score: 0.8 },
    { pattern: /(\.tsx?|\.py|\.js|\.ts)\s+(file|code)/i, score: 0.7 },
    { pattern: /(improve|optimize)\s+.*(performance|readability)/i, score: 0.75 },
    { pattern: /(convert|transform|change).*(to|from)/i, score: 0.75 },
    { pattern: /(design|scaffold|set up|setup|organize|organise).*(monorepo|workspace|folder structure|project structure|package\.json|tsconfig|vite|turbo)/i, score: 0.92 },
    { pattern: /(monorepo|workspace|folder structure|project structure).*(react|vite|next|pnpm|turbo|package)/i, score: 0.9 },
  ];
  
  // === COMPLEX BUILD PATTERNS ===
  // Patterns that indicate full application/feature development
  const complexBuildPatterns = [
    { pattern: /^(build|create|make|develop)\s+(a|an|me)\s+(full|complete)/i, score: 0.98 },
    { pattern: /^(build|create|make)\s+.*app/i, score: 0.95 },
    { pattern: /^(create|build|setup)\s+(new|full|complete)\s+project/i, score: 0.95 },
    { pattern: /(implement|add)\s+.*feature/i, score: 0.9 },
    { pattern: /(build|create|make).*(api|backend|server|database)/i, score: 0.95 },
    { pattern: /(setup|configure|install).*(from scratch|from zero)/i, score: 0.9 },
    { pattern: /(authentication|login|signup|oauth)/i, score: 0.9 },
    { pattern: /(crud|create|read|update|delete).*(api|operation)/i, score: 0.9 },
    { pattern: /(full.?stack|frontend and backend|both sides)/i, score: 0.98 },
    { pattern: /(react|vue|angular|nextjs|express|fastapi).*(and|with| Integration)/i, score: 0.85 },
    { pattern: /(database|postgres|mysql|mongodb|sql)/i, score: 0.9 },
    { pattern: /(rest api|graphql|endpoint)/i, score: 0.85 },
    { pattern: /(deploy|docker|kubernetes|ci\/cd)/i, score: 0.9 },
    { pattern: /(build|create|make|develop).*(landing page|portfolio|blog|e.?commerce)/i, score: 0.9 },
    { pattern: /(landing page|portfolio|blog|e.?commerce).*(site|website|app|project)/i, score: 0.82 },
    { pattern: /(clone|recreate|duplicate).*(site|app|website)/i, score: 0.95 },
    { pattern: /^(make).*(production ready|production grade)/i, score: 0.95 },
  ];
  
  // Calculate scores
  for (const { pattern, score } of conversationPatterns) {
    if (pattern.test(p)) conversationScore = Math.max(conversationScore, score);
  }
  
  for (const { pattern, score } of simpleEditPatterns) {
    if (pattern.test(p)) simpleEditScore = Math.max(simpleEditScore, score);
  }
  
  for (const { pattern, score } of complexBuildPatterns) {
    if (pattern.test(p)) complexBuildScore = Math.max(complexBuildScore, score);
  }

  const structureScaffoldPrompt =
    /(design|scaffold|set up|setup|organize|organise|create).*(monorepo|workspace|folder structure|project structure)/i.test(p)
    || /(package\.json|tsconfig|vite|turbo|pnpm workspace|workspaces)/i.test(p);

  if (structureScaffoldPrompt) {
    simpleEditScore = Math.max(simpleEditScore, 0.92);
    complexBuildScore = Math.min(complexBuildScore, 0.78);
  }
  
  // Also check for explicit negative patterns
  const negativePatterns = [
    // Don't classify as complex if these are present
    /\bbut\b/i,  // "build but fix this first" → not complex
    /\bsimple\b/i,  // "build simple app" → could be simple
    /\bone file\b/i,  // "create one file" → not complex
    /\bsmall\b/i,  // "build small app" → not complex
  ];
  
  let isNegativeComplex = false;
  for (const pattern of negativePatterns) {
    if (pattern.test(p)) {
      isNegativeComplex = true;
      break;
    }
  }
  
  // Override if negative pattern found
  if (isNegativeComplex && complexBuildScore > 0) {
    complexBuildScore *= 0.7;
  }
  
  // Determine final intent
  let intent: Intent;
  let confidence: number;
  
  // === QUICK CHECKS FOR COMMON CASES ===
  
  // Very short inputs (1-2 words) that are clearly greetings or questions
  const wordCount = p.split(/\s+/).length;
  const greetingWords = ['hi', 'hello', 'hey', 'yo', 'sup', 'howdy', 'greetings', 'hiya'];
  const isGreeting = greetingWords.some(gw => p === gw || p.startsWith(gw + ' ') || p.startsWith('hey ') || p === 'hey');
  
  // If it's a very short greeting or simple question, default to conversation
  if ((wordCount <= 2 && (isGreeting || conversationScore >= 0.3)) || isGreeting) {
    console.log(`[IntentClassifier] Short input detected: "${prompt}" -> conversation (greeting=${isGreeting}, words=${wordCount})`);
    return {
      intent: 'conversation',
      confidence: Math.max(conversationScore, 0.95),
      reason: `short_input: ${wordCount} words, greeting: ${isGreeting}`,
    };
  }
  // Priority: complex > simple > conversation
  else if (complexBuildScore >= 0.85) {
    intent = 'complex_build';
    confidence = complexBuildScore;
  } else if (simpleEditScore >= 0.8) {
    intent = 'simple_edit';
    confidence = simpleEditScore;
  } else {
    // Default to conversation — let the backend's LLM classifier decide
    // if the user actually wants to build something.
    // The backend is smarter than keyword matching.
    intent = 'conversation';
    confidence = conversationScore > 0 ? conversationScore : 0.7;
  }
  
  // Generate reason for logging/debugging
  const reason = `conversation=${conversationScore.toFixed(2)}, simple_edit=${simpleEditScore.toFixed(2)}, complex_build=${complexBuildScore.toFixed(2)}`;
  
  return { intent, confidence, reason };
}

/**
 * Get service URL based on intent
 */
export function getServiceForIntent(intent: Intent): {
  type: 'groq' | 'ai-service' | 'ai-agents';
  endpoint: string;
  streaming: boolean;
} {
  switch (intent) {
    case 'conversation':
      return { type: 'groq', endpoint: '/api/chat', streaming: true };
    case 'simple_edit':
      return { type: 'ai-service', endpoint: '/api/v1/ai/execution/tasks', streaming: false };
    case 'complex_build':
      return { type: 'ai-agents', endpoint: '/api/v1/workflow/stream', streaming: true };
  }
}

/**
 * Get intent label for display
 */
export function getIntentLabel(intent: Intent): string {
  switch (intent) {
    case 'conversation': return 'Chat';
    case 'simple_edit': return 'Quick Edit';
    case 'complex_build': return 'Build Project';
  }
}

export default classifyIntent;
