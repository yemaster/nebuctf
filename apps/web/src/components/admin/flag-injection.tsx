import type { PartDraft } from "../parts-editor";
import { Input } from "../ui/input";
import { Field } from "../shared";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

export function FlagInjection({
  parts,
  setParts,
  singleName,
  onSingleName,
  dynamic,
  awd = false,
}: {
  parts: PartDraft[];
  setParts: (parts: PartDraft[]) => void;
  singleName: string;
  onSingleName: (name: string) => void;
  dynamic: boolean;
  awd?: boolean;
}) {
  if (awd)
    return (
      <p className="text-sm text-muted-foreground">
        轮换 Flag 由服务读取 /run/nebuctf/flag。
      </p>
    );
  if (!dynamic)
    return (
      <p className="text-sm text-muted-foreground">
        静态 Flag 由镜像提供；按小题注入需使用动态 Flag。
      </p>
    );
  return (
    <section className="space-y-4" aria-label="Flag 环境变量注入">
      <div className="space-y-1">
        <h3 className="font-medium">Flag 注入</h3>
        <p className="text-sm text-muted-foreground">
          {parts.length
            ? "各小题共用一个容器，启动时分别注入。修改后保存生效。"
            : "容器启动时注入，修改后保存生效。"}
        </p>
      </div>
      {parts.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>小题</TableHead>
              <TableHead>环境变量</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {parts.map((part, index) => (
              <TableRow key={part.key}>
                <TableCell className="w-1/2 break-words">
                  {part.title || `小题 ${index + 1}`}
                </TableCell>
                <TableCell>
                  {part.role === "defense" ? (
                    <span className="text-sm text-muted-foreground">
                      补丁校验，不注入 Flag
                    </span>
                  ) : (
                    <Input
                      aria-label={`${part.title || `小题 ${index + 1}`}环境变量`}
                      value={part.flag_env ?? `FLAG_${index + 1}`}
                      required
                      maxLength={64}
                      pattern="[A-Z_][A-Z0-9_]{0,63}"
                      onChange={(e) =>
                        setParts(
                          parts.map((p) =>
                            p.key === part.key
                              ? { ...p, flag_env: e.target.value }
                              : p,
                          ),
                        )
                      }
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Field label="Flag 环境变量">
          <Input
            value={singleName}
            onChange={(e) => onSingleName(e.target.value)}
            required
            maxLength={64}
            pattern="[A-Z_][A-Z0-9_]{0,63}"
          />
        </Field>
      )}
    </section>
  );
}
