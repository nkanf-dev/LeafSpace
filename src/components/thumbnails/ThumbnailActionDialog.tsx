import { useLayoutEffect, useRef } from 'react';
import type { ThumbnailActions, ThumbnailActionRequest } from '../../services/ThumbnailActions';

interface Props {
  controller: ThumbnailActions;
  request: ThumbnailActionRequest;
  awaitingRelease: boolean;
}
export function ThumbnailActionDialog({ controller, request, awaitingRelease }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { cancel.current?.focus({ preventScroll: true }); }, [request]);
  return <div data-thumbnail-actions className="fixed inset-0 z-[3100] flex items-end justify-center bg-stone-950/35 p-3 sm:items-center" onClick={event => {
    if (event.target === event.currentTarget && !awaitingRelease) controller.dismiss();
  }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={`第 ${request.pageNumber} 页操作`} className="max-h-[85dvh] w-full max-w-sm overflow-y-auto border border-stone-400 bg-[var(--surface)] p-4 shadow-xl" onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <h2 className="mb-3 text-base font-semibold text-stone-900">第 {request.pageNumber} 页操作</h2>
      <div className="flex flex-col gap-2">
        {request.actions.map(action => <button key={action.id} type="button" disabled={awaitingRelease} className="min-h-11 border border-[var(--border)] bg-white px-4 py-3 text-left text-sm text-stone-800 disabled:opacity-50" onClick={() => controller.run(action.id)}>{action.label}</button>)}
        <button ref={cancel} type="button" className="min-h-11 border border-stone-500 px-4 py-3 text-sm font-medium text-stone-800" onClick={() => controller.dismiss()}>取消</button>
      </div>
    </div>
  </div>;
}
