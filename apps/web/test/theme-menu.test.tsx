import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";

test("menus open on activation and themes persist, sync and follow the system", async () => {
  const dom = new JSDOM(
    '<!doctype html><head><meta name="theme-color"></head><body><div id="root"></div></body>',
    {
      url: "http://localhost/",
      pretendToBeVisual: true,
      runScripts: "outside-only",
    },
  );
  const media = Object.assign(new dom.window.EventTarget(), { matches: false });
  (dom.window as any).matchMedia = () => media;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const globals = {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    CustomEvent: dom.window.CustomEvent,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [key, value] of Object.entries(globals)) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  }
  const { createRoot } = await import("react-dom/client");
  const { MemoryRouter } = await import("react-router-dom");
  const { QueryClient, QueryClientProvider } =
    await import("@tanstack/react-query");
  const { SiteHeader } = await import("../src/components/site-shell");
  const { ThemeProvider } = await import("../src/components/theme-provider");
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const root = createRoot(document.getElementById("root")!);
  const trigger = (name: string) =>
    document.querySelector(`button[aria-label="${name}"]`)!;
  const press = async (element: Element) =>
    act(async () => {
      element.dispatchEvent(
        new dom.window.MouseEvent("pointerdown", {
          bubbles: true,
          button: 0,
          cancelable: true,
        }),
      );
    });
  const close = async () =>
    act(async () => {
      document.activeElement?.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
        }),
      );
    });
  async function chooseTheme(label: string) {
    await press(trigger("切换主题"));
    const option = Array.from(
      document.querySelectorAll('[role="menuitemradio"]'),
    ).find((el) => el.textContent?.includes(label));
    assert.ok(option);
    await act(async () => {
      option.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
  }
  try {
    const init = await readFile(
      new URL("../public/theme.js", import.meta.url),
      "utf8",
    );
    localStorage.setItem("nebuctf-theme", "dark");
    dom.window.eval(init);
    assert.equal(
      document.documentElement.classList.contains("dark"),
      true,
      "pre-paint stored preference",
    );
    await act(async () => {
      root.render(
        <QueryClientProvider client={cache}>
          <MemoryRouter>
            <ThemeProvider>
              <SiteHeader
                user={{
                  id: "u",
                  username: "tester",
                  email: "test@example.com",
                  role: "user",
                }}
                onLogout={() => {}}
                loggingOut={false}
              />
            </ThemeProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    const learning = trigger("学习菜单");
    await act(async () => {
      learning.dispatchEvent(
        new dom.window.MouseEvent("pointermove", { bubbles: true }),
      );
      learning.dispatchEvent(
        new dom.window.MouseEvent("mouseover", { bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 220));
    });
    assert.equal(
      document.querySelector('[role="menu"]'),
      null,
      "hover never opens a menu",
    );
    await press(learning);
    assert.ok(document.querySelector('[role="menu"]'));
    const menuClass = document.querySelector('[role="menu"]')!.className;
    await press(learning);
    assert.equal(
      document.querySelector('[role="menu"]'),
      null,
      "second activation closes",
    );
    await press(trigger("账户菜单"));
    assert.equal(
      document.querySelector('[role="menu"]')!.className,
      menuClass,
      "learning and account share the same menu styling",
    );
    await close();
    await chooseTheme("亮色");
    assert.equal(document.documentElement.classList.contains("dark"), false);
    assert.equal(localStorage.getItem("nebuctf-theme"), "light");
    assert.equal(
      document
        .querySelector('meta[name="theme-color"]')
        ?.getAttribute("content"),
      "#f6f7f8",
    );
    await chooseTheme("暗色");
    assert.equal(document.documentElement.classList.contains("dark"), true);
    assert.equal(localStorage.getItem("nebuctf-theme"), "dark");
    await chooseTheme("跟随系统");
    assert.equal(document.documentElement.classList.contains("dark"), false);
    await act(async () => {
      media.matches = true;
      media.dispatchEvent(new dom.window.Event("change"));
    });
    assert.equal(document.documentElement.classList.contains("dark"), true);
    await act(async () => {
      window.dispatchEvent(
        new dom.window.StorageEvent("storage", {
          key: "nebuctf-theme",
          newValue: "light",
        }),
      );
    });
    assert.equal(document.documentElement.classList.contains("dark"), false);
  } finally {
    await act(async () => root.unmount());
    cache.clear();
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
  }
});
