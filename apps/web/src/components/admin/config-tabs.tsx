import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { TabsContent } from "../ui/tabs";
import { ConfigCard } from "./config-card";

export function useConfigSection(
  values: readonly string[],
  fallback: string,
  parameter = "section",
): [string, (value: string) => void] {
  const [params, setParams] = useSearchParams();
  const requested = params.get(parameter);
  const section =
    requested && values.includes(requested) ? requested : fallback;
  const setSection = (value: string) => {
    if (!values.includes(value)) return;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value === fallback) next.delete(parameter);
        else next.set(parameter, value);
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  };
  return [section, setSection];
}

export function ConfigPanel({
  value,
  active,
  children,
  unstyled = false,
}: {
  value: string;
  active: string;
  children: ReactNode;
  unstyled?: boolean;
}) {
  return (
    <TabsContent
      value={value}
      forceMount
      hidden={active !== value}
      data-config-tab={value}
      className="min-w-0 data-[state=inactive]:hidden"
    >
      {unstyled ? children : <ConfigCard>{children}</ConfigCard>}
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
