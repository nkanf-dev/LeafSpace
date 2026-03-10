// @ts-nocheck

import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';

if (typeof globalThis.DOMMatrix === 'undefined') {
	class DOMMatrixMock {
		a = 1;
		b = 0;
		c = 0;
		d = 1;
		e = 0;
		f = 0;

		multiplySelf(): this {
			return this;
		}

		preMultiplySelf(): this {
			return this;
		}

		translateSelf(): this {
			return this;
		}

		scaleSelf(): this {
			return this;
		}

		rotateSelf(): this {
			return this;
		}

		invertSelf(): this {
			return this;
		}
	}

	// @ts-expect-error test-only polyfill
	globalThis.DOMMatrix = DOMMatrixMock;
}
