import type { DB } from "./db.js";
import { defaultHelpSections } from "./help-content.js";

const groups = [
  ["入门指南", ["quick-start", "account", "teams"]],
  ["参赛与解题", ["contests", "challenges", "resources", "scores"]],
  ["攻防专题", ["awdp", "awd"]],
  ["学习与支持", ["learning", "messages", "faq"]],
  ["办赛指南", ["organizers"]],
] as const;

export async function seedHelp(db: DB) {
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(760001)");
    const applied = await tx.query(
      "SELECT 1 FROM schema_migrations WHERE version=34",
    );
    if (applied.length) return;
    let position = 0;
    for (const [category, slugs] of groups) {
      for (const slug of slugs) {
        const section = defaultHelpSections.find((item) => item.id === slug)!;
        position += 10;
        await tx.query(
          "INSERT INTO help_documents(id,slug,title,category,position,body,published) VALUES($1,$2,$3,$4,$5,$6,true)",
          [
            crypto.randomUUID(),
            slug,
            section.title,
            category,
            position,
            section.body,
          ],
        );
      }
    }
    await tx.query("INSERT INTO schema_migrations(version) VALUES(34)");
  });
}
