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
- **Quick Flip:** selection without navigation, cancel/commit, repeat entry, held-arrow acceleration, Space autorepeat, focus containment/restore, holding and releasing preview pages
- **Workspace:** duplicate hold prevention, reference window opening/closing, independent navigation, dock/swap/float, remove-and-close, single-click focused-reader navigation, double-click comparison, Escape stack priority
- **Completed reading flows:** 120-page nested outline, active-reference Quick Flip/TOC/timeline/page entry, 2–5-pane grids, repeated docking, capacity messages, reorder and explicit remove/close choices
- **Rendered viewport:** independent main/reference scale and two-axis scroll restoration, repeated fit-width reset, Ctrl-wheel paper-point anchoring
- **Large raster PDF:** generated 106 MB image-only document, first-render timing evidence, final-page navigation, held thumbnail and IndexedDB reopen
- **Persistence:** manual and debounced saves, idle-save-loop regression, reload/recent restoration, two-document isolation, failed replacement recovery, immediate library and document-switch flushing, malformed/partial saved-state recovery, missing recent-file recovery
- **Responsive:** full touch-accessible workflow at desktop 1440×900, tablet 768×1024, and mobile 390×844, including horizontal overflow and in-viewport action checks

Every test gets an isolated browser context and real IndexedDB. Fixture imports use the real file input; tests do not inject application stores. IndexedDB is read for durable-save checkpoints. Three recovery tests deliberately replace or delete only their isolated synthetic-book records to simulate malformed snapshots, partial legacy data, and a missing local file. The single deliberate 1.5-second idle wait checks three autosave debounce periods for an unwanted write loop.

Native reverse/forward Tab traversal and visible focus are asserted on all three engines. A standalone WebKit SVG hit-target probe documents the browser's clicked-descendant behavior; decorative SVGs are non-interactive so button clicks preserve normal keyboard navigation.

## Evidence

The responsive workflow attaches PNGs for welcome, reader, keyboard focus, Quick Flip, held pages, and comparison; the invalid-import test attaches the error state. Open `playwright-report/index.html` after a run. Failure screenshots and traces are retained automatically. These captures are review evidence, not pixel-golden tests.

The fixture generator is documented in `../fixtures/README.md`. Browser execution remains necessary: `playwright test --list`, lint, TypeScript checks, and UI/unit tests cannot establish that these real browser cases passed. Projects cover Chromium, Firefox and WebKit, plus Chromium tablet/mobile viewports. A dedicated mobile case opens and restores five reachable window tabs. Real iOS devices, password-protected files, and full storage-exhaustion scenarios require separate coverage. The generated 106 MB scan is an automated capacity regression, not a benchmark claim for arbitrary books or devices.
