import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function NumberField({
  label,
  labelWidth = 'min-w-6',
  value,
  min,
  max,
  error,
  note,
  onChange,
}: {
  label: string;
  labelWidth?: string;
  value: number;
  min?: number;
  max?: number;
  error?: string;
  note?: string;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(() => formatNumber(value));
  const lastValueRef = useRef(value);

  useEffect(() => {
    if (value !== lastValueRef.current) {
      lastValueRef.current = value;
      setText(formatNumber(value));
    }
  }, [value]);

  const parsed = parseFloat(text);
  const invalid =
    text.trim() === '' ||
    !Number.isFinite(parsed) ||
    (min !== undefined && parsed < min) ||
    (max !== undefined && parsed > max);

  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 items-center">
      <Label
        className={`shrink-0 text-[11px] font-medium text-muted-foreground text-center ${labelWidth}`}
      >
        {label}
      </Label>
      <Input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (!invalid) {
            lastValueRef.current = parsed;
            onChange(parsed);
          } else {
            setText(formatNumber(lastValueRef.current));
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !invalid) {
            lastValueRef.current = parsed;
            onChange(parsed);
            (event.target as HTMLInputElement).blur();
          }
          if (event.key === 'Escape') {
            setText(formatNumber(lastValueRef.current));
            (event.target as HTMLInputElement).blur();
          }
        }}
        className={`min-w-0 h-7 font-mono text-xs ${invalid ? 'border-destructive bg-destructive/10 text-destructive focus-visible:border-destructive focus-visible:ring-destructive/20' : ''}`}
      />
      {error && (
        <p className="col-start-2 text-[11px] leading-tight text-destructive">
          {error}
        </p>
      )}
      {note && !error && (
        <p className="col-start-2 text-[11px] leading-tight text-muted-foreground">
          {note}
        </p>
      )}
    </div>
  );
}

export function formatNumber(value: number): string {
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}
