import type { LabelHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

type Props = LabelHTMLAttributes<HTMLLabelElement>;

export function Label({ className, ...rest }: Props) {
  return (
    <label
      className={cn('block text-sm font-medium text-slate-700', className)}
      {...rest}
    />
  );
}
