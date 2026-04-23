import { z } from 'zod';

export const US_STATES = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
  'DC',
] as const;
export type UsState = (typeof US_STATES)[number];

export const CUSTOMER_TYPES = ['Homeowner', 'Business'] as const;
export const PHONE_TYPES = ['mobile', 'home', 'work', 'other'] as const;

export const stateSchema = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .refine((v) => v.length === 0 || (US_STATES as readonly string[]).includes(v), {
    message: 'State must be a US 2-letter code',
  })
  .transform((v) => (v.length === 0 ? null : (v as UsState)));

export function digitsOnly(value: string): string {
  return value.replace(/\D+/g, '');
}

const trimmedNullable = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      if (v === null) return null;
      const t = v.trim();
      return t.length === 0 ? null : t;
    });

export const phoneInputSchema = z.object({
  value: z.string().trim().min(1).max(40),
  type: z.enum(PHONE_TYPES).nullable().optional(),
  note: trimmedNullable(200),
});
export type PhoneInput = z.infer<typeof phoneInputSchema>;

export const emailInputSchema = z.object({
  value: z.string().trim().toLowerCase().email().max(254),
});
export type EmailInput = z.infer<typeof emailInputSchema>;

export const addressInputSchema = z.object({
  id: z.string().uuid().optional(),
  street: trimmedNullable(200),
  unit: trimmedNullable(40),
  city: trimmedNullable(100),
  state: stateSchema.optional().nullable(),
  zip: trimmedNullable(20),
  notes: trimmedNullable(500),
});
export type AddressInput = z.infer<typeof addressInputSchema>;

const baseCustomerFields = {
  firstName: trimmedNullable(80),
  lastName: trimmedNullable(80),
  companyName: trimmedNullable(120),
  role: trimmedNullable(80),
  customerType: z.enum(CUSTOMER_TYPES),
  subcontractor: z.boolean().optional(),
  doNotService: z.boolean().optional(),
  sendNotifications: z.boolean().optional(),
  leadSource: trimmedNullable(120),
  referredBy: trimmedNullable(120),
  billingAddress: trimmedNullable(400),
  primaryAddress: addressInputSchema.optional(),
  additionalAddresses: z.array(addressInputSchema).max(20).optional(),
  phones: z.array(phoneInputSchema).max(10).optional(),
  emails: z.array(emailInputSchema).max(10).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
};

function hasIdentity(value: {
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
}): boolean {
  return Boolean(
    (value.firstName && value.firstName.length > 0) ||
      (value.lastName && value.lastName.length > 0) ||
      (value.companyName && value.companyName.length > 0),
  );
}

export const createCustomerRequestSchema = z
  .object({ ...baseCustomerFields, phones: z.array(phoneInputSchema).min(1).max(10) })
  .superRefine((value, ctx) => {
    if (!hasIdentity(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either name or company name is required',
        path: ['firstName'],
      });
    }
  });
export type CreateCustomerRequest = z.infer<typeof createCustomerRequestSchema>;

export const updateCustomerRequestSchema = z
  .object({
    firstName: trimmedNullable(80),
    lastName: trimmedNullable(80),
    companyName: trimmedNullable(120),
    role: trimmedNullable(80),
    customerType: z.enum(CUSTOMER_TYPES).optional(),
    subcontractor: z.boolean().optional(),
    doNotService: z.boolean().optional(),
    sendNotifications: z.boolean().optional(),
    leadSource: trimmedNullable(120),
    referredBy: trimmedNullable(120),
    billingAddress: trimmedNullable(400),
    primaryAddress: addressInputSchema.optional(),
    additionalAddresses: z.array(addressInputSchema).max(20).optional(),
    phones: z.array(phoneInputSchema).max(10).optional(),
    emails: z.array(emailInputSchema).max(10).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  })
  .superRefine((value, ctx) => {
    const identityTouched =
      value.firstName !== undefined ||
      value.lastName !== undefined ||
      value.companyName !== undefined;
    if (identityTouched && !hasIdentity(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either name or company name is required',
        path: ['firstName'],
      });
    }
    if (value.phones !== undefined && value.phones.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one phone is required',
        path: ['phones'],
      });
    }
  });
export type UpdateCustomerRequest = z.infer<typeof updateCustomerRequestSchema>;

export function deriveDisplayName(input: {
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
}): string {
  if (input.companyName && input.companyName.trim().length > 0) {
    return input.companyName.trim();
  }
  return `${input.firstName ?? ''} ${input.lastName ?? ''}`.trim();
}

const triStateBool = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform((v) => {
    if (v === true || v === 'true') return true;
    if (v === false || v === 'false') return false;
    return undefined;
  });

export const customerListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  cursor: z.string().uuid().optional(),
  limit: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v == null ? 25 : typeof v === 'number' ? v : Number.parseInt(v, 10)))
    .pipe(z.number().int().min(1).max(100)),
  includeArchived: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'true'),
  customerType: z.enum(CUSTOMER_TYPES).optional(),
  subcontractor: triStateBool,
  doNotService: triStateBool,
  sendNotifications: triStateBool,
  tag: z.string().trim().min(1).max(40).optional(),
  city: z.string().trim().min(1).max(100).optional(),
  state: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .refine((v) => v.length === 0 || (US_STATES as readonly string[]).includes(v), {
      message: 'State must be a US 2-letter code',
    })
    .transform((v) => (v.length === 0 ? undefined : (v as UsState)))
    .optional(),
  leadSource: z.string().trim().min(1).max(120).optional(),
});
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;

export const searchDuplicatesQuerySchema = z.object({
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  companyName: z.string().trim().max(120).optional(),
  city: z.string().trim().max(100).optional(),
  zip: z.string().trim().max(20).optional(),
});
export type SearchDuplicatesQuery = z.infer<typeof searchDuplicatesQuerySchema>;

export const customerAddressDtoSchema = z.object({
  id: z.string().uuid(),
  street: z.string().nullable(),
  unit: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  zip: z.string().nullable(),
  notes: z.string().nullable(),
});
export type CustomerAddressDto = z.infer<typeof customerAddressDtoSchema>;

export const customerPhoneDtoSchema = z.object({
  id: z.string().uuid(),
  value: z.string(),
  type: z.enum(PHONE_TYPES).nullable(),
  note: z.string().nullable(),
});
export type CustomerPhoneDto = z.infer<typeof customerPhoneDtoSchema>;

export const customerEmailDtoSchema = z.object({
  id: z.string().uuid(),
  value: z.string(),
});
export type CustomerEmailDto = z.infer<typeof customerEmailDtoSchema>;

export const customerSummaryAddressSchema = z.object({
  id: z.string().uuid(),
  street: z.string().nullable(),
  unit: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  zip: z.string().nullable(),
});
export type CustomerSummaryAddress = z.infer<typeof customerSummaryAddressSchema>;

export const customerSummaryDtoSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  customerType: z.enum(CUSTOMER_TYPES),
  doNotService: z.boolean(),
  archived: z.boolean(),
  primaryPhone: z.string().nullable(),
  primaryEmail: z.string().nullable(),
  city: z.string().nullable(),
  addresses: z.array(customerSummaryAddressSchema),
  jobsCount: z.number().int().nonnegative(),
  openInvoicesCount: z.number().int().nonnegative(),
});
export type CustomerSummaryDto = z.infer<typeof customerSummaryDtoSchema>;

export const customerDtoSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  companyName: z.string().nullable(),
  displayName: z.string(),
  role: z.string().nullable(),
  customerType: z.enum(CUSTOMER_TYPES),
  subcontractor: z.boolean(),
  doNotService: z.boolean(),
  archived: z.boolean(),
  sendNotifications: z.boolean(),
  leadSource: z.string().nullable(),
  referredBy: z.string().nullable(),
  billingAddress: z.string().nullable(),
  addresses: z.array(customerAddressDtoSchema),
  phones: z.array(customerPhoneDtoSchema),
  emails: z.array(customerEmailDtoSchema),
  tags: z.array(z.string()),
});
export type CustomerDto = z.infer<typeof customerDtoSchema>;

export const duplicateMatchDtoSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  city: z.string().nullable(),
  zip: z.string().nullable(),
  street: z.string().nullable(),
});
export type DuplicateMatchDto = z.infer<typeof duplicateMatchDtoSchema>;
