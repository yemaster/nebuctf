import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";

test("contest navigation handles shared snapshots, fallbacks and unregistered deep links", async (t) => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  let reduced = false,
    desktop = true;
  Object.assign(dom.window, {
    matchMedia: (query: string) => ({
      matches: query.includes("min-width") ? desktop : reduced,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    }),
  });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    SVGElement: dom.window.SVGElement,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  const { createRoot } = await import("react-dom/client");
  const { QueryClient, QueryClientProvider } =
    await import("@tanstack/react-query");
  const { MemoryRouter } = await import("react-router-dom");
  const { App } = await import("../src/App");
  const { loadContestPages } =
    await import("../src/components/card-transition");
  await loadContestPages();
  const id = "20000000-0000-4000-8000-000000000001",
    path = `/contests/${id}`;
  const contest = {
    id,
    title: "测试赛事",
    description: "比赛规则",
    starts_at: new Date(Date.now() - 60000).toISOString(),
    ends_at: new Date(Date.now() + 60000).toISOString(),
    registered: false,
    registration: null,
    groups: [],
    teams: 0,
    team_limit: 4,
  };
  const container = document.getElementById("root")!;
  let root: ReturnType<typeof createRoot>;
  let cache: InstanceType<typeof QueryClient>;
  async function mount(route: string) {
    cache = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      },
    });
    cache.setQueryData(["/me"], {
      user: { id: "user", username: "选手", role: "user" },
    });
    cache.setQueryData(["/contests?page=1"], { items: [contest], total: 1 });
    cache.setQueryData([path], contest);
    cache.setQueryData(["/teams/mine"], { items: [] });
    const challenge = {
      id,
      title: "测试练习题",
      description: "题目内容",
      category: "Web",
      difficulty: "入门",
      kind: "static_attachment",
      points: 100,
      solves: 0,
      solved: false,
      solved_parts: 0,
      total_parts: 1,
      hints: [],
      attachments: [],
      parts: [],
    };
    cache.setQueryData(
      ["/challenges?scope=practice&category=&q=&page=1&page_size=10"],
      {
        items: [challenge],
        total: 1,
      },
    );
    cache.setQueryData([`/challenges/${id}?scope=practice`], challenge);
    cache.setQueryData(["/announcements"], {
      items: [
        {
          id: "notice-1",
          title: "比赛通知",
          body: "公告正文与完整点击区域",
          created_at: new Date().toISOString(),
        },
      ],
    });
    cache.setQueryData(["/learning/trees"], {
      items: [{ id, title: "Web 技能树", nodes: 2 }],
    });
    cache.setQueryData([`/learning/trees/${id}`], {
      id,
      title: "Web 技能树",
      completed: 0,
      nodes: [],
    });
    cache.setQueryData(["/problemsets?page=1&q="], {
      items: [{ id, title: "入门题单", total: 2, completed: 0 }],
      total: 1,
    });
    cache.setQueryData([`/problemsets/${id}?page=1&page_size=10`], {
      id,
      title: "入门题单",
      total: 0,
      completed: 0,
      items: [],
    });
    cache.setQueryData(["/articles/categories"], { items: [] });
    cache.setQueryData(["/articles?kind=&category=&q=&page=1"], {
      items: [{ id, slug: "intro", title: "入门教程", kind: "tutorial" }],
      total: 1,
    });
    cache.setQueryData(["/site"], {
      name: "NebuCTF",
      footer_text: "",
      footer_link_label: "",
      footer_link_url: "",
      email_verification: false,
    });
    cache.setQueryData(["/articles/intro"], {
      id,
      slug: "intro",
      title: "入门教程",
      body: "教程正文",
      kind: "tutorial",
    });
    root = createRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={cache}>
          <MemoryRouter initialEntries={[route]}>
            <App />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
  }
  async function clickCard() {
    const card = container.querySelector(
      `a[href="${path}"][aria-busy], a[href="${path}"].group`,
    )!;
    assert.ok(card);
    await act(async () => {
      card.dispatchEvent(
        new dom.window.MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
    });
  }
  async function settle(predicate: () => boolean) {
    for (let i = 0; i < 80 && !predicate(); i++)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
      });
    assert.ok(predicate(), "navigation settled");
  }
  async function cleanup() {
    await act(async () => root.unmount());
    cache.clear();
    // Query observers batch notifications on the next task, even after unmount.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  try {
    await t.test(
      "native card snapshot expands into a single full-page surface",
      async () => {
        let snapshots = 0,
          finished = false;
        let snapshotError: unknown;
        (document as any).startViewTransition = (
          update: () => Promise<void>,
        ) => {
          const old = container.querySelectorAll("[data-card-surface]");
          assert.equal(old.length, 1);
          assert.equal(old[0]!.tagName, "A");
          const ready = Promise.resolve()
            .then(update)
            .then(() => {
              const next = container.querySelectorAll("[data-card-surface]");
              assert.equal(next.length, 1);
              assert.equal(next[0]!.tagName, "DIV");
              // The opaque shell is enough; lazy content need not be mounted yet.
              assert.equal(
                container
                  .querySelector('[data-card-content="waiting"]')
                  ?.getAttribute("aria-hidden"),
                "true",
              );
              assert.ok(
                container
                  .querySelector('[data-card-content="waiting"]')
                  ?.hasAttribute("inert"),
              );
              assert.equal(
                (
                  container.querySelector(
                    '[data-card-content="waiting"]',
                  ) as HTMLElement
                ).style.visibility,
                "hidden",
              );
              snapshots++;
              finished = true;
            })
            .catch((error) => {
              snapshotError = error;
              finished = true;
              throw error;
            });
          return { ready, finished: ready, skipTransition() {} };
        };
        await mount("/contests");
        await clickCard();
        await settle(() => finished);
        if (snapshotError) {
          await cleanup();
          assert.ifError(snapshotError);
        }
        assert.equal(snapshots, 1);
        await settle(() => !container.querySelector("[data-card-surface]"));
        await cleanup();
      },
    );
    await t.test(
      "cold detail requests expand immediately and wait on the expanded surface",
      async () => {
        const previousFetch = globalThis.fetch;
        try {
          for (const [list, detail, query] of [
            ["/contests", path, path],
            ["/learning", `/learning/${id}`, `/learning/trees/${id}`],
            [
              "/problemsets",
              `/problemsets/${id}`,
              `/problemsets/${id}?page=1&page_size=10`,
            ],
            ["/library", "/library/intro", "/articles/intro"],
          ]) {
            await mount(list!);
            const payload = cache.getQueryData([query!]);
            cache.removeQueries({ queryKey: [query!] });
            let release!: (value: Response) => void,
              finish!: () => void,
              snapshots = 0;
            globalThis.fetch = (async (url: string) =>
              url === `/api${query}`
                ? new Promise<Response>((resolve) => {
                    release = resolve;
                  })
                : Response.json({ items: [], days: [] })) as typeof fetch;
            (document as any).startViewTransition = (update: () => unknown) => {
              snapshots++;
              assert.equal(
                container.querySelector("[data-card-surface]")?.tagName,
                "A",
              );
              const ready = Promise.resolve().then(() => {
                assert.equal(
                  update(),
                  undefined,
                  "snapshot callback never awaits data or a lazy route",
                );
                assert.equal(
                  container.querySelectorAll("[data-card-surface]").length,
                  1,
                );
                assert.equal(
                  container.querySelector("[data-card-surface]")?.tagName,
                  "DIV",
                );
              });
              return {
                ready,
                finished: new Promise<void>((resolve) => {
                  finish = resolve;
                }),
                skipTransition() {
                  finish();
                },
              };
            };
            await act(async () =>
              container.querySelector(`a[href="${detail}"]`)!.dispatchEvent(
                new dom.window.MouseEvent("click", {
                  bubbles: true,
                  cancelable: true,
                }),
              ),
            );
            assert.equal(
              snapshots,
              1,
              "start in the click event, before the request resolves",
            );
            await settle(() => !!release);
            assert.equal(
              !!container.querySelector('[data-card-surface] [role="status"]'),
              false,
            );
            await act(async () => finish());
            assert.ok(container.querySelector('[data-card-content="waiting"]'));
            await settle(
              () =>
                !!container.querySelector(
                  '[data-card-surface] [role="status"]',
                ),
            );
            assert.ok(
              container
                .querySelector('[data-card-content="waiting"]')!
                .hasAttribute("inert"),
            );
            await act(async () => release(Response.json(payload)));
            await settle(
              () => !container.querySelector('[data-card-content="waiting"]'),
            );
            assert.ok(
              container.querySelector(`[data-card-detail="${detail}"]`),
            );
            const leaving = container.querySelector(
              '[data-loading-surface="leaving"]',
            );
            assert.ok(
              leaving,
              "keep the loading layer mounted during the crossfade",
            );
            assert.equal(leaving.getAttribute("aria-hidden"), "true");
            assert.equal(leaving.hasAttribute("data-card-surface"), false);
            await settle(
              () => !container.querySelector("[data-loading-surface]"),
            );
            await cleanup();
          }
        } finally {
          globalThis.fetch = previousFetch;
        }
      },
    );
    await t.test(
      "returning to the lobby uses ordinary navigation without a shrinking snapshot",
      async () => {
        await mount(path);
        await settle(
          () => !!container.querySelector(`[data-card-detail="${path}"]`),
        );
        let calls = 0;
        (document as any).startViewTransition = () => {
          calls++;
          throw Error("must not shrink");
        };
        await act(async () =>
          container.querySelector('header a[href="/contests"]')!.dispatchEvent(
            new dom.window.MouseEvent("click", {
              bubbles: true,
              cancelable: true,
            }),
          ),
        );
        await settle(
          () => !!container.querySelector('[data-card-detail="/contests"]'),
        );
        assert.equal(calls, 0);
        assert.equal(container.querySelector("[data-card-surface]"), null);
        await cleanup();
      },
    );
    await t.test(
      "loading failures and leaving an expanded page release the waiting surface",
      async () => {
        const previousFetch = globalThis.fetch;
        try {
          for (const failure of [true, false]) {
            await mount("/contests");
            cache.removeQueries({ queryKey: [path] });
            let release!: (value: Response) => void, finish!: () => void;
            globalThis.fetch = (async (url: string) =>
              url === `/api${path}`
                ? new Promise<Response>((resolve) => {
                    release = resolve;
                  })
                : Response.json({ items: [], days: [] })) as typeof fetch;
            (document as any).startViewTransition = (update: () => unknown) => {
              const ready = Promise.resolve().then(update);
              const finished = new Promise<void>((resolve) => {
                finish = resolve;
              });
              return {
                ready,
                finished,
                skipTransition() {
                  finish();
                },
              };
            };
            await clickCard();
            await settle(() => !!release);
            await act(async () => finish());
            await settle(
              () =>
                !!container.querySelector(
                  '[data-card-surface] [role="status"]',
                ),
            );
            if (failure) {
              await act(async () =>
                release(
                  Response.json({ error: "详情加载失败" }, { status: 503 }),
                ),
              );
              await settle(
                () => !container.querySelector("[data-card-surface]"),
              );
              assert.match(container.textContent!, /详情加载失败/);
            } else {
              await act(async () =>
                container
                  .querySelector('header a[href="/contests"]')!
                  .dispatchEvent(
                    new dom.window.MouseEvent("click", {
                      bubbles: true,
                      cancelable: true,
                    }),
                  ),
              );
              await settle(
                () =>
                  !!container.querySelector('[data-card-detail="/contests"]') &&
                  !container.querySelector(`[data-card-detail="${path}"]`),
              );
              await act(async () => release(Response.json(contest)));
              assert.ok(
                container.querySelector('[data-card-detail="/contests"]'),
              );
              assert.equal(
                !!container.querySelector(`[data-card-detail="${path}"]`),
                false,
              );
            }
            await cleanup();
          }
        } finally {
          globalThis.fetch = previousFetch;
        }
      },
    );
    await t.test(
      "unsupported browsers keep normal navigation working",
      async () => {
        delete (document as any).startViewTransition;
        await mount("/contests");
        await clickCard();
        await settle(() => !!container.querySelector("[data-card-detail]"));
        await cleanup();
      },
    );
    await t.test(
      "skill trees, problemsets and articles reveal only after their card has expanded",
      async () => {
        for (const [list, detail] of [
          ["/learning", `/learning/${id}`],
          ["/problemsets", `/problemsets/${id}`],
          ["/library", "/library/intro"],
        ]) {
          let snapshot = false,
            finish!: () => void;
          (document as any).startViewTransition = (
            update: () => Promise<void>,
          ) => {
            assert.equal(
              container.querySelector("[data-card-surface]")?.tagName,
              "A",
            );
            const ready = Promise.resolve()
              .then(update)
              .then(() => {
                snapshot = true;
              });
            return {
              ready,
              finished: new Promise<void>((resolve) => {
                finish = resolve;
              }),
              skipTransition() {
                finish();
              },
            };
          };
          await mount(list!);
          await act(async () => {
            container.querySelector(`a[href="${detail}"]`)!.dispatchEvent(
              new dom.window.MouseEvent("click", {
                bubbles: true,
                cancelable: true,
              }),
            );
          });
          await settle(() => snapshot);
          assert.ok(
            container
              .querySelector('[data-card-content="waiting"]')
              ?.hasAttribute("inert"),
          );
          await settle(
            () => !!container.querySelector(`[data-card-detail="${detail}"]`),
          );
          await act(async () => {
            finish();
          });
          await settle(
            () => !container.querySelector('[data-card-content="waiting"]'),
          );
          assert.equal(
            container
              .querySelector("[data-card-content]")
              ?.hasAttribute("inert"),
            false,
          );
          await cleanup();
        }
      },
    );
    await t.test(
      "the practice list contracts into the sidebar before the workspace is revealed",
      async () => {
        await mount("/challenges");
        const query = `/challenges/${id}?scope=practice`,
          payload = cache.getQueryData([query]);
        cache.removeQueries({ queryKey: [query] });
        const previousFetch = globalThis.fetch;
        let release!: (response: Response) => void,
          finish!: () => void,
          captured = false;
        globalThis.fetch = (async (url: string) =>
          url === `/api${query}`
            ? new Promise<Response>((resolve) => {
                release = resolve;
              })
            : Response.json({ items: [] })) as typeof fetch;
        (document as any).startViewTransition = (update: () => unknown) => {
          assert.equal(
            container.querySelector<HTMLElement>("[data-practice-list]")!.style
              .viewTransitionName,
            "practice-directory",
          );
          const ready = Promise.resolve().then(() => {
            assert.equal(update(), undefined);
            assert.equal(
              container.querySelector<HTMLElement>(
                'aside[aria-label="题目目录"]',
              )!.style.viewTransitionName,
              "practice-directory",
            );
            assert.ok(
              !container
                .querySelector('aside[aria-label="题目目录"]')!
                .parentElement!.classList.contains("hidden"),
            );
            captured = true;
          });
          return {
            ready,
            finished: new Promise<void>((resolve) => {
              finish = resolve;
            }),
            skipTransition() {
              finish();
            },
          };
        };
        try {
          await act(async () =>
            container
              .querySelector(`a[href*="challenge=${id}"]`)!
              .dispatchEvent(
                new dom.window.MouseEvent("click", {
                  bubbles: true,
                  cancelable: true,
                }),
              ),
          );
          await settle(() => captured && !!release);
          assert.ok(
            container.querySelector('[data-practice-content="waiting"]'),
          );
          await act(async () => finish());
          assert.ok(
            container.querySelector('[data-practice-content="waiting"]'),
          );
          await settle(
            () =>
              !!container.querySelector(
                '[data-loading-surface="waiting"] [role="status"]',
              ),
          );
          await act(async () => release(Response.json(payload)));
          await settle(
            () =>
              !!container.querySelector('[data-practice-content="visible"]'),
          );
          assert.ok(
            container.querySelector(`[data-card-detail="practice:${id}"]`),
          );
          await act(async () =>
            [...container.querySelectorAll("button")]
              .find((b) => b.textContent === "返回题库")!
              .click(),
          );
          await settle(() => !!container.querySelector("[data-practice-list]"));
        } finally {
          globalThis.fetch = previousFetch;
          await cleanup();
        }
      },
    );
    await t.test(
      "leaving a slow practice question cancels its waiting surface",
      async () => {
        await mount("/challenges");
        const query = `/challenges/${id}?scope=practice`,
          payload = cache.getQueryData([query]);
        cache.removeQueries({ queryKey: [query] });
        const previousFetch = globalThis.fetch;
        let release!: (response: Response) => void,
          finish!: () => void,
          skipped = false;
        globalThis.fetch = (async (url: string) =>
          url === `/api${query}`
            ? new Promise<Response>((resolve) => {
                release = resolve;
              })
            : Response.json({ items: [] })) as typeof fetch;
        (document as any).startViewTransition = (update: () => unknown) => ({
          ready: Promise.resolve().then(update),
          finished: new Promise<void>((resolve) => {
            finish = resolve;
          }),
          skipTransition() {
            skipped = true;
            finish();
          },
        });
        try {
          await act(async () =>
            container
              .querySelector(`a[href*="challenge=${id}"]`)!
              .dispatchEvent(
                new dom.window.MouseEvent("click", {
                  bubbles: true,
                  cancelable: true,
                }),
              ),
          );
          await settle(() => !!release);
          await act(async () => finish());
          assert.ok(
            container.querySelector('[data-practice-content="waiting"]'),
          );
          await act(async () =>
            [...container.querySelectorAll("button")]
              .find((b) => b.textContent === "返回题库")!
              .click(),
          );
          await settle(() => !!container.querySelector("[data-practice-list]"));
          assert.equal(skipped, true);
          assert.equal(
            container.querySelector('[data-practice-content="waiting"]'),
            null,
          );
          await act(async () => release(Response.json(payload)));
          assert.ok(container.querySelector("[data-practice-list]"));
        } finally {
          globalThis.fetch = previousFetch;
          await cleanup();
        }
      },
    );
    await t.test(
      "returning from a question expands the directory back into the catalog",
      async () => {
        await mount(`/challenges?challenge=${id}`);
        await settle(
          () =>
            !!container.querySelector(`[data-card-detail="practice:${id}"]`),
        );
        let finish!: () => void,
          captured = false;
        (document as any).startViewTransition = (update: () => unknown) => {
          assert.equal(
            container.querySelector<HTMLElement>(
              'aside[aria-label="题目目录"]',
            )!.style.viewTransitionName,
            "practice-directory",
          );
          const ready = Promise.resolve().then(() => {
            assert.equal(update(), undefined);
            assert.equal(
              container.querySelector<HTMLElement>("[data-practice-list]")!
                .style.viewTransitionName,
              "practice-directory",
            );
            assert.equal(
              container.querySelector<HTMLElement>(
                'aside[aria-label="题目目录"]',
              )!.style.viewTransitionName,
              "",
            );
            captured = true;
          });
          return {
            ready,
            finished: new Promise<void>((resolve) => {
              finish = resolve;
            }),
            skipTransition() {
              finish();
            },
          };
        };
        await act(async () =>
          [...container.querySelectorAll("button")]
            .find((b) => b.textContent === "返回题库")!
            .click(),
        );
        await settle(() => captured);
        assert.ok(container.querySelector(`a[href*="challenge=${id}"]`));
        await act(async () => finish());
        await settle(
          () =>
            container.querySelector<HTMLElement>("[data-practice-list]")!.style
              .viewTransitionName === "",
        );
        await cleanup();
      },
    );
    await t.test("reduced motion skips the expanding snapshot", async () => {
      reduced = true;
      let calls = 0;
      (document as any).startViewTransition = () => {
        calls++;
        throw Error("must not animate");
      };
      await mount("/contests");
      await clickCard();
      await settle(() => !!container.querySelector("[data-card-detail]"));
      assert.equal(calls, 0);
      await cleanup();
      reduced = false;
    });
    await t.test(
      "practice navigation stays direct on narrow screens or with reduced motion",
      async () => {
        let calls = 0;
        (document as any).startViewTransition = () => {
          calls++;
          throw Error("must not animate");
        };
        for (const narrow of [true, false]) {
          desktop = !narrow;
          reduced = !narrow;
          await mount("/challenges");
          await act(async () =>
            container
              .querySelector(`a[href*="challenge=${id}"]`)!
              .dispatchEvent(
                new dom.window.MouseEvent("click", {
                  bubbles: true,
                  cancelable: true,
                }),
              ),
          );
          await settle(
            () =>
              !!container.querySelector(`[data-card-detail="practice:${id}"]`),
          );
          assert.equal(calls, 0);
          assert.equal(
            !!container.querySelector('[data-practice-content="waiting"]'),
            false,
          );
          await cleanup();
        }
        desktop = true;
        reduced = false;
      },
    );
    await t.test(
      "home announcements make their body clickable and focus the matching notice",
      async () => {
        let scrolled = "";
        const previous = dom.window.HTMLElement.prototype.scrollIntoView;
        const previousFetch = globalThis.fetch;
        const unexpected: string[] = [];
        // Home also loads recent contests, the calendar and platform statistics.
        // Without these fixtures, a rejected relative-URL request can replace the
        // announcement list with the page error before the assertion runs.
        globalThis.fetch = (async (input: string) => {
          const url = new URL(input, "http://localhost");
          if (url.pathname === "/api/notifications/summary")
            return Response.json({ unread: 0, revision: null });
          if (url.pathname === "/api/contests/calendar")
            return Response.json({ days: [] });
          if (url.pathname === "/api/contests")
            return Response.json({ items: [contest], total: 1 });
          if (url.pathname === "/api/stats")
            return Response.json({
              challenges: 1,
              contests: 1,
              teams: 0,
              solves: 0,
              activity: [],
            });
          unexpected.push(input);
          throw Error(`Unexpected home request: ${input}`);
        }) as typeof fetch;
        dom.window.HTMLElement.prototype.scrollIntoView = function () {
          scrolled = this.id;
        };
        try {
          await mount("/");
          await settle(
            () =>
              cache.isFetching() === 0 &&
              !!container.querySelector(
                'a[href="/announcements#announcement-notice-1"]',
              ),
          );
          assert.deepEqual(unexpected, []);
          assert.equal(
            cache
              .getQueryCache()
              .findAll({ type: "active" })
              .some((query) => query.state.status === "error"),
            false,
          );
          const row = container.querySelector(
            'a[href="/announcements#announcement-notice-1"]',
          )!;
          assert.ok(row.querySelector("p")?.textContent?.includes("公告正文"));
          assert.ok(row.querySelector("time"));
          await act(async () => {
            row.querySelector("p")!.dispatchEvent(
              new dom.window.MouseEvent("click", {
                bubbles: true,
                cancelable: true,
              }),
            );
          });
          await settle(
            () => document.activeElement?.id === "announcement-notice-1",
          );
          assert.equal(scrolled, "announcement-notice-1");
        } finally {
          await cleanup();
          globalThis.fetch = previousFetch;
          dom.window.HTMLElement.prototype.scrollIntoView = previous;
        }
      },
    );
    await t.test(
      "a rejected native transition falls back to the destination",
      async () => {
        (document as any).startViewTransition = () => {
          throw Error("snapshot unavailable");
        };
        await mount("/contests");
        await clickCard();
        await settle(() => !!container.querySelector("[data-card-detail]"));
        assert.equal(container.querySelector("[data-card-surface]"), null);
        await cleanup();
      },
    );
    await t.test(
      "a slow card request cannot pull users back after they navigate away",
      async () => {
        const previousFetch = globalThis.fetch;
        let release!: (response: Response) => void;
        try {
          await mount("/contests");
          cache.removeQueries({ queryKey: [path] });
          cache.setQueryData(["/announcements"], { items: [] });
          globalThis.fetch = (async (url: string) =>
            url === `/api${path}`
              ? new Promise<Response>((resolve) => {
                  release = resolve;
                })
              : Response.json({ items: [], days: [] })) as typeof fetch;
          delete (document as any).startViewTransition;
          await clickCard();
          await settle(() => !!release);
          await act(async () => {
            container.querySelector('a[href="/contests"]')!.dispatchEvent(
              new dom.window.MouseEvent("click", {
                bubbles: true,
                cancelable: true,
              }),
            );
          });
          await settle(
            () =>
              !!container.querySelector(
                'a[href="/contests"][aria-current="page"]',
              ),
          );
          await act(async () => {
            release(Response.json(contest));
          });
          await settle(() => !container.querySelector('[aria-busy="true"]'));
          assert.equal(
            !!container.querySelector(`[data-card-detail="${path}"]`),
            false,
          );
          await cleanup();
        } finally {
          globalThis.fetch = previousFetch;
        }
      },
    );
    await t.test(
      "unregistered deep links return to overview without querying protected resources",
      async () => {
        for (const section of ["challenges", "instances"]) {
          await mount(`${path}/${section}`);
          await settle(() => !!container.querySelector("[data-card-detail]"));
          assert.ok(
            !cache
              .getQueryCache()
              .getAll()
              .some((q) =>
                String(q.queryKey[0]).startsWith(
                  section === "challenges"
                    ? `/challenges?scope=${id}`
                    : `/instances?scope=${id}`,
                ),
              ),
          );
          assert.ok(!container.textContent?.includes("暂无访问权限"));
          await cleanup();
        }
      },
    );
  } finally {
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
  }
});
