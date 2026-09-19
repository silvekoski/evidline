import { Hono } from "hono";
import { ModelModeBody } from "@tpm/schemas";
import type { AppContext } from "../context";
import { parseBody } from "../request";
import { getModelSettings, setModelMode } from "../settings";

export function settingsRoutes(ctx: AppContext) {
  return new Hono()
    .get("/model", (c) => c.json(getModelSettings(ctx.db)))
    .put("/model", async (c) => {
      const { mode } = await parseBody(c, ModelModeBody);
      return c.json(setModelMode(ctx.db, mode));
    });
}
