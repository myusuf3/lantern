import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// React Flow measures nodes with browser APIs jsdom lacks. These shims follow the library's own
// testing guidance so the real components render in tests.
class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class DOMMatrixReadOnly {
  m22: number;
  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([1-9.]+)\)/)?.[1];
    this.m22 = scale === undefined ? 1 : Number(scale);
  }
}
Object.assign(globalThis, { ResizeObserver, DOMMatrixReadOnly });
Object.defineProperties(HTMLElement.prototype, {
  offsetHeight: { get: () => 100 },
  offsetWidth: { get: () => 100 },
});
Object.assign(SVGElement.prototype, { getBBox: () => ({ x: 0, y: 0, width: 0, height: 0 }) });
