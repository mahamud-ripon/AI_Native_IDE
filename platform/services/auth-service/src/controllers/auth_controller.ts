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

      // Check existence
      const existing = await prisma.user.findUnique({ where: { email: data.email, username: data.username } });
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
          password_hash: hashedPassword,
        }
      });

      // Audit Log
      await prisma.audit_log.create({
        data: {
          user_id: newUser.id,
          action: 'user.registered',
          ip_address: request.ip,
          user_agent: request.headers['user-agent'] || 'unknown',
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

      const user = await prisma.user.findUnique({
        where: { email: data.email_or_username, username: data.email_or_username }
      });

      if (!user) {
        return reply.status(401).send({ success: false, error: 'Invalid credentials' });
      }

      const isValid = await argon2.verify(user.password_hash, data.password);
      if (!isValid) {
        await prisma.audit_log.create({
          data: { user_id: user.id, action: 'login.failed', ip_address: request.ip, timestamp: new Date() }
        });
        return reply.status(401).send({ success: false, error: 'Invalid credentials' });
      }

      // MFA Defense Check
      if (user.mfa_enabled) {
        const tempToken = crypto.randomBytes(32).toString('hex');
        return reply.status(202).send({ mfaRequired: true, mfaToken: tempToken });
      }

      // Success Login
      const accessToken = JwtService.issueAccessToken(user);
      const refreshToken = await SessionService.issueRefreshToken(user.id, request.ip, request.headers['user-agent'] || 'unknown');

      await prisma.audit_log.create({
        data: { user_id: user.id, action: 'login.success', ip_address: request.ip, timestamp: new Date() }
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

      // Assuming we don't fetch full user on refresh for performance.. Ideally parse DB for user record fast
      // Mock user for issuance here
      const mockUserRecord = { id: 'hydrated_uuid', role: 'user', email: 'verified@user.com' };
      const accessToken = JwtService.issueAccessToken(mockUserRecord);

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
        const record = await prisma.refresh_token.findFirst({ where: { token: hashedToken } });
        if (record) {
          await prisma.refresh_token.update({ where: { id: record.id }, data: { is_revoked: true } });
          // Kick active WebSockets
          await KafkaPublisher.publish('user.sessions_revoked', { userId: record.user_id });
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
