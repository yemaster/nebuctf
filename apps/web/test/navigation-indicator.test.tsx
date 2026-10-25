import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";

test("navigation indicator follows selection and resizing without remounting", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    pretendToBeVisual: true,
  });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const observers = new Set<() => void>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class {
      constructor(private callback: () => void) {}
      observe() {
        observers.add(this.callback);
      }
      disconnect() {
        observers.delete(this.callback);
      }
    },
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  }
  let hidden = false,
    offset = 0;
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    const item = this.dataset.item;
    const left = item ? 100 + Number(item) * 100 + offset : 100;
    return new dom.window.DOMRect(left, 0, hidden ? 0 : item ? 80 : 400, 44);
  };
  const { createRoot } = await import("react-dom/client");
  const { NavigationIndicator } =
    await import("../src/components/navigation-indicator");
  const root = createRoot(document.getElementById("root")!);
  async function render(active: number | null, count = 2) {
    await act(async () => {
      root.render(
        <nav>
          {Array.from({ length: count }, (_, index) => (
            <a
              key={index}
              href={`/${index}`}
              data-item={index}
              data-nav-active={active === index || undefined}
              aria-current={active === index ? "page" : undefined}
            >
              {index}
            </a>
          ))}
          <NavigationIndicator activeKey={`${active}:${count}`} />
        </nav>,
      );
    });
  }
  const resize = () => act(async () => observers.forEach((update) => update()));
  try {
    await render(0);
    const marker = document.querySelector<HTMLElement>(
      '[data-slot="navigation-indicator"]',
    )!;
    assert.equal(marker.style.transform, "translateX(40px)");
    assert.equal(marker.style.opacity, "1", "initial selection is visible");
    assert.equal(marker.getAttribute("aria-hidden"), "true");
    await render(1);
    assert.equal(
      document.querySelector('[data-slot="navigation-indicator"]'),
      marker,
    );
    assert.equal(marker.style.transform, "translateX(140px)");
    offset = 30;
    await resize();
    assert.equal(marker.style.transform, "translateX(170px)");
    hidden = true;
    await resize();
    assert.equal(marker.style.opacity, "0");
    hidden = false;
    await resize();
    assert.equal(marker.style.opacity, "1");
    await render(null);
    assert.equal(marker.style.opacity, "0", "no stale selected item");
    await render(2, 3);
    assert.equal(marker.style.transform, "translateX(270px)");
    assert.equal(
      marker.style.opacity,
      "1",
      "late menu entries can be selected",
    );
  } finally {
    await act(async () => root.unmount());
    assert.equal(observers.size, 0, "resize observers are cleaned up");
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
  }
});
