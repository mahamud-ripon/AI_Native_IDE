import { z } from 'zod';

export const InviteCollaboratorSchema = z.object({
  email: z.string().email('Invalid email address'),
  role: z.enum(['owner', 'editor', 'viewer']),
});

export const UpdateCollaboratorRoleSchema = z.object({
  role: z.enum(['owner', 'editor', 'viewer']),
});

export const AcceptInvitationSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

export type InviteCollaboratorInput = z.infer<typeof InviteCollaboratorSchema>;
export type UpdateCollaboratorRoleInput = z.infer<typeof UpdateCollaboratorRoleSchema>;
export type AcceptInvitationInput = z.infer<typeof AcceptInvitationSchema>;
