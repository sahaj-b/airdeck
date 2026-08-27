import type { SelectHTMLAttributes } from 'react';

export function NativeSelect({
  className = '',
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`ui-select ${className}`.trim()} {...props} />;
}
