import { Field } from "../shared";
import type { Contest } from "@/lib/types";
import { Input } from "../ui/input";
import { ContestSettingsSection } from "./contest-settings-section";
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
    <div className="space-y-6">
      <ContestSettingsSection
        title="靶机开启次数"
        help="每队每题累计，创建失败不计次。可在赛题设置中单独调整；留空不限，0 禁止开启。"
      >
        <Field label="每队每题最多开启" className="max-w-sm">
          <Input
            type="number"
            name="container_starts_per_team"
            aria-label="比赛每队每题开启次数"
            min={0}
            max={10000}
            step={1}
            defaultValue={
              contest?.resource_limits?.container_starts_per_team ?? ""
            }
            placeholder="不限"
          />
        </Field>
      </ContestSettingsSection>
      <ContestSettingsSection
        title="同时使用上限"
        help="留空不另设限制，0 禁止新建；平台配额仍生效。排队、运行、待释放环境和已生成附件占名额。公共靶机仅计全场上限，不中断已有环境。"
      >
        <div className="min-w-0">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-1/4">资源</TableHead>
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
                          placeholder="不限"
                          className="min-w-0 w-full"
                        />
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </ContestSettingsSection>
    </div>
  );
}
