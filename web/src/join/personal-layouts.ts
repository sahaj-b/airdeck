import type { LayoutDocument } from '../shared/layout';
import { validateLayout } from '../shared/layout';

export const PERSONAL_LAYOUTS_KEY = 'airdeck.personalLayouts';

export function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'layout';
}

export function loadPersonalLayouts(): Record<string, LayoutDocument> {
  try {
    const raw = localStorage.getItem(PERSONAL_LAYOUTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return {};
    const out: Record<string, LayoutDocument> = {};
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (validateLayout(value)) {
        out[key] = structuredClone(value as LayoutDocument);
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function savePersonalLayout(document: LayoutDocument): string | null {
  try {
    if (!validateLayout(document)) return 'Invalid layout document.';
    const all = loadPersonalLayouts();
    all[document.id] = structuredClone(document);
    localStorage.setItem(PERSONAL_LAYOUTS_KEY, JSON.stringify(all));
    return null;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      return 'Storage is full. Delete a personal layout first.';
    }
    return error instanceof Error ? error.message : 'Failed to save layout.';
  }
}

export function deletePersonalLayout(id: string): void {
  try {
    const all = loadPersonalLayouts();
    delete all[id];
    localStorage.setItem(PERSONAL_LAYOUTS_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}

export function renamePersonalLayout(
  oldId: string,
  newName: string,
): { nextId: string; error?: string } {
  const all = loadPersonalLayouts();
  const doc = all[oldId];
  if (!doc) return { nextId: oldId, error: 'Layout not found.' };
  const trimmed = newName.trim();
  if (!trimmed) return { nextId: oldId, error: 'Name is required.' };
  const slug = slugify(trimmed);
  if (slug !== oldId && all[slug]) {
    return {
      nextId: oldId,
      error: `An edit named "${trimmed}" already exists.`,
    };
  }
  const nextDoc: LayoutDocument = {
    ...structuredClone(doc),
    id: slug,
    name: trimmed,
  };
  if (!validateLayout(nextDoc))
    return { nextId: oldId, error: 'Invalid layout after rename.' };
  try {
    const nextAll = { ...all };
    delete nextAll[oldId];
    nextAll[slug] = nextDoc;
    localStorage.setItem(PERSONAL_LAYOUTS_KEY, JSON.stringify(nextAll));
    return { nextId: slug };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      return { nextId: oldId, error: 'Storage is full.' };
    }
    return {
      nextId: oldId,
      error: error instanceof Error ? error.message : 'Rename failed.',
    };
  }
}
