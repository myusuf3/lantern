import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// React Flow measures nodes with browser APIs jsdom lacks. These shims follow the library's own
// testing guidance so the real components render in tests.
type Entry = { target: Element; contentRect: { width: number; height: number } };
class ResizeObserver {
  constructor(private readonly callback: (entries: Entry[], observer: ResizeObserver) => void) {}
  /** Report a size straight away so React Flow treats nodes as measured and draws edges. */
  observe(target: Element) {
    queueMicrotask(() =>
      this.callback([{ target, contentRect: { width: 100, height: 100 } }], this),
    );
  }
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
// A box's height grows with its table rows, so layout tests can tell a tall box from a short one.
Object.defineProperties(HTMLElement.prototype, {
  offsetHeight: {
    get(this: HTMLElement) {
      return 100 + 20 * this.querySelectorAll("tr").length;
    },
  },
  offsetWidth: { get: () => 100 },
});
Object.assign(SVGElement.prototype, { getBBox: () => ({ x: 0, y: 0, width: 0, height: 0 }) });
