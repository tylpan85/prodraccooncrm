import { z } from 'zod';

export const teamMemberDtoSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  initials: z.string().nullable(),
  color: z.string(),
  activeOnSchedule: z.boolean(),
});
export type TeamMemberDto = z.infer<typeof teamMemberDtoSchema>;

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex like #1a2b3c');

export const createTeamMemberRequestSchema = z.object({
  displayName: z.string().min(1).max(100),
  initials: z.string().max(4).nullable().optional(),
  color: hexColor,
  activeOnSchedule: z.boolean().optional(),
});
export type CreateTeamMemberRequest = z.infer<typeof createTeamMemberRequestSchema>;

export const updateTeamMemberRequestSchema = createTeamMemberRequestSchema.partial();
export type UpdateTeamMemberRequest = z.infer<typeof updateTeamMemberRequestSchema>;

export const updateOrganizationRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  timezone: z.string().min(1).optional(),
});
export type UpdateOrganizationRequest = z.infer<typeof updateOrganizationRequestSchema>;
