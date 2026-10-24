import { z } from "zod";

export const imageReference = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(
    /^(?:[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[0-9]+)?\/)?[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?(?:@sha256:[a-f0-9]{64})?$/,
    "镜像地址格式无效",
  );
// Compare Docker Hub's short and fully qualified names, including implicit latest.
export function imageKey(reference: string) {
  const normalized = reference.replace(/:[^/:@]+(?=@)/, "");
  let value = normalized.replace(/^(?:index\.)?docker\.io\//, "");
  const first = value.split("/")[0]!;
  const privateRegistry =
    value === normalized &&
    value.includes("/") &&
    (first.includes(".") || first.includes(":") || first === "localhost");
  if (!value.includes("/")) value = `library/${value}`;
  if (!value.includes("@") && !value.split("/").at(-1)!.includes(":"))
    value += ":latest";
  return privateRegistry ? value : `docker.io/${value}`;
}
export function imagePrefixKey(prefix: string) {
  if (!prefix.endsWith("/"))
    return prefix.split("/").at(-1)!.includes(":") || prefix.includes("@")
      ? imageKey(prefix)
      : imageKey(prefix).replace(/:latest$/, "");
  const value = prefix.replace(/^index\.docker\.io\//, "docker.io/");
  const first = value.split("/")[0]!;
  return first.includes(".") || first.includes(":") || first === "localhost"
    ? value
    : `docker.io/${value}`;
}
export function cleanDockerMessage(value: unknown) {
  return String(value ?? "")
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
    .replace(/https?:\/\/[^\s]+/g, (text) => {
      try {
        const url = new URL(text);
        url.username = "";
        url.password = "";
        url.search = "";
        return url.toString();
      } catch {
        return "[URL]";
      }
    })
    .slice(0, 1000);
}
