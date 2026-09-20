# Notifications

## Events

A run makes a notification at three points in `apps/server/src/run-service.ts`:

- `sensor-alert`, after the pipeline persists its inferences. The draft lists each sensor with a failed health check or a flagged drift.
- `run-finished`, after the model calls complete.
- `run-failed`, in the catch block.

`notify` in `apps/server/src/notifications.ts` stores the row in the `notifications` table, then emails it when the kind is on and the server has an email setup.

## Email

Resend sends the email. `packages/connectors/src/resend.ts` holds the HTTP call. The server reads `RESEND_API_KEY`, `ALERT_FROM`, and `ALERT_TO` (comma-separated). `APP_URL` is optional. When set, the email body ends with a link to the run screen.

The per-kind toggles live in the `settings` table under the key `notifications`. Defaults: sensor alert on, run finished off, run failed on.

## Routes

- `GET /notifications`: newest 200 rows.
- `POST /notifications/:id/read` and `POST /notifications/read-all`.
- `GET|PUT /settings/notifications`: toggles plus `emailConfigured` and `recipients`.
- `POST /settings/notifications/test`: sends one test email, stores nothing.

## Web

The bell in the header (`components/notifications/notification-bell.tsx`) polls the list every 15 s, shows the unread count, and pops a toast for each new unread row. The `/notifications` screen lists all rows and holds the email toggles. `notificationScreen` in the schema maps a kind to the run screen a click opens.
