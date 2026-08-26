import type { HTMLAttributes } from 'react';

export function Card({
  className = '',
  ...props
}: HTMLAttributes<HTMLElement>) {
  return <section className={`ui-card ${className}`.trim()} {...props} />;
}

export function CardHeader({
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ui-card-header ${className}`.trim()} {...props} />;
}

export function CardContent({
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ui-card-content ${className}`.trim()} {...props} />;
}
