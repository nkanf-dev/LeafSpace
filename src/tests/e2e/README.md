# Browser acceptance tests

## Run

```sh
npm ci
npx playwright install --with-deps chromium firefox webkit
npm run test:e2e
```

Playwright builds the deployable bundle, then starts Vite preview on `127.0.0.1:4173` with a strict port. The production preview avoids dev-server dependency re-optimization and HMR reloads that can discard a currently open book. Both local runs and CI start their own preview server. An optional `PLAYWRIGHT_BASE_URL` skips server startup and targets a separately running application. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select an existing Chromium binary. The normal default is Playwright's pinned browser.

## Coverage

- **Shell/import/recovery:** empty library, real PDF.js text/canvas rendering, malformed and empty PDF recovery
- **Reader:** page bounds, keyboard/range navigation, accessible zoom and mode controls, native keyboard button activation
- **Mouse pan:** rapid native movement retains the latest target across saved intermediate scroll frames, settles at measured bounds, and is repeated five times without retries in WebKit. Deterministic UI tests also cover release-time settling, authoritative external restoration during pending paint, clamped targets and integer-rounded offsets
- **Quick Flip:** selection without navigation, cancel/commit, repeat entry, held-arrow acceleration, Space autorepeat, focus containment/restore, holding and releasing preview pages
- **Thumbnail actions:** six-project touch-pointer contracts for Quick Flip and held-page sheets, original-release suppression, first-Escape/Tab ownership, pressed-versus-selected page, linked-window removal and focus recovery, breakpoint/rotation recovery, 320px and short-landscape layouts, native Enter/Space buttons, stacking hit targets and scoped accessibility checks. Chromium mobile/tablet also use native CDP touch for hold/release, interruption, fresh actions and scrolling
- **Workspace:** duplicate hold prevention, reference window opening/closing, independent navigation, dock/swap/float, remove-and-close, single-click focused-reader navigation, double-click comparison, Escape stack priority
- **Interrupted workspace input:** drag/resize/split cancellation unit contracts, native mouse drag followed by dispatched blur or keyboard Escape, reference-close focus across floating/split/grid layouts, and keyboard focus recovery after held-page cancellation/removal
- **Held-read intent:** slow recognized native mouse click sequences restore original main/reference pages and two-axis viewports before comparison; save/reload preserves the result. Native Enter/Space and compact click/touch paths remain distinct. Store tests permanently invalidate superseded intents, including navigation away and back
- **Completed reading flows:** 120-page nested outline, active-reference Quick Flip/TOC/timeline/page entry, 2–5-pane grids, repeated docking, capacity messages, reorder and explicit remove/close choices
- **Rendered viewport:** independent main/reference scale and two-axis scroll restoration, repeated fit-width reset, Ctrl-wheel paper-point anchoring
- **Large raster PDF:** generated 106 MB image-only document, first-render timing evidence, final-page navigation, held thumbnail and IndexedDB reopen
- **Persistence:** manual and debounced saves, idle-save-loop regression, reload/recent restoration, two-document isolation, failed replacement recovery, immediate library and document-switch flushing, malformed/partial saved-state recovery, missing recent-file recovery
- **Storage faults:** a failed PDF asset write cannot be masked by saving a small snapshot; retries preserve the original file and latest reading position. A failed snapshot read blocks implicit overwrite during library/import navigation, with keyboard-cancellable explicit replacement
- **Storage upgrades:** native v1 databases containing Blob or ArrayBuffer PDFs upgrade without moving/replacing assets; schema/metadata failures still allow intact PDFs to render, then saving recovers after retry. Warm save/recent refresh tests count zero PDF-value reads or writes at the IndexedDB API boundary. Legacy Blob coverage first performs a native PDF-byte round trip outside the app: only Linux WebKit’s exact known Blob-preparation `UnknownError`, with a successful ArrayBuffer control, marks that Blob migration case unavailable and attaches the diagnostic. Other engine/probe failures remain failures; bytes and all application recovery tests still run on WebKit
- **Responsive:** full touch-accessible workflow at desktop 1440×900, tablet 768×1024, and mobile 390×844, including horizontal overflow and in-viewport action checks

Every test gets an isolated browser context and real IndexedDB. Fixture imports use the real file input; tests do not inject application stores. IndexedDB is read for durable-save checkpoints. Three recovery tests deliberately replace or delete only their isolated synthetic-book records to simulate malformed snapshots, partial legacy data, and a missing local file. The single deliberate 1.5-second idle wait checks three autosave debounce periods for an unwanted write loop.

Storage-recovery tests inject a `QuotaExceededError` for PDF-asset writes or an `UnknownError` for workspace reads at the IndexedDB operation boundary, then restore the operation and verify recovery through real controls. This tests application error handling, not physical disk exhaustion or a browser's eviction policy.

Storage version 2 adds only `bookMetadata`; the existing `books` and `workspaces` records stay in place. Unit tests cover partial sidecars, atomic replacement rollback, old v1 writers reopening after versionchange, malformed metadata, source/backfill races, and read-only dynamic-schema fallback after an aborted upgrade. Recents inspect all lightweight legacy keys and metadata, then read only selected cold/stale payloads. Warm synthetic three-book saves went from 20 MiB of PDF-value reads plus 5 MiB written to zero PDF-value I/O; these are operation counts, not browser latency/heap benchmarks. Recency reconciliation chooses the latest valid timestamp. Legacy rewrites that retain the identical source timestamp have no index revision signal; an explicit file open refreshes that metadata. No blanket cross-version or clock-rollback coherence is claimed.

Native reverse/forward Tab traversal and visible focus are asserted on all three engines. A standalone WebKit SVG hit-target probe documents the browser's clicked-descendant behavior; decorative SVGs are non-interactive so button clicks preserve normal keyboard navigation.

## Evidence

The responsive workflow attaches PNGs for welcome, reader, keyboard focus, Quick Flip, held pages, and comparison; the invalid-import test attaches the error state. Open `playwright-report/index.html` after a run. Failure screenshots and traces are retained automatically. These captures are review evidence, not pixel-golden tests.

The fixture generator is documented in `../fixtures/README.md`. Browser execution remains necessary: `playwright test --list`, lint, TypeScript checks, and UI/unit tests cannot establish that these real browser cases passed. Projects cover Chromium, Firefox and WebKit, plus Chromium tablet/mobile viewports. A dedicated mobile case opens and restores five reachable window tabs. Real iOS devices, password-protected files, and full storage-exhaustion scenarios require separate coverage. The generated 106 MB scan is an automated capacity regression, not a benchmark claim for arbitrary books or devices.

Storage-failure render checks compare actual decoded fixture pixels, retain a full native canvas bitmap, and capture the screen before readback so instrumentation cannot hide a malformed first paint. They also exercise native text selection. WebKit repeats the schema-failure case five times without retries alongside input stability tests. The reader initializes PDF.js's preferred readback-friendly 2D context before React-PDF's first drawing call; browser context attributes and 106 MB scan timings remain in the evidence.

Document-retirement coverage counts native Worker creation/termination through repeated saved-book library/reopen cycles, both with normal thumbnail workers and forced main-thread fallback. A parked custom-worker request is closed before initialization completes; the test deliberately waits 2 seconds to outlast its 1800 ms timeout and verify obsolete work does not start a fallback parser. These are lifecycle/operation checks, not browser heap measurements. Unit tests separately control pending parse/getPage/render/blob/disposal stages and same-book stale callbacks. Real pending PDF.js worker teardown remains a separate limitation.

Quick Flip's native Escape test checks a moved preview, released-input settling/stability, unchanged reading position and restored focus. It does not assume that Playwright's sequential native keydown/keyup protocol calls always complete within the application's short-tap threshold. Deterministic fake-timer UI coverage separately requires exactly one step per released short tap and no movement after release. Firefox repeats native cancellation and held-release scenarios without retries.
