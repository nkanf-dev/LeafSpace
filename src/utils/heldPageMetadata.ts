import type { HeldPage } from '../types/domain';

export type HeldPageMetadata = Pick<HeldPage, 'customName' | 'note'>;
export const HELD_NAME_LIMIT = 80;
export const HELD_NOTE_LIMIT = 500;
export const metadataLength = (value: string) => Array.from(value).length;

/** Validate only explicitly edited fields. Never trim/truncate legacy metadata on read. */
export function normalizeHeldPageMetadata(changes: HeldPageMetadata): HeldPageMetadata | null {
  const result: HeldPageMetadata = {};
  for (const key of ['customName', 'note'] as const) {
    if (!Object.hasOwn(changes, key)) continue;
    const value = changes[key];
    if (value !== undefined && typeof value !== 'string') return null;
    const normalized = key === 'customName' ? value?.trim().replace(/\s+/gu, ' ') : value?.trim();
    if (metadataLength(normalized ?? '') > (key === 'customName' ? HELD_NAME_LIMIT : HELD_NOTE_LIMIT)) return null;
    result[key] = normalized || undefined;
  }
  return result;
}
