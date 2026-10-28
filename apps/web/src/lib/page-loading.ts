import { createContext } from "react";

// A loading placeholder registers for its mounted lifetime. Keeping this
// separate lets both the page boundary and the shared placeholder use it.
export const PageLoadingContext = createContext<(() => () => void) | null>(
  null,
);
