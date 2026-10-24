import type { DB } from "./db.js";
export async function seedLearning(db: DB) {
  const welcome = crypto.randomUUID(),
    encoding = crypto.randomUUID(),
    caesar = crypto.randomUUID(),
    tree = crypto.randomUUID();
  const articles = [
    {
      id: welcome,
      slug: "getting-started",
      title: "从第一道题开始",
      category: "入门",
      kind: "tutorial",
      body: `## 什么是 Flag

Flag 是题目预设的答案。本平台示例通常采用 \`flag{...}\` 格式；提交内容严格区分大小写，也不会自动去除首尾空格。

## 完成一次练习

1. 注册账户并进入题库。
2. 打开「初识 Flag」，阅读题面。
3. 在提交框输入答案。
4. 查看正确反馈和个人提交记录。

练习成绩属于个人，比赛成绩属于报名战队。两者互不计分。

## 环境与附件

静态附件可以直接下载。动态附件需要先点击「生成专属附件」，等候任务完成。独立环境有有效期，用完请及时停止。

完成阅读后点击页面底部的「标记为已完成」，再完成关联练习，技能树会解锁下一阶段。`,
    },
    {
      id: encoding,
      slug: "encoding-and-bytes",
      title: "编码、字节与 Base64",
      category: "Web",
      kind: "tutorial",
      body: `## 编码不是加密

编码解决数据如何表示的问题，不依赖秘密密钥。Base64 将字节序列映射为可打印字符，常用于传输二进制数据。

## Python 示例

\`\`\`python
import base64
encoded = base64.b64encode(b"hello")
print(encoded.decode())
print(base64.b64decode(encoded).decode())
\`\`\`

十六进制是另一种常见表示方式：\`bytes.fromhex("68656c6c6f")\` 会得到相同的字节。

## 练习

完成「编码的另一面」。遇到未知字符串时先观察字符集、长度和填充字符，不要把所有字符串都当作加密结果。`,
    },
    {
      id: caesar,
      slug: "caesar-cipher",
      title: "凯撒密码与有限枚举",
      category: "Crypto",
      kind: "tutorial",
      body: `## 字母移位

凯撒密码将字母表循环移动固定位置。小写字母可以视为 0–25 的整数，解密就是减去偏移后对 26 取模。

\`\`\`python
def shift(text, offset):
    return ''.join(
        chr((ord(c) - 97 - offset) % 26 + 97)
        if 'a' <= c <= 'z' else c
        for c in text
    )

for offset in range(26):
    print(offset, shift('khoor', offset))
\`\`\`

## 练习

完成「凯撒的来信」。这里的有限枚举是在本地处理题目提供的数据，不需要对平台提交接口进行暴力尝试。`,
    },
  ];
  for (const a of articles)
    await db.query(
      "INSERT INTO articles(id,slug,title,category,kind,body,published) VALUES($1,$2,$3,$4,$5,$6,true)",
      [a.id, a.slug, a.title, a.category, a.kind, a.body],
    );
  await db.query(
    "INSERT INTO learning_trees(id,title,description,published) VALUES($1,$2,$3,true)",
    [tree, "CTF 入门路线", "熟悉答题流程，掌握基础编码与经典密码。"],
  );
  const n1 = crypto.randomUUID(),
    n2 = crypto.randomUUID(),
    n3 = crypto.randomUUID();
  const nodes = [
    {
      id: n1,
      title: "认识 Flag",
      article: welcome,
      challenge: "初识 Flag",
      parents: [],
    },
    {
      id: n2,
      title: "识别数据编码",
      article: encoding,
      challenge: "编码的另一面",
      parents: [n1],
    },
    {
      id: n3,
      title: "破解字母移位",
      article: caesar,
      challenge: "凯撒的来信",
      parents: [n2],
    },
  ];
  for (const [position, n] of nodes.entries()) {
    const [c] = await db.query("SELECT id FROM challenges WHERE title=$1", [
      n.challenge,
    ]);
    await db.query(
      "INSERT INTO learning_nodes(id,tree_id,title,article_id,challenge_id,prerequisites,position) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        n.id,
        tree,
        n.title,
        n.article,
        c!.id,
        JSON.stringify(n.parents),
        position,
      ],
    );
  }
}
