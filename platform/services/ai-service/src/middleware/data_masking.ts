const SECRET_PATTERNS = [
  { pattern: /sk-live-[a-zA-Z0-9]{20,}/g, name: 'OPENAI_KEY' },
  { pattern: /sk-test-[a-zA-Z0-9]{20,}/g, name: 'OPENAI_TEST_KEY' },
  { pattern: /AKIA[0-9A-Z]{16}/g, name: 'AWS_ACCESS_KEY' },
  { pattern: /xoxb-[a-zA-Z0-9]{20,}/g, name: 'SLACK_BOT_TOKEN' },
  { pattern: /ghp_[a-zA-Z0-9]{36}/g, name: 'GITHUB_TOKEN' },
  { pattern: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g, name: 'JWT_TOKEN' },
  { pattern: /['"]?(API_KEY|API_SECRET|ACCESS_TOKEN|SECRET_KEY)[='"]\s*['"]?[a-zA-Z0-9_-]{20,}['"]?/gi, name: 'GENERIC_SECRET' },
];

const secretMap = new Map<string, string>();
let secretCounter = 0;

export function maskSecrets(text: string): string {
  let masked = text;
  
  for (const { pattern, name } of SECRET_PATTERNS) {
    masked = masked.replace(pattern, (match) => {
      const placeholder = `<REDACTED_SECRET_${++secretCounter}>`;
      secretMap.set(placeholder, match);
      return placeholder;
    });
  }
  
  return masked;
}

export function rehydrateSecrets(text: string): string {
  let rehydrated = text;
  
  for (const [placeholder, original] of secretMap.entries()) {
    rehydrated = rehydrated.replace(placeholder, original);
  }
  
  return rehydrated;
}

export function clearSecretMap(): void {
  secretMap.clear();
  secretCounter = 0;
}
