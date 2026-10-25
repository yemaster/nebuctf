import type { Contest } from "@/lib/types";
import { Input } from "../ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

export function ContestResourceSettings({
  contest,
}: {
  contest: Contest | null;
}) {
  return (
    <section className="max-w-3xl space-y-4" aria-label="资源数量限制">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>资源</TableHead>
            <TableHead>每队上限</TableHead>
            <TableHead>全场上限</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[
            ["containers", "靶机"],
            ["attachments", "动态附件"],
          ].map(([key, label]) => (
            <TableRow key={key}>
              <TableCell className="font-medium">{label}</TableCell>
              {["per_team", "total"].map((scope) => {
                const name = `${key}_${scope}` as keyof NonNullable<
                  Contest["resource_limits"]
                >;
                return (
                  <TableCell key={scope}>
                    <Input
                      type="number"
                      min={0}
                      max={10000}
                      step={1}
                      name={name}
                      aria-label={`${label}${scope === "per_team" ? "每队" : "全场"}上限`}
                      defaultValue={contest?.resource_limits?.[name] ?? ""}
                      placeholder="不另设限制"
                      className="max-w-52"
                    />
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-sm text-muted-foreground">
        留空不另设限制，0 禁止新建。平台资源配额仍生效。
      </p>
      <p className="text-xs text-muted-foreground">
        排队中、运行中、待释放的资源及已生成的动态附件均占名额。公共靶机仅计入全场上限，调整不会中断已有环境。
      </p>
    </section>
  );
}
