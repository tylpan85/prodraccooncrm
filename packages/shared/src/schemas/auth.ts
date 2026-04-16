import { z } from 'zod';

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const userDtoSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: z.string(),
  mustResetPassword: z.boolean(),
});
export type UserDto = z.infer<typeof userDtoSchema>;

export const organizationDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  timezone: z.string(),
});
export type OrganizationDto = z.infer<typeof organizationDtoSchema>;

export const authSessionSchema = z.object({
  user: userDtoSchema,
  organization: organizationDtoSchema,
});
export type AuthSession = z.infer<typeof authSessionSchema>;
