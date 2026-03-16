import { FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

export async function requestTracerMiddleware(request: FastifyRequest, reply: FastifyReply) {
  // Generate a unique Trace ID for every incoming request
  const traceId = uuidv4();
  
  // Inject into request context (headers to pass downstream)
  request.headers['x-trace-id'] = traceId;
  
  // Also set on reply so client can see it
  reply.header('x-trace-id', traceId);
  
  // Set start time
  (request as any).startTime = process.hrtime();
}

export function logRequestResolution(request: FastifyRequest, reply: FastifyReply) {
  const diff = process.hrtime((request as any).startTime);
  const durationMs = (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(2);
  const traceId = request.headers['x-trace-id'];
  
  // Log exactly 1 line per HTTP request
  console.log(`[${new Date().toISOString()}] Route=${request.url} Status=${reply.statusCode} Duration=${durationMs}ms Trace=${traceId}`);
}
