import { z } from 'zod';

export const RegisterSchema = z.object({
  email: z.string().email('Invalid email address'),
  username: z.string().min(3, 'Username must be at least 3 characters').max(30),
  password: z.string().min(8, 'Password must be at least 8 characters')
});

export const LoginSchema = z.object({
  email_or_username: z.string().min(3),
  password: z.string().min(8)
});

export const ForgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address')
});

export type RegisterData = z.infer<typeof RegisterSchema>;
export type LoginData = z.infer<typeof LoginSchema>;
export type ForgotPasswordData = z.infer<typeof ForgotPasswordSchema>;
