import { Hono } from "hono";
import { ModelModeBody, NotificationSettingsBody } from "@tpm/schemas";
import type { AppContext } from "../context";
import { brandedEmail } from "../email-template";
import { getNotificationSettings, sendEmail, setNotificationSettings } from "../notifications";
import { parseBody } from "../request";
import { getModelSettings, setModelMode } from "../settings";

export function settingsRoutes(ctx: AppContext) {
  return new Hono()
    .get("/model", (c) => c.json(getModelSettings(ctx.db, ctx.gateway)))
    .put("/model", async (c) => {
      const { mode } = await parseBody(c, ModelModeBody);
      return c.json(setModelMode(ctx.db, ctx.gateway, mode));
    })
    .get("/notifications", (c) => c.json(getNotificationSettings(ctx.db)))
    .put("/notifications", async (c) => c.json(setNotificationSettings(ctx.db, await parseBody(c, NotificationSettingsBody))))
    .post("/notifications/test", async (c) => c.json(await sendEmail(brandedEmail(`${ctx.slug}: test notification`, "Email notifications work for this workspace.", null))));
}
