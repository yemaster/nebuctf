import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";

test("captcha characters shuffle together and settle only after verification", async (t) => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    pretendToBeVisual: true,
  });
  let reduced = false,
    hidden = false;
  const mediaListeners = new Set<() => void>();
  dom.window.matchMedia = (() => ({
    get matches() {
      return reduced;
    },
    addEventListener(_event: string, listener: () => void) {
      mediaListeners.add(listener);
    },
    removeEventListener(_event: string, listener: () => void) {
      mediaListeners.delete(listener);
    },
  })) as any;
  Object.defineProperty(dom.window.document, "hidden", { get: () => hidden });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  }
  const { createRoot } = await import("react-dom/client");
  const { CaptchaLabel } = await import("../src/components/captcha-label");
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  t.mock.timers.enable({ apis: ["setInterval"] });
  const render = (text: string, working = false, verified = false) =>
    act(async () =>
      root.render(
        <CaptchaLabel text={text} working={working} verified={verified} />,
      ),
    );
  const advance = (time: number) => act(async () => t.mock.timers.tick(time));
  const characters = () =>
    [...container.querySelectorAll("[data-state]")].map(
      (node) => node.textContent,
    );
  const fixed = () => container.querySelectorAll('[data-state="fixed"]').length;
  const visibleText = () =>
    container.querySelector('[aria-hidden="true"]')!.textContent;
  const visibility = (value: boolean) =>
    act(async () => {
      hidden = value;
      document.dispatchEvent(new dom.window.Event("visibilitychange"));
    });
  try {
    await render("正在验证", true);
    const initial = characters();
    assert.equal(initial.length, 4);
    assert.match(initial.join(""), /^[0-9A-F]{4}$/);
    await advance(60);
    assert.equal(
      characters().filter((value, index) => value !== initial[index]).length,
      4,
    );
    await advance(6000);
    assert.equal(fixed(), 0, "elapsed time cannot claim a successful proof");
    assert.equal(container.querySelector(".sr-only")!.textContent, "正在验证");

    await render("验证通过", false, true);
    assert.equal(
      container.querySelector(".sr-only")!.textContent,
      "验证通过",
      "accessible status updates immediately",
    );
    for (let count = 1; count <= 4; count++) {
      await advance(120);
      assert.equal(fixed(), count);
      assert.equal(
        characters().slice(0, count).join(""),
        "验证通过".slice(0, count),
      );
    }
    await advance(600);
    assert.equal(visibleText(), "验证通过");

    await render("正在验证", true);
    assert.equal(fixed(), 0, "a retry starts a fresh animation");
    await visibility(true);
    const paused = visibleText();
    await advance(600);
    assert.equal(visibleText(), paused);
    await visibility(false);
    await advance(60);
    assert.notEqual(visibleText(), paused);
    await render("验证通过", false, true);
    await advance(120);
    await render("重新验证");
    await advance(600);
    assert.equal(
      visibleText(),
      "重新验证",
      "failure cancels pending success characters",
    );

    await render("正在验证", true);
    await visibility(true);
    await render("验证通过", false, true);
    assert.equal(
      visibleText(),
      "验证通过",
      "hidden pages finish without replaying an animation",
    );
    await visibility(false);

    await act(async () => {
      reduced = true;
      mediaListeners.forEach((listener) => listener());
    });
    await render("正在验证", true);
    await advance(600);
    assert.equal(visibleText(), "正在验证");
    assert.equal(
      characters().length,
      0,
      "reduced motion uses plain status text",
    );
    await render("验证通过", false, true);
    assert.equal(visibleText(), "验证通过");
  } finally {
    await act(async () => root.unmount());
    assert.equal(
      mediaListeners.size,
      0,
      "motion preference listener is cleaned up",
    );
    t.mock.timers.reset();
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
  }
});
