import type * as React from 'react';

type IconProps = React.SVGProps<SVGSVGElement> & { size?: number };

export function PsCross({ size = 14, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth={0.95}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M1.5 1.5l7 7M8.5 1.5L1.5 8.5" />
    </svg>
  );
}

export function PsCircle({ size = 14, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth={0.95}
      aria-hidden
      {...props}
    >
      <circle cx={5} cy={5} r={3.4} />
    </svg>
  );
}

export function PsSquare({ size = 14, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth={0.95}
      aria-hidden
      {...props}
    >
      <rect x={1.6} y={1.6} width={6.8} height={6.8} rx={0.5} />
    </svg>
  );
}

export function PsTriangle({ size = 14, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth={0.95}
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M5 1.7l3.9 6.6H1.1z" />
    </svg>
  );
}

const MAP = {
  Cross: PsCross,
  Circle: PsCircle,
  Square: PsSquare,
  Triangle: PsTriangle,
} as const;

export function PsIcon({
  name,
  size = 14,
  className,
}: {
  name: keyof typeof MAP;
  size?: number;
  className?: string;
}) {
  const C = MAP[name];
  return <C size={size} className={className} />;
}
