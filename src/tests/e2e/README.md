# Browser acceptance tests

## Run

```sh
npm ci
npx playwright install --with-deps chromium
npm run test:e2e
```

Playwright starts Vite on `127.0.0.1:5173` with a strict port. Local runs may reuse an existing dev server; CI starts its own. An optional `PLAYWRIGHT_BASE_URL` can target a separately running application. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select an existing Chromium binary. The normal default is Playwright's pinned browser.

## Coverage

- **Shell/import/recovery:** empty library, real PDF.js text/canvas rendering, malformed and empty PDF recovery
- **Reader:** page bounds, keyboard/range navigation, accessible zoom and mode controls, native keyboard button activation
- **Quick Flip:** selection without navigation, cancel/commit, repeat entry, held-arrow acceleration, Space autorepeat, focus containment/restore, holding and releasing preview pages
- **Workspace:** duplicate hold prevention, reference window opening/closing, independent navigation, dock/swap/float, remove-and-close
- **Persistence:** manual and debounced saves, idle-save-loop regression, reload/recent restoration, two-document isolation, failed replacement recovery, immediate library and document-switch flushing
- **Responsive:** full touch-accessible workflow at desktop 1440×900, tablet 768×1024, and mobile 390×844, including horizontal overflow and in-viewport action checks

Every test gets an isolated browser context and real IndexedDB. Fixture imports use the real file input; tests do not inject application stores. IndexedDB is read only for durable-save checkpoints. The single deliberate 1.5-second idle wait checks three autosave debounce periods for an unwanted write loop.

## Evidence

The responsive workflow attaches PNGs for welcome, reader, keyboard focus, Quick Flip, held pages, and comparison; the invalid-import test attaches the error state. Open `playwright-report/index.html` after a run. Failure screenshots and traces are retained automatically. These captures are review evidence, not pixel-golden tests.

The fixture generator is documented in `../fixtures/README.md`. Browser execution remains necessary: `playwright test --list`, lint, TypeScript checks, and UI/unit tests cannot establish that these real browser cases passed. The current projects use Chromium; Firefox, WebKit, real iOS devices, long scanned books, password-protected files, and storage-exhaustion scenarios require separate coverage.
