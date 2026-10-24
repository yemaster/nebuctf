// Readiness never runs inside the browser's snapshot callback.
export function settleOrAbort(work: Promise<unknown>, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => {
      signal.removeEventListener("abort", done);
      resolve();
    };
    if (signal.aborted) return done();
    signal.addEventListener("abort", done, { once: true });
    void work.then(done, done);
  });
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    if (signal.aborted) done();
    else signal.addEventListener("abort", done, { once: true });
  });
}

// Skip the spinner for near-ready content. Once visible, give its fade-in time
// to settle before handing over to the content; navigation can cancel either wait.
export async function waitForReveal(
  animation: Promise<unknown>,
  content: Promise<unknown>,
  signal: AbortSignal,
  showLoading: () => void,
) {
  let ready = false;
  const settled = content.then(
    () => {
      ready = true;
    },
    () => {
      ready = true;
    },
  );
  await settleOrAbort(animation, signal);
  if (signal.aborted || ready) return;
  let shownAt: number | undefined;
  const timer = setTimeout(() => {
    if (ready || signal.aborted) return;
    shownAt = Date.now();
    showLoading();
  }, 120);
  await settleOrAbort(settled, signal);
  clearTimeout(timer);
  if (shownAt !== undefined && !signal.aborted)
    await delay(Math.max(0, 240 - (Date.now() - shownAt)), signal);
}

export function waitForDetail(path: string, signal: AbortSignal) {
  const ready = () =>
    Array.from(document.querySelectorAll("[data-card-detail]")).some(
      (node) => node.getAttribute("data-card-detail") === path,
    );
  if (signal.aborted || ready()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      observer.disconnect();
      clearTimeout(timeout);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const observer = new MutationObserver(() => {
      if (ready()) done();
    });
    const timeout = setTimeout(done, 1800);
    signal.addEventListener("abort", done, { once: true });
    observer.observe(document.getElementById("main") ?? document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-card-detail"],
    });
    if (ready()) done();
  });
}
