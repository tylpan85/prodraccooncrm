'use client';

import {
  type AddressInput,
  CUSTOMER_TYPES,
  type CreateCustomerRequest,
  type CustomerDto,
  type DuplicateMatchDto,
  type EmailInput,
  PHONE_TYPES,
  type PhoneInput,
  US_STATES,
} from '@openclaw/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

type AddressDraft = {
  _key: string;
  id?: string;
  street: string;
  unit: string;
  city: string;
  state: string;
  zip: string;
  notes: string;
};

type PhoneDraft = { _key: string; value: string; type: PhoneInput['type']; note: string };
type EmailDraft = { _key: string; value: string };

export interface CustomerFormState {
  firstName: string;
  lastName: string;
  companyName: string;
  role: string;
  customerType: 'Homeowner' | 'Business';
  subcontractor: boolean;
  doNotService: boolean;
  sendNotifications: boolean;
  customerNotes: string;
  leadSource: string;
  referredBy: string;
  billingAddress: string;
  primaryAddress: AddressDraft;
  additionalAddresses: AddressDraft[];
  phones: PhoneDraft[];
  emails: EmailDraft[];
  tags: string[];
}

let keyCounter = 0;
function nextKey(prefix: string): string {
  keyCounter += 1;
  return `${prefix}-${keyCounter}`;
}

function newAddress(): AddressDraft {
  return {
    _key: nextKey('addr'),
    street: '',
    unit: '',
    city: '',
    state: '',
    zip: '',
    notes: '',
  };
}

export const emptyCustomerForm: CustomerFormState = {
  firstName: '',
  lastName: '',
  companyName: '',
  role: '',
  customerType: 'Homeowner',
  subcontractor: false,
  doNotService: false,
  sendNotifications: true,
  customerNotes: '',
  leadSource: '',
  referredBy: '',
  billingAddress: '',
  primaryAddress: newAddress(),
  additionalAddresses: [],
  phones: [],
  emails: [],
  tags: [],
};

export function customerToFormState(c: CustomerDto): CustomerFormState {
  const [primary, ...rest] = c.addresses;
  return {
    firstName: c.firstName ?? '',
    lastName: c.lastName ?? '',
    companyName: c.companyName ?? '',
    role: c.role ?? '',
    customerType: c.customerType,
    subcontractor: c.subcontractor,
    doNotService: c.doNotService,
    sendNotifications: c.sendNotifications,
    customerNotes: c.customerNotes ?? '',
    leadSource: c.leadSource ?? '',
    referredBy: c.referredBy ?? '',
    billingAddress: c.billingAddress ?? '',
    primaryAddress: primary
      ? {
          _key: nextKey('addr'),
          id: primary.id,
          street: primary.street ?? '',
          unit: primary.unit ?? '',
          city: primary.city ?? '',
          state: primary.state ?? '',
          zip: primary.zip ?? '',
          notes: primary.notes ?? '',
        }
      : newAddress(),
    additionalAddresses: rest.map((a) => ({
      _key: nextKey('addr'),
      id: a.id,
      street: a.street ?? '',
      unit: a.unit ?? '',
      city: a.city ?? '',
      state: a.state ?? '',
      zip: a.zip ?? '',
      notes: a.notes ?? '',
    })),
    phones: c.phones.map((p) => ({
      _key: nextKey('phone'),
      value: p.value,
      type: p.type,
      note: p.note ?? '',
    })),
    emails: c.emails.map((e) => ({ _key: nextKey('email'), value: e.value })),
    tags: [...c.tags],
  };
}

function trimToNull(v: string): string | null {
  const t = v.trim();
  return t.length === 0 ? null : t;
}

function hasAddressContent(a: AddressDraft): boolean {
  return Boolean(
    a.street.trim() ||
      a.unit.trim() ||
      a.city.trim() ||
      a.state.trim() ||
      a.zip.trim() ||
      a.notes.trim(),
  );
}

function addressToInput(a: AddressDraft): AddressInput | null {
  if (!hasAddressContent(a) && !a.id) return null;
  return {
    id: a.id,
    street: trimToNull(a.street),
    unit: trimToNull(a.unit),
    city: trimToNull(a.city),
    state: (a.state.trim().length > 0 ? a.state.trim().toUpperCase() : null) as never,
    zip: trimToNull(a.zip),
    notes: trimToNull(a.notes),
  };
}

export function formStateToRequest(form: CustomerFormState): CreateCustomerRequest {
  const phones: PhoneInput[] = form.phones
    .filter((p) => p.value.trim().length > 0)
    .map((p) => ({
      value: p.value.trim(),
      type: p.type ?? null,
      note: trimToNull(p.note),
    }));
  const emails: EmailInput[] = form.emails
    .filter((e) => e.value.trim().length > 0)
    .map((e) => ({ value: e.value.trim().toLowerCase() }));
  const tags = form.tags.map((t) => t.trim()).filter((t) => t.length > 0);

  const primary = addressToInput(form.primaryAddress);
  const additional = form.additionalAddresses
    .map(addressToInput)
    .filter((a): a is AddressInput => a !== null);

  return {
    firstName: trimToNull(form.firstName),
    lastName: trimToNull(form.lastName),
    companyName: trimToNull(form.companyName),
    role: trimToNull(form.role),
    customerType: form.customerType,
    subcontractor: form.subcontractor,
    doNotService: form.doNotService,
    sendNotifications: form.doNotService ? false : form.sendNotifications,
    customerNotes: trimToNull(form.customerNotes),
    leadSource: trimToNull(form.leadSource),
    referredBy: trimToNull(form.referredBy),
    billingAddress: trimToNull(form.billingAddress),
    primaryAddress: primary ?? undefined,
    additionalAddresses: additional.length > 0 ? additional : undefined,
    phones,
    emails,
    tags,
  };
}

export function CustomerForm({
  initialValue,
  saving,
  submitLabel,
  errorMessage,
  duplicateMatches,
  conflictField,
  onChange,
  onSubmit,
  onCancel,
  onIdentityChange,
}: {
  initialValue: CustomerFormState;
  saving: boolean;
  submitLabel: string;
  errorMessage: string | null;
  duplicateMatches: DuplicateMatchDto[];
  conflictField: 'phone' | 'email' | null;
  onChange?: (next: CustomerFormState) => void;
  onSubmit: (form: CustomerFormState) => Promise<void> | void;
  onCancel: () => void;
  onIdentityChange?: (form: CustomerFormState) => void;
}) {
  const [form, setForm] = useState<CustomerFormState>(initialValue);
  const phoneRef = useRef<HTMLInputElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setForm(initialValue);
  }, [initialValue]);

  useEffect(() => {
    if (conflictField === 'phone') phoneRef.current?.focus();
    if (conflictField === 'email') emailRef.current?.focus();
  }, [conflictField]);

  const update = (mut: (curr: CustomerFormState) => CustomerFormState) =>
    setForm((curr) => {
      const next = mut(curr);
      onChange?.(next);
      return next;
    });

  const identityValid = useMemo(
    () =>
      form.firstName.trim().length > 0 ||
      form.lastName.trim().length > 0 ||
      form.companyName.trim().length > 0,
    [form.firstName, form.lastName, form.companyName],
  );

  return (
    <form
      className="mx-auto max-w-3xl space-y-6 px-6 py-8"
      onSubmit={(e) => {
        e.preventDefault();
        if (!identityValid) return;
        void onSubmit(form);
      }}
    >
      {errorMessage && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{errorMessage}</div>
      )}

      {duplicateMatches.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          <div className="font-medium">Similar customers already exist</div>
          <ul className="mt-2 space-y-1">
            {duplicateMatches.map((m) => {
              const loc = [m.street, m.city, m.zip].filter(Boolean).join(' · ');
              return (
                <li key={m.id} className="flex items-center justify-between gap-3">
                  <span>
                    {m.displayName}
                    {loc && <span className="text-amber-700"> · {loc}</span>}
                  </span>
                  <a
                    className="text-xs font-medium text-amber-900 underline"
                    href={`/customers/${m.id}`}
                  >
                    Open
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Section title="Identity">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name">
            <Input
              value={form.firstName}
              onChange={(e) => update((c) => ({ ...c, firstName: e.target.value }))}
              onBlur={() => onIdentityChange?.(form)}
              maxLength={80}
              disabled={saving}
            />
          </Field>
          <Field label="Last name">
            <Input
              value={form.lastName}
              onChange={(e) => update((c) => ({ ...c, lastName: e.target.value }))}
              onBlur={() => onIdentityChange?.(form)}
              maxLength={80}
              disabled={saving}
            />
          </Field>
          <Field label="Company name" className="sm:col-span-2">
            <Input
              value={form.companyName}
              onChange={(e) => update((c) => ({ ...c, companyName: e.target.value }))}
              onBlur={() => onIdentityChange?.(form)}
              maxLength={120}
              disabled={saving}
            />
          </Field>
          <Field label="Role">
            <Input
              value={form.role}
              onChange={(e) => update((c) => ({ ...c, role: e.target.value }))}
              maxLength={80}
              disabled={saving}
            />
          </Field>
          <Field label="Customer type">
            <Select
              value={form.customerType}
              onChange={(value) =>
                update((c) => ({
                  ...c,
                  customerType: value as 'Homeowner' | 'Business',
                  subcontractor: value === 'Business' ? c.subcontractor : false,
                }))
              }
              options={CUSTOMER_TYPES.map((t) => ({ value: t, label: t }))}
              disabled={saving}
            />
          </Field>

          {form.customerType === 'Business' && (
            <Toggle
              label="Subcontractor"
              checked={form.subcontractor}
              onChange={(v) => update((c) => ({ ...c, subcontractor: v }))}
              disabled={saving}
            />
          )}

          <Toggle
            label="Do not service"
            checked={form.doNotService}
            onChange={(v) =>
              update((c) => ({
                ...c,
                doNotService: v,
                sendNotifications: v ? false : c.sendNotifications,
              }))
            }
            disabled={saving}
          />
          <Toggle
            label="Send notifications"
            checked={form.sendNotifications && !form.doNotService}
            onChange={(v) => update((c) => ({ ...c, sendNotifications: v }))}
            disabled={saving || form.doNotService}
          />
        </div>
        {!identityValid && (
          <p className="mt-2 text-xs text-red-600">Provide a first/last name or a company name.</p>
        )}
      </Section>

      <Section title="Phones">
        <div className="space-y-2">
          {form.phones.map((p, idx) => (
            <div key={p._key} className="grid gap-2 sm:grid-cols-[1fr_140px_1fr_auto]">
              <Input
                ref={idx === 0 ? phoneRef : undefined}
                value={p.value}
                placeholder="(555) 555-1234"
                onChange={(e) =>
                  update((c) => {
                    const next = [...c.phones];
                    next[idx] = { ...next[idx]!, value: e.target.value };
                    return { ...c, phones: next };
                  })
                }
                disabled={saving}
              />
              <Select
                value={p.type ?? ''}
                onChange={(value) =>
                  update((c) => {
                    const next = [...c.phones];
                    next[idx] = {
                      ...next[idx]!,
                      type: value === '' ? null : (value as PhoneInput['type']),
                    };
                    return { ...c, phones: next };
                  })
                }
                options={[
                  { value: '', label: 'Type' },
                  ...PHONE_TYPES.map((t) => ({ value: t, label: t })),
                ]}
                disabled={saving}
              />
              <Input
                value={p.note}
                placeholder="Note"
                onChange={(e) =>
                  update((c) => {
                    const next = [...c.phones];
                    next[idx] = { ...next[idx]!, note: e.target.value };
                    return { ...c, phones: next };
                  })
                }
                disabled={saving}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={() =>
                  update((c) => ({ ...c, phones: c.phones.filter((_, i) => i !== idx) }))
                }
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={saving || form.phones.length >= 10}
            onClick={() =>
              update((c) => ({
                ...c,
                phones: [
                  ...c.phones,
                  { _key: nextKey('phone'), value: '', type: 'mobile', note: '' },
                ],
              }))
            }
          >
            Add phone
          </Button>
        </div>
      </Section>

      <Section title="Emails">
        <div className="space-y-2">
          {form.emails.map((e, idx) => (
            <div key={e._key} className="flex gap-2">
              <Input
                ref={idx === 0 ? emailRef : undefined}
                value={e.value}
                placeholder="name@example.com"
                onChange={(ev) =>
                  update((c) => {
                    const next = [...c.emails];
                    next[idx] = { ...next[idx]!, value: ev.target.value };
                    return { ...c, emails: next };
                  })
                }
                disabled={saving}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={() =>
                  update((c) => ({ ...c, emails: c.emails.filter((_, i) => i !== idx) }))
                }
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={saving || form.emails.length >= 10}
            onClick={() =>
              update((c) => ({
                ...c,
                emails: [...c.emails, { _key: nextKey('email'), value: '' }],
              }))
            }
          >
            Add email
          </Button>
        </div>
      </Section>

      <Section title="Primary address">
        <AddressEditor
          value={form.primaryAddress}
          disabled={saving}
          onChange={(next) => update((c) => ({ ...c, primaryAddress: next }))}
          onBlur={() => onIdentityChange?.(form)}
        />
      </Section>

      {form.additionalAddresses.length > 0 && (
        <Section title="Additional addresses">
          <div className="space-y-4">
            {form.additionalAddresses.map((a, idx) => (
              <div key={a._key} className="rounded-md border border-slate-200 p-3">
                <AddressEditor
                  value={a}
                  disabled={saving}
                  onChange={(next) =>
                    update((c) => {
                      const list = [...c.additionalAddresses];
                      list[idx] = next;
                      return { ...c, additionalAddresses: list };
                    })
                  }
                />
                <div className="mt-2 flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={saving}
                    onClick={() =>
                      update((c) => ({
                        ...c,
                        additionalAddresses: c.additionalAddresses.filter((_, i) => i !== idx),
                      }))
                    }
                  >
                    Remove address
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={saving || form.additionalAddresses.length >= 20}
          onClick={() =>
            update((c) => ({
              ...c,
              additionalAddresses: [...c.additionalAddresses, newAddress()],
            }))
          }
        >
          Add another address
        </Button>
      </div>

      <Section title="Billing address">
        <Input
          value={form.billingAddress}
          placeholder="Optional single line"
          onChange={(e) => update((c) => ({ ...c, billingAddress: e.target.value }))}
          disabled={saving}
        />
      </Section>

      <Section title="Tags">
        <TagEditor
          value={form.tags}
          disabled={saving}
          onChange={(next) => update((c) => ({ ...c, tags: next }))}
        />
      </Section>

      <Section title="Notes">
        <textarea
          className="min-h-24 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-100"
          value={form.customerNotes}
          maxLength={4000}
          onChange={(e) => update((c) => ({ ...c, customerNotes: e.target.value }))}
          disabled={saving}
        />
      </Section>

      <Section title="Lead">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Lead source">
            <Input
              value={form.leadSource}
              onChange={(e) => update((c) => ({ ...c, leadSource: e.target.value }))}
              disabled={saving}
            />
          </Field>
          <Field label="Referred by">
            <Input
              value={form.referredBy}
              onChange={(e) => update((c) => ({ ...c, referredBy: e.target.value }))}
              disabled={saving}
            />
          </Field>
        </div>
      </Section>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || !identityValid}>
          {saving ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <select
      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-100"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 disabled:opacity-50"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      {label}
    </label>
  );
}

function AddressEditor({
  value,
  disabled,
  onChange,
  onBlur,
}: {
  value: AddressDraft;
  disabled?: boolean;
  onChange: (next: AddressDraft) => void;
  onBlur?: () => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Street" className="sm:col-span-2">
        <Input
          value={value.street ?? ''}
          onChange={(e) => onChange({ ...value, street: e.target.value })}
          disabled={disabled}
        />
      </Field>
      <Field label="Unit">
        <Input
          value={value.unit ?? ''}
          onChange={(e) => onChange({ ...value, unit: e.target.value })}
          disabled={disabled}
        />
      </Field>
      <Field label="City">
        <Input
          value={value.city ?? ''}
          onChange={(e) => onChange({ ...value, city: e.target.value })}
          onBlur={onBlur}
          disabled={disabled}
        />
      </Field>
      <Field label="State">
        <Select
          value={value.state}
          onChange={(s) => onChange({ ...value, state: s })}
          options={[{ value: '', label: '—' }, ...US_STATES.map((s) => ({ value: s, label: s }))]}
          disabled={disabled}
        />
      </Field>
      <Field label="ZIP">
        <Input
          value={value.zip ?? ''}
          onChange={(e) => onChange({ ...value, zip: e.target.value })}
          onBlur={onBlur}
          disabled={disabled}
        />
      </Field>
      <Field label="Notes" className="sm:col-span-2">
        <Input
          value={value.notes ?? ''}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
          disabled={disabled}
        />
      </Field>
    </div>
  );
}

function TagEditor({
  value,
  disabled,
  onChange,
}: {
  value: string[];
  disabled?: boolean;
  onChange: (next: string[]) => void;
}) {
  const [input, setInput] = useState('');
  function addTag() {
    const t = input.trim();
    if (t.length === 0 || value.includes(t)) {
      setInput('');
      return;
    }
    onChange([...value, t]);
    setInput('');
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
          >
            {tag}
            <button
              type="button"
              className="text-slate-400 hover:text-slate-700"
              disabled={disabled}
              onClick={() => onChange(value.filter((t) => t !== tag))}
              aria-label={`Remove ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <Input
          value={input}
          placeholder="Add tag and press Enter"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTag();
            }
          }}
          disabled={disabled}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={disabled || input.trim().length === 0}
          onClick={addTag}
        >
          Add
        </Button>
      </div>
    </div>
  );
}
