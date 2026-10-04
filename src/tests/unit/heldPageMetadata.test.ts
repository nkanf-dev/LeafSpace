import { beforeEach, describe, expect, it, vi } from 'vitest';
import { heldStore } from '../../stores/heldStore';
import { HELD_NAME_LIMIT, HELD_NOTE_LIMIT, metadataLength } from '../../utils/heldPageMetadata';

vi.mock('../../services/ThumbnailService', () => ({ thumbnailService: {
  ensureThumbnail: vi.fn().mockResolvedValue(undefined), getThumbnailKey: (page: number) => `test_${page}`,
} }));

describe('held-page metadata updates', () => {
  beforeEach(async () => { heldStore.getState().reset(); await heldStore.getState().holdPage(8); await heldStore.getState().holdPage(12); });
  const edit = (changes: Parameters<ReturnType<typeof heldStore.getState>['updatePageMetadata']>[2]) => {
    const state = heldStore.getState();
    return state.updatePageMetadata(state.pages[0].id, state.metadataGeneration, changes);
  };

  it('updates only whitelisted metadata while preserving page/window/thumbnail identity and order', () => {
    heldStore.getState().markHeldPageOpen(8, 'reference');
    const before = heldStore.getState().pages;
    expect(edit({ customName: '  定义\n与证明  ', note: '  对照第二章\n再看图示  ', pageNumber: 99 } as never)).toBe(true);
    expect(heldStore.getState().pages[0]).toEqual({ ...before[0], customName: '定义 与证明', note: '对照第二章\n再看图示' });
    expect(heldStore.getState().pages[1]).toBe(before[1]);
    expect(heldStore.getState().metadataGeneration).toBeGreaterThan(0);
  });
  it('clears blank fields, leaving the default name intact', () => {
    edit({ customName: '证明', note: '备注' });
    expect(edit({ customName: ' \n\t ', note: '  ' })).toBe(true);
    expect(heldStore.getState().pages[0]).toMatchObject({ defaultName: '第 8 页', customName: undefined, note: undefined });
  });
  it('accepts Unicode limits without counting surrogate halves and rejects oversized edits atomically', () => {
    expect(edit({ customName: '页'.repeat(HELD_NAME_LIMIT), note: '📖'.repeat(HELD_NOTE_LIMIT) })).toBe(true);
    expect(metadataLength(heldStore.getState().pages[0].note!)).toBe(HELD_NOTE_LIMIT);
    const before = heldStore.getState().pages;
    expect(edit({ customName: '新名字', note: '字'.repeat(HELD_NOTE_LIMIT + 1) })).toBe(false);
    expect(edit({ customName: '📖'.repeat(HELD_NAME_LIMIT + 1) })).toBe(false);
    expect(edit({ note: 42 } as never)).toBe(false);
    expect(heldStore.getState().pages).toBe(before);
  });
  it('preserves long legacy fields on unrelated or unchanged updates without truncation or save churn', () => {
    const legacy = { ...heldStore.getState().pages[0], customName: '长'.repeat(300), note: '旧'.repeat(1000) };
    heldStore.getState().restorePages([legacy]);
    const before = heldStore.getState().pages;
    expect(edit({})).toBe(true);
    expect(heldStore.getState().pages).toBe(before);
    expect(edit({ note: '新备注' })).toBe(true);
    expect(heldStore.getState().pages[0].customName).toBe(legacy.customName);
  });
  it('does not invalidate drafts for linked-window updates or reordering', () => {
    const before = heldStore.getState();
    heldStore.getState().markHeldPageOpen(8, 'reference');
    heldStore.getState().reorderHeldPages(0, 1);
    expect(heldStore.getState().metadataGeneration).toBe(before.metadataGeneration);
    expect(heldStore.getState().updatePageMetadata(before.pages[0].id, before.metadataGeneration, { note: '继续' })).toBe(true);
    expect(heldStore.getState().pages[1]).toMatchObject({ note: '继续', linkedWindowIds: ['reference'] });
  });
  it.each(['reset', 'restore', 'remove'] as const)('rejects retired writes after %s, even for restored identical ids', async kind => {
    const before = heldStore.getState();
    if (kind === 'reset') { heldStore.getState().reset(); heldStore.getState().restorePages(before.pages); }
    if (kind === 'restore') heldStore.getState().restorePages(before.pages);
    if (kind === 'remove') { heldStore.getState().unholdPage(8); await heldStore.getState().holdPage(8); }
    const current = heldStore.getState().pages;
    expect(before.updatePageMetadata(before.pages[0].id, before.metadataGeneration, { note: '旧草稿' })).toBe(false);
    expect(heldStore.getState().pages).toBe(current);
    expect(current.every(page => !page.note)).toBe(true);
  });
});
