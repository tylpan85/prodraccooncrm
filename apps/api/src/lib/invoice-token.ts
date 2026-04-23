import { randomBytes } from 'node:crypto';

export function newInvoicePublicToken(): string {
  return randomBytes(24).toString('base64url');
}
