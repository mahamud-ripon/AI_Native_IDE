import { z } from 'zod';

export const CreateProjectSchema = z.object({
  name: z
    .string()
    .min(3, 'Name must be at least 3 characters')
    .max(50, 'Name must be at most 50 characters')
    .regex(/^[a-zA-Z0-9-\s]+$/, 'Name can only contain letters, numbers, dashes, and spaces'),
  description: z.string().max(500).optional(),
  template: z.string().optional(),
  visibility: z.enum(['private', 'public', 'org']).default('private'),
  orgId: z.string().uuid().nullable().optional(),
});

export const UpdateProjectSchema = z.object({
  name: z
    .string()
    .min(3, 'Name must be at least 3 characters')
    .max(50, 'Name must be at most 50 characters')
    .regex(/^[a-zA-Z0-9-]+$/, 'Name can only contain letters, numbers, and dashes')
    .optional(),
  description: z.string().max(500).optional(),
  visibility: z.enum(['private', 'public', 'org']).optional(),
});

export const ImportProjectSchema = z.object({
  gitRepoUrl: z.string().url('Invalid Git repository URL'),
  name: z
    .string()
    .min(3, 'Name must be at least 3 characters')
    .max(50, 'Name must be at most 50 characters')
    .regex(/^[a-zA-Z0-9-]+$/, 'Name can only contain letters, numbers, and dashes'),
  visibility: z.enum(['private', 'public', 'org']).default('private'),
  branch: z.string().default('main'),
});

export const ListProjectsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  visibility: z.enum(['private', 'public', 'org']).optional(),
  status: z.enum(['pending', 'active', 'failed_creation', 'archived', 'deleted']).optional(),
  cursor: z.string().uuid().optional(),
});

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;
export type ImportProjectInput = z.infer<typeof ImportProjectSchema>;
export type ListProjectsQuery = z.infer<typeof ListProjectsQuerySchema>;
