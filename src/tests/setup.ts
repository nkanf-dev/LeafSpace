import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// PDF.js checks for DOMMatrix at import time. Rendering is mocked at the
// react-pdf boundary in jsdom; real PDF rendering is covered by browser tests.
if (typeof globalThis.DOMMatrix === 'undefined') {
  class DOMMatrixMock {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;

    multiplySelf(): this { return this; }
    preMultiplySelf(): this { return this; }
    translateSelf(): this { return this; }
    scaleSelf(): this { return this; }
    rotateSelf(): this { return this; }
    invertSelf(): this { return this; }
  }

  Object.defineProperty(globalThis, 'DOMMatrix', {
    configurable: true,
    value: DOMMatrixMock,
    writable: true,
  });
}

// jsdom has no object URL registry. Preserve real implementations where present.
if (typeof URL.createObjectURL !== 'function') {
  let nextObjectUrl = 0;
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: () => `blob:leafspace-test-${++nextObjectUrl}`,
    writable: true,
  });
}
if (typeof URL.revokeObjectURL !== 'function') {
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: () => undefined,
    writable: true,
  });
}
