import { ensureDefaultContestGroup } from "./contest-groups.js";
import { openDB } from "./db.js";
import { hashPassword, flagHash } from "./security.js";
import { register } from "./schemas.js";
import { seedLearning } from "./seed-learning.js";
import { config } from "./config.js";
const db = await openDB();
try {
  const command = process.argv[2];
  if (command === "admin") {
    // Read a single JSON document from stdin; never put passwords in process arguments.
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 4096) throw Error("Input too large");
    }
    const data = register.parse(JSON.parse(input));
    const hash = await hashPassword(data.password);
    await db.query(
      "INSERT INTO users(id,username,email,password_hash,role) VALUES($1,$2,$3,$4,'admin')",
      [crypto.randomUUID(), data.username, data.email, hash],
    );
    console.log("管理员已创建。");
  } else if (command === "seed") {
    if (config.NODE_ENV === "production")
      throw Error("禁止在生产模式加载示例数据");
    if ((await db.query("SELECT id FROM challenges LIMIT 1")).length)
      throw Error("仅允许在空题库中加载示例");
    await db.transaction(async (tx) => {
      const samples = [
        [
          "初识 Flag",
          "Misc",
          "入门",
          "欢迎来到 NebuCTF。\n\nCTF 的答案通常以 flag{...} 表示。\n提交 flag{hello_nebuctf} 完成第一道练习。",
          "flag{hello_nebuctf}",
        ],
        [
          "凯撒的来信",
          "Crypto",
          "入门",
          "信件中只有一行：\niodj{fdhvdu_lv_d_fodvvlf}\n\n字母向前移动了三位，标点保持不变。",
          "flag{caesar_is_a_classic}",
        ],
        [
          "字节之间",
          "Reverse",
          "简单",
          "将这些十六进制字节转换为 ASCII：\n66 6c 61 67 7b 62 79 74 65 73 5f 74 65 6c 6c 5f 73 74 6f 72 69 65 73 7d",
          "flag{bytes_tell_stories}",
        ],
        [
          "编码的另一面",
          "Web",
          "入门",
          "响应中出现了以下 Base64 字符串：\nZmxhZ3tiYXNlNjRfaXNfbm90X2VuY3J5cHRpb259",
          "flag{base64_is_not_encryption}",
        ],
      ];
      for (const [title, category, difficulty, description, flag] of samples)
        await tx.query(
          "INSERT INTO challenges(id,title,category,difficulty,description,kind,flag_hash,published,practice,initial_points,minimum_points) VALUES($1,$2,$3,$4,$5,'static_attachment',$6,true,true,100,50)",
          [
            crypto.randomUUID(),
            title,
            category,
            difficulty,
            description,
            flagHash(flag!),
          ],
        );
      await seedLearning(tx);
      const start = new Date(Date.now() + 24 * 3600 * 1000),
        end = new Date(start.getTime() + 48 * 3600 * 1000);
      const contestId = crypto.randomUUID();
      await tx.query(
        "INSERT INTO contests(id,title,description,starts_at,ends_at,published) VALUES($1,$2,$3,$4,$5,true)",
        [
          contestId,
          "NebuCTF 新人体验赛",
          "本赛事为本地开发示例。请由管理员配置独立赛题后使用。",
          start,
          end,
        ],
      );
      await ensureDefaultContestGroup(tx, contestId);
      await tx.query(
        "INSERT INTO announcements(id,title,body) VALUES($1,$2,$3)",
        [
          crypto.randomUUID(),
          "练习场已开放",
          "当前内容为开发示例。可以在题库中完成基础练习，或在管理中心添加自己的题目。",
        ],
      );
    });
    console.log("示例题目、教程、技能树和赛事已加载；未创建演示账号。");
  } else throw Error("用法：cli admin（stdin JSON）或 cli seed");
} finally {
  await db.close();
}
