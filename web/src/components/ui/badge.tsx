import type { HTMLAttributes } from 'react';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'muted';
}

export function Badge({
  className = '',
  variant = 'default',
  ...props
}: BadgeProps) {
  return (
    <span
      className={`ui-badge ui-badge-${variant} ${className}`.trim()}
      {...props}
    />
  );
}
