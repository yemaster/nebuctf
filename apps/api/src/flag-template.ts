import { createHmac } from "node:crypto";
import { z } from "zod";

const simple: Record<string, string> = {
  A: "Aa4",
  B: "Bb68",
  C: "Cc",
  D: "Dd",
  E: "Ee3",
  F: "Ff1",
  G: "Gg69",
  H: "Hh",
  I: "Ii1l",
  J: "Jj",
  K: "Kk",
  L: "Ll1I",
  M: "Mm",
  N: "Nn",
  O: "Oo0",
  P: "Pp",
  Q: "Qq9",
  R: "Rr",
  S: "Ss5",
  T: "Tt7",
  U: "Uu",
  V: "Vv",
  W: "Ww",
  X: "Xx",
  Y: "Yy",
  Z: "Zz2",
  "0": "0oO",
  "1": "1lI",
  "2": "2zZ",
  "3": "3eE",
  "4": "4aA",
  "5": "5Ss",
  "6": "6Gb",
  "7": "7T",
  "8": "8bB",
  "9": "9g",
  " ": "_",
};
const complex: Record<string, string> = {
  ...simple,
  A: "Aa4@",
  B: "Bb6&",
  C: "Cc(",
  I: "Ii1l!",
  L: "Ll1I!",
  O: "Oo0#",
  S: "Ss5$",
  Z: "Zz2?",
  "0": "0oO#",
  "1": "1lI|",
  "2": "2zZ?",
  "8": "8B&",
};

// Parse bounded text only; templates never execute code or interpolate shell commands.
export function inspectFlagTemplate(template: string) {
  if (!template)
    return {
      entropy: 160,
      length: 46,
      leet: false,
      complex: false,
      prefix: "flag",
      body: "",
      segments: [] as string[],
    };
  if (template.length > 256 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(template))
    throw Error("模板最多 256 字，不能包含换行或控制字符");
  const marker = template.match(/^\[(C?LEET)\]/)?.[0] ?? "";
  const match = template
    .slice(marker.length)
    .match(/^([A-Za-z][A-Za-z0-9_-]{0,31})\{([^{}]*)\}$/);
  if (!match) throw Error("模板格式应为 flag{内容}，可自定义前缀");
  const [, prefix, body] = match as [string, string, string];
  const segments = body.split(/(\[GUID\]|\[TEAM_HASH\])/);
  const literals = segments.filter(
    (part) => part !== "[GUID]" && part !== "[TEAM_HASH]",
  );
  if (literals.some((part) => /[\[\]]/.test(part)))
    throw Error("占位符仅支持 [GUID] 和 [TEAM_HASH]");
  const guid = segments.includes("[GUID]"),
    hash = segments.includes("[TEAM_HASH]");
  const leet = !!marker || (!guid && !hash),
    special = marker === "[CLEET]";
  const map = special ? complex : simple;
  const entropy =
    (guid ? 122 : 0) +
    (hash ? 48 : 0) +
    (leet
      ? literals.reduce(
          (sum, part) =>
            sum +
            [...part].reduce(
              (n, ch) => n + Math.log2(map[ch.toUpperCase()]?.length ?? 1),
              0,
            ),
          0,
        )
      : 0);
  if (entropy < 32)
    throw Error("模板变化空间不足，请增加内容或加入 [GUID] / [TEAM_HASH]");
  const length =
    prefix.length +
    2 +
    segments.reduce(
      (sum, part) =>
        sum +
        (part === "[GUID]" ? 36 : part === "[TEAM_HASH]" ? 12 : part.length),
      0,
    );
  if (length > 256) throw Error("生成的 Flag 不能超过 256 字");
  return { entropy, length, leet, complex: special, prefix, body, segments };
}

export const flagTemplateInput = z
  .string()
  .max(256)
  .superRefine((value, ctx) => {
    try {
      inspectFlagTemplate(value);
    } catch (error) {
      ctx.addIssue({ code: "custom", message: (error as Error).message });
    }
  });

export function renderFlagTemplate(template: string, seed: Buffer) {
  if (!template) throw Error("空模板应使用平台默认 Flag 生成方式");
  const parsed = inspectFlagTemplate(template);
  const bytes = (label: string) =>
    createHmac("sha256", seed).update(label).digest();
  const uuid = bytes("guid").subarray(0, 16);
  uuid[6] = (uuid[6]! & 0x0f) | 0x40;
  uuid[8] = (uuid[8]! & 0x3f) | 0x80;
  const hex = uuid.toString("hex"),
    guid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const hash = bytes("team-hash").toString("hex").slice(0, 12);
  const map = parsed.complex ? complex : simple;
  let block = Buffer.alloc(0),
    index = 0,
    counter = 0;
  const pick = (choices: string) => {
    // Rejection sampling keeps Leet choices uniform, including sets of size 3 or 5.
    let value: number;
    do {
      if (index >= block.length) {
        block = bytes(`leet:${counter++}`);
        index = 0;
      }
      value = block[index++]!;
    } while (value >= 256 - (256 % choices.length));
    return choices[value % choices.length]!;
  };
  const body = parsed.segments
    .map((part) => {
      if (part === "[GUID]") return guid;
      if (part === "[TEAM_HASH]") return hash;
      if (!parsed.leet) return part;
      return [...part]
        .map((ch) =>
          map[ch.toUpperCase()] ? pick(map[ch.toUpperCase()]!) : ch,
        )
        .join("");
    })
    .join("");
  return `${parsed.prefix}{${body}}`;
}
