export async function copyText(value: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const active = document.activeElement as HTMLElement | null;
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.cssText = "position:fixed;left:-9999px;top:0";
  document.body.append(input);
  input.select();
  try {
    if (!document.execCommand("copy")) throw Error("复制失败，请使用键盘复制");
  } finally {
    input.remove();
    active?.focus();
  }
}
