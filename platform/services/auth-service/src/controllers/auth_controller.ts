import { FastifyInstance } from 'fastify';
import argon2 from 'argon2';
import crypto from 'crypto';
import { prisma } from '../lib/db';
import { RegisterSchema, LoginSchema, ForgotPasswordSchema } from '../schemas/auth.schema';
import { JwtService } from '../services/jwt_service';
import { SessionService } from '../services/session_service';
import { KafkaPublisher } from '../events/kafka_publisher';

export async function authRoutes(app: FastifyInstance) {

  // Register Route
  app.post('/register', async (request, reply) => {
    try {
      const data = RegisterSchema.parse(request.body);

      // Check existence - use findFirst with OR for email OR username
      const existing = await prisma.user.findFirst({
        where: {
          OR: [{ email: data.email }, { username: data.username }]
        }
      });
      if (existing) {
        return reply.status(409).send({ success: false, error: 'Email or username already exists' });
      }

      // Hash password securely via Argon2
      const hashedPassword = await argon2.hash(data.password, { type: argon2.argon2id });

      // Create new user record
      const newUser = await prisma.user.create({
        data: {
          email: data.email,
          username: data.username,
          hashedPassword: hashedPassword,
        }
      });

      // Audit Log
      await prisma.auditLog.create({
        data: {
          userId: newUser.id,
          action: 'user.registered',
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] || 'unknown',
          timestamp: new Date()
        }
      });

      // Issue tokens
      const accessToken = JwtService.issueAccessToken(newUser);
      const refreshToken = await SessionService.issueRefreshToken(newUser.id, request.ip, request.headers['user-agent'] || 'unknown');

      // Publish Kafka EVENT (Event-Driven decoupled)
      await KafkaPublisher.publish('user.created', { userId: newUser.id, email: newUser.email, username: newUser.username });

      reply.setCookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/api/v1/auth/refresh'
      });

      return reply.status(201).send({ success: true, data: { accessToken, user: { id: newUser.id, username: newUser.username } } });

    } catch (e: any) {
      return reply.status(400).send({ success: false, error: e.errors || e.message });
    }
  });

  // Login Route
  app.post('/login', {
    config: {
      rateLimit: { max: 5, timeWindow: '10 minutes' }
    }
  }, async (request, reply) => {
    try {
      const data = LoginSchema.parse(request.body);

      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { email: data.email_or_username },
            { username: data.email_or_username }
          ],
          deletedAt: null
        }
      });

      if (!user) {
        return reply.status(401).send({ success: false, error: 'Invalid credentials' });
      }

      const isValid = await argon2.verify(user.hashedPassword || '', data.password);
      if (!isValid) {
        await prisma.auditLog.create({
          data: { userId: user.id, action: 'login.failed', ipAddress: request.ip, timestamp: new Date() }
        });
        return reply.status(401).send({ success: false, error: 'Invalid credentials' });
      }

      // MFA Defense Check
      if (user.mfaEnabled) {
        const tempToken = crypto.randomBytes(32).toString('hex');
        return reply.status(202).send({ mfaRequired: true, mfaToken: tempToken });
      }

      // Success Login
      const accessToken = JwtService.issueAccessToken(user);
      const refreshToken = await SessionService.issueRefreshToken(user.id, request.ip, request.headers['user-agent'] || 'unknown');

      await prisma.auditLog.create({
        data: { userId: user.id, action: 'login.success', ipAddress: request.ip, timestamp: new Date() }
      });

      reply.setCookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/'  // Allow cookie to be sent to all paths (needed for proxy)
      });

      return reply.status(200).send({ success: true, data: { accessToken } });

    } catch (e: any) {
      return reply.status(400).send({ success: false, error: e.errors || e.message });
    }
  });

  // Refresh Token Route
  app.post('/refresh', async (request, reply) => {
    try {
      const plainToken = request.cookies['refreshToken'];
      if (!plainToken) {
        return reply.status(401).send({ success: false, error: 'No refresh token provided' });
      }

      const nextRefreshToken = await SessionService.rotateRefreshToken(plainToken, request.ip, request.headers['user-agent'] || 'unknown');

      if (!nextRefreshToken) {
        return reply.status(403).send({ success: false, error: 'Invalid or revoked session. Please log in again.' });
      }

      // Fetch the real user from the refresh token's user_id
      const hashedToken = crypto.createHash('sha256').update(plainToken).digest('hex');
      const tokenRecord = await prisma.refreshToken.findFirst({
        where: { tokenHash: hashedToken },
        include: { user: true }
      });

      if (!tokenRecord || !tokenRecord.user) {
        return reply.status(403).send({ success: false, error: 'User not found. Please log in again.' });
      }

      const accessToken = JwtService.issueAccessToken(tokenRecord.user);

      reply.setCookie('refreshToken', nextRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/'  // Allow cookie to be sent to all paths (needed for proxy)
      });

      return reply.status(200).send({ success: true, data: { accessToken } });
    } catch (e: any) {
      return reply.status(400).send({ success: false, error: e.message || 'Refresh failed' });
    }
  });

  // Logout Route
  app.post('/logout', async (request, reply) => {
    try {
      const plainToken = request.cookies['refreshToken'];
      if (plainToken) {
        const hashedToken = crypto.createHash('sha256').update(plainToken).digest('hex');
        const record = await prisma.refreshToken.findFirst({ where: { tokenHash: hashedToken } });
        if (record) {
          await prisma.refreshToken.update({ where: { id: record.id }, data: { isRevoked: true } });
          // Kick active WebSockets
          await KafkaPublisher.publish('user.sessions_revoked', { userId: record.userId });
        }
      }

      reply.clearCookie('refreshToken', { path: '/' });
      return reply.status(200).send({ success: true, message: 'Logged out successfully' });
    } catch (e: any) {
      return reply.status(400).send({ success: false, error: e.message || 'Logout failed' });
    }
  });

  // Forgot Password
  app.post('/forgot-password', async (request, reply) => {
    try {
      const data = ForgotPasswordSchema.parse(request.body);
      const user = await prisma.user.findUnique({ where: { email: data.email } });

      if (user) {
        const resetToken = crypto.randomBytes(32).toString('hex'); // Logically save to DB or Redis
        await KafkaPublisher.publish('auth.email_action', { userId: user.id, email: user.email, action: 'reset_password', token: resetToken });
      }

      // Security: Always return 200, do not leak user existence
      return reply.status(200).send({ success: true, message: 'If email exists, a reset link was sent.' });
    } catch (e) {
      return reply.status(400).send({ success: false, error: 'Invalid payload' });
    }
  });

  // Init Kafka connection when routes register
  KafkaPublisher.connect();
}
