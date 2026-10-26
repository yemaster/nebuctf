import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { TabsContent } from "../ui/tabs";
import { ConfigCard } from "./config-card";

export function ConfigPanel({
  value,
  active,
  children,
}: {
  value: string;
  active: string;
  children: ReactNode;
}) {
  return (
    <TabsContent
      value={value}
      forceMount
      hidden={active !== value}
      data-config-tab={value}
      className="min-w-0 data-[state=inactive]:hidden"
    >
      <ConfigCard>{children}</ConfigCard>
    </TabsContent>
  );
}

export function focusInvalidField(
  form: HTMLFormElement,
  setSection: (value: string) => void,
) {
  const invalid = form.querySelector<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >("input:invalid, select:invalid, textarea:invalid");
  if (!invalid) return false;
  const destination =
    invalid.closest<HTMLElement>("[data-config-tab]")?.dataset.configTab;
  if (destination) flushSync(() => setSection(destination));
  invalid.focus();
  invalid.reportValidity();
  return true;
}
