import type { HTMLAttributes, TableHTMLAttributes } from 'react';

export function TableWrap({
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ui-table-wrap ${className}`.trim()} {...props} />;
}

export function Table({
  className = '',
  ...props
}: TableHTMLAttributes<HTMLTableElement>) {
  return <table className={`ui-table ${className}`.trim()} {...props} />;
}
