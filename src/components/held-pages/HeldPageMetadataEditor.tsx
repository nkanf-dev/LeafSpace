import { useId, useRef, useState } from 'react';
import type { HeldPage } from '../../types/domain';
import { HELD_NAME_LIMIT, HELD_NOTE_LIMIT, metadataLength, normalizeHeldPageMetadata, type HeldPageMetadata } from '../../utils/heldPageMetadata';

interface Props {
  page: HeldPage;
  onSave: (changes: HeldPageMetadata) => boolean;
  onClose: () => void;
}

export function HeldPageMetadataEditor({ page, onSave, onClose }: Props) {
  // This component is remounted for every edit, so its initial values and callback
  // belong to the opening page/session, even if the list updates while typing.
  const [initial] = useState({ customName: page.customName ?? '', note: page.note ?? '' });
  const [name, setName] = useState(initial.customName);
  const [note, setNote] = useState(initial.note);
  const [error, setError] = useState(false);
  const composing = useRef(false);
  const id = useId();
  const changes: HeldPageMetadata = {};
  if (name !== initial.customName) changes.customName = name;
  if (note !== initial.note) changes.note = note;
  const valid = normalizeHeldPageMetadata(changes) !== null;
  return (
    <form data-held-metadata-editor aria-label={`编辑第 ${page.pageNumber} 页名称和备注`} className="min-w-0 space-y-3 border-t border-[var(--border)] p-3 text-sm"
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={event => {
        if (event.key !== 'Escape' && event.key !== 'Enter') return;
        event.stopPropagation();
        // Let the IME commit/cancel its candidate without saving, discarding the
        // draft, or letting App's Escape handler close a reference/drawer.
        if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) {
          if (event.key === 'Enter') event.preventDefault();
          return;
        }
        if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      }}
      onSubmit={event => {
        event.preventDefault();
        if (composing.current || !valid) return;
        if (onSave(changes)) onClose();
        else setError(true);
      }}>
      <div>
        <label htmlFor={`${id}-name`} className="block font-medium">名称</label>
        <input autoFocus id={`${id}-name`} value={name} onChange={event => { setName(event.target.value); setError(false); }}
          placeholder="例如：定义、证明、图示" aria-describedby={`${id}-name-hint`} className="mt-1 w-full min-w-0 border border-stone-400 bg-white px-2 py-2" />
        <p id={`${id}-name-hint`} className="mt-1 text-xs text-stone-500">留空恢复页码名称 · {metadataLength(name)}/{HELD_NAME_LIMIT}</p>
      </div>
      <div>
        <label htmlFor={`${id}-note`} className="block font-medium">备注</label>
        <textarea id={`${id}-note`} value={note} onChange={event => { setNote(event.target.value); setError(false); }} rows={3}
          placeholder="记下这一页为什么值得回看" aria-describedby={`${id}-note-hint`} className="mt-1 w-full min-w-0 resize-y border border-stone-400 bg-white px-2 py-2 [overflow-wrap:anywhere]" />
        <p id={`${id}-note-hint`} className="mt-1 text-xs text-stone-500">{metadataLength(note)}/{HELD_NOTE_LIMIT} · 保存后随阅读现场保存在本机</p>
      </div>
      {!valid && <p role="status" className="text-xs text-red-800">修改的名称最多 {HELD_NAME_LIMIT} 字，备注最多 {HELD_NOTE_LIMIT} 字。</p>}
      {error && <p role="alert" className="text-xs text-red-800">这张夹页已发生变化，请取消后重新编辑。</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!valid} className="min-h-10 border border-stone-900 bg-stone-900 px-3 py-2 text-white disabled:opacity-40">保存</button>
        <button type="button" onClick={onClose} className="min-h-10 border border-stone-400 px-3 py-2">取消</button>
      </div>
    </form>
  );
}
