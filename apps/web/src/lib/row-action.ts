import type { MouseEvent } from "react";

// Keep native buttons/links as keyboard targets and let the rest of the row activate them.
export function activateFromRow(
  event: MouseEvent<HTMLElement>,
  activate: () => void,
) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    !(event.target instanceof Element) ||
    event.target.closest(
      'a, button, input, select, textarea, label, summary, [contenteditable="true"], [role="button"], [role="checkbox"], [role="switch"], [data-row-action="ignore"]',
    ) ||
    event.currentTarget.ownerDocument.getSelection()?.isCollapsed === false
  )
    return;
  activate();
}
