import { FastifyRequest, FastifyReply } from 'fastify';

// Middleware to calculate json nesting depth & prevent prototype pollution
function checkJsonDepth(obj: any, maxDepth: number, currentDepth: number = 0): boolean {
  if (currentDepth > maxDepth) return false;
  if (typeof obj !== 'object' || obj === null) return true;

  // Prototype pollution block
  if ('__proto__' in obj || 'constructor' in obj) {
    return false;
  }

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      if (!checkJsonDepth(obj[key], maxDepth, currentDepth + 1)) {
        return false;
      }
    }
  }
  return true;
}

export async function ddosProtectionMiddleware(request: FastifyRequest, reply: FastifyReply) {
  // Enforce Max Size for JSON Body (2MB is normally handled by fastify bodyLimit, this is an explicit block for complex structures)
  const MAX_DEPTH = 20;

  if (request.headers['content-type']?.includes('application/json') && request.body) {
    const isSafe = checkJsonDepth(request.body, MAX_DEPTH);
    if (!isSafe) {
      return reply.status(400).send({ error: 'Payload rejected: Malformed JSON or nested too deeply.' });
    }
  }
}
