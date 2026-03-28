import { z } from 'zod';

export const CreateFileSchema = z.object({
  path: z.string().min(1, 'Path is required').max(500, 'Path too long'),
  content: z.string().optional(),
  isDirectory: z.boolean().default(false),
});

export const UpdateFileSchema = z.object({
  content: z.string(),
});

export const MoveFileSchema = z.object({
  newPath: z.string().min(1, 'New path is required').max(500, 'Path too long'),
});

export const GetFileTreeQuerySchema = z.object({
  branch: z.string().default('main'),
});

export const CreateSecretSchema = z.object({
  keyName: z
    .string()
    .min(1, 'Key name is required')
    .max(100, 'Key name too long')
    .regex(/^[A-Z_][A-Z0-9_]*$/, 'Key name must be uppercase with underscores'),
  value: z.string().min(1, 'Value is required'),
  environment: z.enum(['dev', 'preview', 'prod']),
});

export const UpdateSecretSchema = z.object({
  value: z.string().min(1, 'Value is required'),
});

export type CreateFileInput = z.infer<typeof CreateFileSchema>;
export type UpdateFileInput = z.infer<typeof UpdateFileSchema>;
export type MoveFileInput = z.infer<typeof MoveFileSchema>;
export type GetFileTreeQuery = z.infer<typeof GetFileTreeQuerySchema>;
export type CreateSecretInput = z.infer<typeof CreateSecretSchema>;
export type UpdateSecretInput = z.infer<typeof UpdateSecretSchema>;
