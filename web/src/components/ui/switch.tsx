import type { InputHTMLAttributes } from 'react';

export function Switch({
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      role="switch"
      aria-checked={props.checked}
      className={`ui-switch ${className}`.trim()}
      {...props}
    />
  );
}
