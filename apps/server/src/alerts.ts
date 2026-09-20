import { fetchTransport, sendResendAlert, type Alert } from "@tpm/connectors";
import type { Inference, Run } from "@tpm/schemas";

export type { Alert };

export function runAlert(run: Run, inferences: Inference[]): Alert | null {
  const lines = inferences.flatMap((inference) => {
    if (inference.stage === "health" && inference.value.health !== "healthy") return [`${inference.sensor}: health ${inference.value.health}`];
    if (inference.stage === "drift" && inference.value.drifting) return [`${inference.sensor}: drift, rate ${inference.value.ratePer1000.toFixed(2)} per 1000 steps`];
    return [];
  });
  if (lines.length === 0) return null;
  return { title: `${run.name}: ${lines.length} sensor${lines.length === 1 ? "" : "s"} out of range`, message: lines.join("\n") };
}

export async function sendAlert(alert: Alert, log: (line: string) => void): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_FROM;
  const to = (process.env.ALERT_TO ?? "").split(",").map((address) => address.trim()).filter(Boolean);
  if (!apiKey || !from || to.length === 0) return;
  try {
    const result = await sendResendAlert(fetchTransport, { apiKey, from, to }, alert);
    if (!result.ok) log(`resend alert failed: ${result.error}`);
  } catch (e) {
    log(`resend alert failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function sendRunAlert(run: Run, inferences: Inference[], log: (line: string) => void): Promise<void> {
  const alert = runAlert(run, inferences);
  if (alert) await sendAlert(alert, log);
}
