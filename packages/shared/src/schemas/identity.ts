import { z } from 'zod';

export const organizationDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  timezone: z.string(),
});
export type OrganizationDto = z.infer<typeof organizationDtoSchema>;

export const serviceDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  active: z.boolean(),
  usedByJobCount: z.number().int().nonnegative(),
});
export type ServiceDto = z.infer<typeof serviceDtoSchema>;

export const teamMemberDtoSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  initials: z.string().nullable(),
  color: z.string(),
  activeOnSchedule: z.boolean(),
});
export type TeamMemberDto = z.infer<typeof teamMemberDtoSchema>;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex like #1a2b3c');

export const createServiceRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
export type CreateServiceRequest = z.infer<typeof createServiceRequestSchema>;

export const updateServiceRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => value.name !== undefined || value.active !== undefined, {
    message: 'At least one field is required',
  });
export type UpdateServiceRequest = z.infer<typeof updateServiceRequestSchema>;

export const createTeamMemberRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  initials: z.string().max(4).nullable().optional(),
  color: hexColor,
  activeOnSchedule: z.boolean().optional(),
});
export type CreateTeamMemberRequest = z.infer<typeof createTeamMemberRequestSchema>;

export const updateTeamMemberRequestSchema = createTeamMemberRequestSchema.partial();
export type UpdateTeamMemberRequest = z.infer<typeof updateTeamMemberRequestSchema>;

export const updateOrganizationRequestSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  timezone: z.string().min(1).optional(),
});
export type UpdateOrganizationRequest = z.infer<typeof updateOrganizationRequestSchema>;

export function isValidTimezone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
