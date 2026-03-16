import { z } from 'zod';

export const ListTemplatesQuerySchema = z.object({
  category: z.string().optional(),
  language: z.string().optional(),
  framework: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const CreateTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  description: z.string().max(1000).optional(),
  category: z.string().min(1).max(50),
  language: z.string().min(1).max(50),
  framework: z.string().max(100).optional(),
  fileStructureJson: z.record(z.unknown()),
  isPublic: z.boolean().default(true),
});

export type ListTemplatesQuery = z.infer<typeof ListTemplatesQuerySchema>;
export type CreateTemplateInput = z.infer<typeof CreateTemplateSchema>;
