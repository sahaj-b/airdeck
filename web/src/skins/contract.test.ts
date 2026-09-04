import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));

// base.css owns the selectors, preview.css only neutralizes geometry.
const SKIN_FILES = readdirSync(dir).filter(
  (f) => f.endsWith('.css') && f !== 'base.css' && f !== 'preview.css',
);

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Every var(--sk-x, fallback) in base.css, fallback extracted with balanced
// parens. Returns [token, fallback | null] (null = bare var, no fallback).
function baseVarUses(css: string): [string, string | null][] {
  const out: [string, string | null][] = [];
  const re = /var\(\s*(--sk-[\w-]+)\s*(,|\))/g;
  let m = re.exec(css);
  while (m !== null) {
    const token = m[1] ?? '';
    if (m[2] === ')') {
      out.push([token, null]);
      continue;
    }
    // Scan from the char after the comma to the matching close paren.
    let depth = 1;
    let i = (m.index ?? 0) + m[0].length;
    const start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === '(') depth++;
      else if (css[i] === ')') depth--;
      i++;
    }
    out.push([token, css.slice(start, i - 1).trim()]);
    re.lastIndex = i;
    m = re.exec(css);
  }
  return out;
}

// Every --sk-x: value in a scope file. Values never contain ';'.
function scopeTokens(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of css.matchAll(/(--sk-[\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(match[1] ?? '', (match[2] ?? '').trim());
  }
  return out;
}

describe('skin contract', () => {
  for (const file of SKIN_FILES) {
    const css = stripComments(readFileSync(join(dir, file), 'utf8'));
    const id = file.replace('.css', '');

    it(`${file} is wrapped in @scope to prevent preview bleed`, () => {
      expect(css).toContain(`@scope ([data-skin="${id}"]) to ([data-skin])`);
      // Inside the scope, selectors are implicitly scoped to that skin;
      // they must not target other skins or the global scope.
      const otherSkins = SKIN_FILES.map((f) => f.replace('.css', '')).filter(
        (other) => other !== id,
      );
      for (const other of otherSkins) {
        expect(css).not.toContain(`[data-skin="${other}"]`);
      }
    });

    it(`${file} uses no !important and no html prefix`, () => {
      expect(css).not.toContain('!important');
      expect(css).not.toContain('html[');
    });
  }

  it('every base token has a fallback', () => {
    const base = stripComments(readFileSync(join(dir, 'base.css'), 'utf8'));
    const bare = baseVarUses(base)
      .filter(([, fallback]) => fallback === null)
      .map(([token]) => token);
    expect(bare).toEqual([]);
  });

  it('preview reset covers every token base.css reads', () => {
    const base = stripComments(readFileSync(join(dir, 'base.css'), 'utf8'));
    // All mentions, including tokens nested inside other tokens' fallbacks
    // (e.g. --sk-face-bg inside --sk-south-bg's fallback): inheritance
    // bleeds through any of them, so the reset must cover all of them.
    const universe = new Set<string>();
    for (const match of base.matchAll(/var\(\s*(--sk-[\w-]+)/g)) {
      universe.add(match[1] ?? '');
    }
    const reset = scopeTokens(
      stripComments(readFileSync(join(dir, 'preview.css'), 'utf8')),
    );
    const missing = [...universe].filter((t) => !reset.has(t));
    const extra = [...reset.keys()].filter((t) => !universe.has(t));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });
});
