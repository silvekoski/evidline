import { Hono } from "hono";
import type { AppContext } from "../context";
import { notFound } from "../request";

export function notificationRoutes(ctx: AppContext) {
  const { notifications } = ctx.db;
  return new Hono()
    .get("/", (c) => c.json(notifications.list()))
    .post("/read-all", (c) => c.json({ read: notifications.markAllRead(new Date().toISOString()) }))
    .post("/:id/read", (c) => {
      const id = c.req.param("id");
      notifications.markRead(id, new Date().toISOString());
      const notification = notifications.get(id);
      if (!notification) throw notFound("notification");
      return c.json(notification);
    });
}
