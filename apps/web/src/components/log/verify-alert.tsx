import type { UseQueryResult } from "@tanstack/react-query";
import { LoaderCircleIcon, ShieldAlertIcon, ShieldCheckIcon } from "lucide-react";
import type { LogVerification } from "@tpm/schemas";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function VerifyAlert({ verification }: { verification: UseQueryResult<LogVerification> }) {
  if (verification.isFetching) {
    return (
      <Alert>
        <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
        <AlertTitle>Verifying the chain</AlertTitle>
        <AlertDescription>The server computes each hash again from the stored entry text.</AlertDescription>
      </Alert>
    );
  }
  if (verification.isError) {
    return (
      <Alert>
        <ShieldAlertIcon aria-hidden="true" />
        <AlertTitle>Verify failed</AlertTitle>
        <AlertDescription>{verification.error.message}</AlertDescription>
      </Alert>
    );
  }
  if (!verification.data) return null;
  const { ok, entries, head, firstBadSeq } = verification.data;
  return (
    <Alert>
      {ok ? <ShieldCheckIcon aria-hidden="true" /> : <ShieldAlertIcon aria-hidden="true" />}
      <AlertTitle>{ok ? "Chain intact" : `Chain broken at seq ${firstBadSeq}`}</AlertTitle>
      <AlertDescription>
        {entries.toLocaleString("en-US")} entries in the chain.{" "}
        {ok ? "Each hash matches its entry and its previous hash." : `The hash of entry ${firstBadSeq} does not match its content or its previous hash.`} Head hash{" "}
        <span className="font-mono break-all text-foreground">{head}</span>
      </AlertDescription>
    </Alert>
  );
}
