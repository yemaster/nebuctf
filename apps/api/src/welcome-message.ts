import type { DB } from "./db.js";
import { getSetting } from "./settings.js";
import { deliverNotification } from "./notifications.js";

export async function sendWelcome(
  db: DB,
  user: { id: string; username: string },
) {
  const welcome = await getSetting(db, "welcome");
  if (!welcome.enabled) return;
  const site = await getSetting(db, "site");
  const render = (text: string) =>
    text.replace(/\{(username|site_name)\}/g, (_, key) =>
      key === "username" ? user.username : site.name,
    );
  await deliverNotification(
    db,
    {
      kind: "system",
      title: render(welcome.title).slice(0, 120),
      body: render(welcome.body).slice(0, 8000),
      actions: welcome.actions,
      eventKey: `welcome:${user.id}`,
      audienceLabel: "注册欢迎消息",
    },
    { kind: "users", ids: [user.id] },
  );
}
