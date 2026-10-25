import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";
import { themeColors } from "../src/lib/theme-settings";

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
  const close = async () => {
    const opener = document.querySelector('button[aria-expanded="true"]');
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
        }),
      );
    });
    // Radix restores focus after its portal cleanup. Finish that restoration
    // before activating a second overlay, as a real pointer interaction would.
    for (let i = 0; i < 40 && document.activeElement !== opener; i++)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    assert.equal(document.activeElement, opener);
  };
  const click = async (element: Element) => {
    await act(async () => {
      element.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
  };
  async function choose(label: string) {
    if (!document.querySelector('[role="dialog"][aria-label="主题设置"]'))
      await click(trigger("主题设置"));
    const option = document.querySelector(
      `[role="radio"][aria-label="${label}"]`,
    );
    assert.ok(option);
    await click(option);
    assert.equal(option.getAttribute("aria-checked"), "true");
    assert.ok(
      document.querySelector('[role="dialog"]'),
      "selection keeps both settings available",
    );
  }
  try {
    const init = await readFile(
      new URL("../public/theme.js", import.meta.url),
      "utf8",
    );
    for (const palette of themeColors) {
      localStorage.setItem("nebuctf-color", palette.value);
      dom.window.eval(init);
      assert.equal(
        document.documentElement.dataset.themeColor,
        palette.value,
        "all palettes apply before paint",
      );
    }
    localStorage.setItem("nebuctf-color", "invalid");
    dom.window.eval(init);
    assert.equal(document.documentElement.dataset.themeColor, "mint");
    localStorage.setItem("nebuctf-theme", "dark");
    localStorage.setItem("nebuctf-color", "ocean");
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
    assert.equal(document.documentElement.dataset.themeColor, "ocean");
    await choose("亮色");
    assert.equal(document.documentElement.classList.contains("dark"), false);
    assert.equal(localStorage.getItem("nebuctf-theme"), "light");
    assert.equal(
      document
        .querySelector('meta[name="theme-color"]')
        ?.getAttribute("content"),
      "#f6f7f8",
    );
    await choose("冰川蓝");
    assert.equal(document.documentElement.dataset.themeColor, "glacier");
    assert.equal(localStorage.getItem("nebuctf-color"), "glacier");
    await choose("冰川蓝");
    assert.equal(
      document.querySelectorAll('[aria-label="主题色"] [aria-checked="true"]')
        .length,
      1,
      "clicking the selected color never clears it",
    );
    await choose("暗色");
    assert.equal(document.documentElement.classList.contains("dark"), true);
    assert.equal(localStorage.getItem("nebuctf-theme"), "dark");
    assert.equal(
      document.documentElement.dataset.themeColor,
      "glacier",
      "appearance does not reset accent",
    );
    await choose("跟随系统");
    assert.equal(document.documentElement.classList.contains("dark"), false);
    await act(async () => {
      window.dispatchEvent(
        new dom.window.StorageEvent("storage", {
          key: "nebuctf-color",
          newValue: "lime",
        }),
      );
    });
    assert.equal(document.documentElement.dataset.themeColor, "lime");
    assert.equal(
      document
        .querySelector('[aria-label="青柠绿"]')
        ?.getAttribute("aria-checked"),
      "true",
    );
    const setItem = dom.window.Storage.prototype.setItem;
    dom.window.Storage.prototype.setItem = () => {
      throw new Error("storage unavailable");
    };
    try {
      await choose("薄荷青");
      await choose("暗色");
      assert.equal(document.documentElement.dataset.themeColor, "mint");
      assert.equal(document.documentElement.classList.contains("dark"), true);
    } finally {
      dom.window.Storage.prototype.setItem = setItem;
    }
    await close();
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(
      document.activeElement,
      trigger("主题设置"),
      "Escape restores trigger focus",
    );
    await act(async () => {
      window.dispatchEvent(
        new dom.window.StorageEvent("storage", { key: null }),
      );
    });
    assert.equal(document.documentElement.dataset.themeColor, "mint");
    assert.equal(
      document.documentElement.classList.contains("dark"),
      false,
      "clearing storage resumes system appearance",
    );

    await act(async () => {
      root.render(
        <QueryClientProvider client={cache}>
          <MemoryRouter
            key="guest"
            initialEntries={["/login?next=/challenges"]}
          >
            <ThemeProvider>
              <SiteHeader user={null} onLogout={() => {}} loggingOut={false} />
            </ThemeProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    const login = document.querySelector('a[href="/login"]')!;
    const register = document.querySelector('a[href="/register"]')!;
    assert.equal(login.getAttribute("aria-current"), "page");
    assert.equal(register.hasAttribute("aria-current"), false);
    await click(register);
    assert.equal(login.hasAttribute("aria-current"), false);
    assert.equal(register.getAttribute("aria-current"), "page");
    await click(document.querySelector('a[href="/challenges"]')!);
    assert.equal(login.hasAttribute("aria-current"), false);
    assert.equal(register.hasAttribute("aria-current"), false);
    assert.equal(
      document.querySelector('[aria-label="主导航"] [aria-current="page"]')
        ?.textContent,
      "练习",
    );
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

test("accent palettes keep primary text and buttons readable in both appearances", async () => {
  const css = await readFile(
    new URL("../src/index.css", import.meta.url),
    "utf8",
  );
  const blocks = new Map(
    Array.from(
      css.matchAll(/(:root[^{}]*)\{([^{}]*)\}/g),
      ([, selector, body]) => [
        selector.trim(),
        Object.fromEntries(
          Array.from(
            body.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/g),
            ([, key, value]) => [key, value],
          ),
        ),
      ],
    ),
  );
  const luminance = (hex: string) => {
    const channels = hex
      .slice(1)
      .match(/../g)!
      .map((value) => {
        const channel = parseInt(value, 16) / 255;
        return channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4;
      });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const contrast = (a: string, b: string) => {
    const x = luminance(a),
      y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  for (const palette of themeColors)
    for (const dark of [false, true]) {
      const selector = dark ? ":root.dark" : ":root";
      const tokens = {
        ...blocks.get(":root"),
        ...blocks.get(selector),
        ...blocks.get(`${selector}[data-theme-color="${palette.value}"]`),
      };
      for (const [a, b] of [
        ["primary", "primary-foreground"],
        ["primary", "card"],
        ["primary", "background"],
        ["foreground", "accent"],
      ])
        assert.ok(
          contrast(tokens[a], tokens[b]) >= 4.5,
          `${palette.value} ${dark ? "dark" : "light"}: ${a}/${b}`,
        );
    }
});
