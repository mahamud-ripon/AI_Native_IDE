import { prisma } from '@workspace/database';
import { redisClient } from '../lib/redis.js';

const logger = {
  info: (msg: string) => console.log(`[Email Sender] ${msg}`),
  error: (msg: string, err?: any) => console.error(`[Email Sender] ${msg}`, err),
};

const SMTP_CONFIG = {
  host: process.env.SMTP_HOST || 'smtp.sendgrid.net',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.SMTP_FROM || 'noreply@ai-native-ide.com',
};

interface EmailPayload {
  to: string;
  userId?: string;
  type: string;
  [key: string]: any;
}

export async function sendVerificationEmail(data: EmailPayload): Promise<void> {
  const { to, userId, name } = data;

  logger.info(`Sending verification email to ${to}`);

  try {
    // Generate verification token
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Store token in Redis (simpler approach without dedicated model)
    await redisClient.setex(`verification:${to}:${token}`, 86400, JSON.stringify({ userId, expiresAt: expiresAt.toISOString() }));

    // Build email content
    const verifyUrl = `${process.env.APP_URL || 'http://localhost:3000'}/verify-email?token=${token}&email=${encodeURIComponent(to)}`;
    
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Welcome to AI Native IDE</title>
        </head>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1>Welcome${name ? ` ${name}` : ''}!</h1>
          <p>Thank you for signing up for AI Native IDE. Please verify your email address to get started.</p>
          <a href="${verifyUrl}" style="display: inline-block; padding: 12px 24px; background: #0070f3; color: white; text-decoration: none; border-radius: 5px;">Verify Email</a>
          <p style="color: #666; font-size: 12px;">This link expires in 24 hours.</p>
        </body>
      </html>
    `;

    await sendEmail({
      to,
      subject: 'Verify your email - AI Native IDE',
      html,
    });

    logger.info(`Verification email sent to ${to}`);

  } catch (error: any) {
    logger.error(`Failed to send verification email to ${to}:`, error.message);
    throw error;
  }
}

export async function sendInvitationEmail(data: EmailPayload): Promise<void> {
  const { to, invitationId, orgName, projectName } = data;

  logger.info(`Sending invitation email to ${to}`);

  try {
    const inviteUrl = `${process.env.APP_URL || 'http://localhost:3000'}/invite/${invitationId}`;
    
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>You're Invited!</title>
        </head>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1>You've been invited!</h1>
          <p>You have been invited to join ${orgName ? `the organization "${orgName}"` : projectName ? `the project "${projectName}"` : 'AI Native IDE'}.</p>
          <a href="${inviteUrl}" style="display: inline-block; padding: 12px 24px; background: #0070f3; color: white; text-decoration: none; border-radius: 5px;">Accept Invitation</a>
          <p style="color: #666; font-size: 12px;">This invitation expires in 7 days.</p>
        </body>
      </html>
    `;

    await sendEmail({
      to,
      subject: `You're invited to join ${orgName || projectName || 'AI Native IDE'}`,
      html,
    });

    logger.info(`Invitation email sent to ${to}`);

  } catch (error: any) {
    logger.error(`Failed to send invitation email to ${to}:`, error.message);
    throw error;
  }
}

export async function sendDeployStatusEmail(data: EmailPayload): Promise<void> {
  const { to, userId, projectId, projectName, deployUrl, status } = data;

  logger.info(`Sending deploy status email to ${to}`);

  try {
    const isSuccess = status === 'success' || status === 'completed';
    
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Deployment ${isSuccess ? 'Complete' : 'Failed'}</title>
        </head>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1>Deployment ${isSuccess ? 'Complete! 🎉' : 'Failed'}</h1>
          <p>Your deployment for project "${projectName}" has ${isSuccess ? 'completed successfully' : 'failed'}.</p>
          ${isSuccess ? `<a href="${deployUrl}" style="display: inline-block; padding: 12px 24px; background: #0070f3; color: white; text-decoration: none; border-radius: 5px;">View Deployment</a>` : ''}
          <p style="color: #666; font-size: 12px;">Project ID: ${projectId}</p>
        </body>
      </html>
    `;

    await sendEmail({
      to,
      subject: `Deployment ${isSuccess ? 'Complete' : 'Failed'} - ${projectName}`,
      html,
    });

    logger.info(`Deploy status email sent to ${to}`);

  } catch (error: any) {
    logger.error(`Failed to send deploy status email to ${to}:`, error.message);
    throw error;
  }
}

export async function sendUsageAlertEmail(data: EmailPayload): Promise<void> {
  const { to, userId, usagePercent, quotaType } = data;

  logger.info(`Sending usage alert email to ${to}`);

  try {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Usage Alert</title>
        </head>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1>Usage Alert ⚠️</h1>
          <p>You've used ${usagePercent}% of your ${quotaType || 'AI quota'} for this billing period.</p>
          <p>Consider upgrading your plan to avoid hitting limits.</p>
          <a href="${process.env.APP_URL || 'http://localhost:3000'}/settings/billing" style="display: inline-block; padding: 12px 24px; background: #0070f3; color: white; text-decoration: none; border-radius: 5px;">Manage Plan</a>
        </body>
      </html>
    `;

    await sendEmail({
      to,
      subject: `You've used ${usagePercent}% of your ${quotaType || 'quota'}`,
      html,
    });

    logger.info(`Usage alert email sent to ${to}`);

  } catch (error: any) {
    logger.error(`Failed to send usage alert email to ${to}:`, error.message);
    throw error;
  }
}

async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }): Promise<void> {
  // In production, use a real email service (SendGrid, AWS SES, etc.)
  // For now, log the email and store in Redis for testing
  
  const emailRecord = {
    to,
    subject,
    html,
    sentAt: new Date().toISOString(),
  };

  // Store in Redis for testing/verification
  await redisClient.lpush('email:sent', JSON.stringify(emailRecord));
  await redisClient.ltrim('email:sent', 0, 999); // Keep last 1000 emails

  // Log for development
  logger.info(`[DEV] Email would be sent to ${to}: ${subject}`);

  // In production, uncomment and configure:
  // const nodemailer = require('nodemailer');
  // const transporter = nodemailer.createTransport(SMTP_CONFIG);
  // await transporter.sendMail({ from: SMTP_CONFIG.from, to, subject, html });
}

import crypto from 'crypto';

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}
