import { FastifyRequest, FastifyReply } from 'fastify';
import { redisClient } from '../lib/redis';

export async function idempotencyMiddleware(request: FastifyRequest, reply: FastifyReply) {
  // Only apply to mutating methods
  if (!['POST', 'PUT', 'DELETE'].includes(request.method)) {
    return;
  }

  const idempotencyKey = request.headers['idempotency-key'] as string;
  if (!idempotencyKey) {
    // If not strict enforcing for everything, just return. 
    // In strict environments, we might throw 400 Bad Request here.
    return; 
  }

  const redisKey = `idempotency:${idempotencyKey}`;
  
  try {
    // SETNX (Set if Not eXists)
    const setnxResult = await redisClient.setnx(redisKey, "PROCESSING");
    
    if (setnxResult === 0) {
      // It exists. What is the value?
      const existingValue = await redisClient.get(redisKey);
      
      if (existingValue === "PROCESSING") {
        return reply.status(409).send({ error: 'Duplicate Request. Action is currently processing.' });
      }
      
      if (existingValue) {
        // It's a cached response from a previous successful call
        const parsedRecord = JSON.parse(existingValue);
        return reply.status(200).send(parsedRecord);
      }
    } else {
      // Set expiration for the processing lock so it doesn't get stuck forever (24 hours)
      await redisClient.expire(redisKey, 86400);

      // Attach idempotencyKey to request so the response hook can overwrite it with the final JSON
      (request as any).idempotencyKey = idempotencyKey;
    }
  } catch (err) {
    console.error('Idempotency Redis Error:', err);
    // Fail open or fail closed depending on risk appetite. Here we pass through on Redis failure.
  }
}

export async function resolveIdempotency(request: FastifyRequest, reply: FastifyReply, payload: any) {
  const idempotencyKey = (request as any).idempotencyKey;
  if (!idempotencyKey) return payload;

  const redisKey = `idempotency:${idempotencyKey}`;

  // If upstream microservice failed (5xx error or timeout), we MUST release the lock (Deadlock Defense)
  if (reply.statusCode >= 500) {
    await redisClient.del(redisKey);
    return payload; // Let the client get the 5xx error so they can safely retry
  }

  // Otherwise, success! Cache the final JSON payload
  let payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  
  try {
    // We already have 86400 TTL, but strictly SET normally
    await redisClient.setex(redisKey, 86400, payloadStr);
  } catch(e) {}
  
  return payload;
}
