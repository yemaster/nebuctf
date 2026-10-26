import type { ReactNode } from "react";
import { Card, CardContent } from "../ui/card";

export function ConfigCard({ children }: { children: ReactNode }) {
  return (
    <Card className="w-full min-w-0 border-0">
      <CardContent>{children}</CardContent>
    </Card>
  );
}
