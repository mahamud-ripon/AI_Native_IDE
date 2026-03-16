import AWS from 'aws-sdk';
import { config } from '../config/index.js';

const ses = new AWS.SES({
  region: config.aws.region,
  accessKeyId: config.aws.accessKeyId,
  secretAccessKey: config.aws.secretAccessKey
});

export interface EmailParams {
  to: string;
  subject: string;
  body: string;
  html?: string;
  idempotencyKey?: string;
}

export const EmailService = {
  async send(params: EmailParams): Promise<boolean> {
    try {
      const result = await ses.sendEmail({
        Source: config.aws.sesFromEmail,
        Destination: {
          ToAddresses: [params.to]
        },
        Message: {
          Subject: {
            Data: params.subject,
            Charset: 'UTF-8'
          },
          Body: {
            Text: {
              Data: params.body,
              Charset: 'UTF-8'
            },
            ...(params.html && {
              Html: {
                Data: params.html,
                Charset: 'UTF-8'
              }
            })
          }
        }
      }).promise();

      console.log(`[Email] Sent to ${params.to}: ${result.MessageId}`);
      return true;
    } catch (error) {
      console.error(`[Email] Failed to send to ${params.to}:`, error);
      return false;
    }
  },

  async sendVerifyEmail(to: string, token: string): Promise<boolean> {
    const url = `https://platform.io/verify-email?token=${token}`;
    return this.send({
      to,
      subject: 'Verify your email - AI-Native IDE',
      body: `Click here to verify your email: ${url}`,
      html: `<p>Click <a href="${url}">here</a> to verify your email.</p>`,
      idempotencyKey: `verify-${to}`
    });
  },

  async sendPasswordReset(to: string, token: string): Promise<boolean> {
    const url = `https://platform.io/reset-password?token=${token}`;
    return this.send({
      to,
      subject: 'Reset your password - AI-Native IDE',
      body: `Click here to reset your password: ${url}`,
      html: `<p>Click <a href="${url}">here</a> to reset your password.</p>`,
      idempotencyKey: `reset-${to}`
    });
  },

  async sendProjectInvite(to: string, projectName: string, inviterName: string): Promise<boolean> {
    return this.send({
      to,
      subject: `${inviterName} invited you to ${projectName}`,
      body: `You've been invited to collaborate on ${projectName}. Log in to accept.`,
      html: `<p>You've been invited to collaborate on <strong>${projectName}</strong> by ${inviterName}.</p>`,
      idempotencyKey: `invite-${to}-${projectName}`
    });
  },

  async sendPaymentFailed(to: string, projectName: string): Promise<boolean> {
    return this.send({
      to,
      subject: 'Payment failed - Action required',
      body: `Your payment for ${projectName} failed. Please update your payment method.`,
      html: `<p>Your payment for <strong>${projectName}</strong> failed. Please update your payment method.</p>`,
      idempotencyKey: `payment-${to}`
    });
  }
};
