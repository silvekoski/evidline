import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, SendIcon } from "lucide-react";
import { toast } from "sonner";
import type { Claim, OpenQuestion } from "@tpm/schemas";
import { answerQuestion, keys, setClaimStatus } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const SPEAKER_KEY = "tpm.answer-speaker";
const readSpeaker = (): string => {
  try {
    return localStorage.getItem(SPEAKER_KEY) ?? "";
  } catch {
    return "";
  }
};
const keepSpeaker = (value: string): void => {
  try {
    localStorage.setItem(SPEAKER_KEY, value);
  } catch {
    return;
  }
};

export function AnswerForm({ question, onDone }: { question: OpenQuestion; onDone: () => void }) {
  const id = useId();
  const queryClient = useQueryClient();
  const [speaker, setSpeaker] = useState(() => question.contact ?? readSpeaker());
  const [text, setText] = useState("");
  const [claim, setClaim] = useState<Claim | null>(null);
  const invalidate = () => Promise.all([queryClient.invalidateQueries({ queryKey: keys.openQuestions }), queryClient.invalidateQueries({ queryKey: keys.claims })]);
  const answer = useMutation({
    mutationFn: () => answerQuestion(question.column.id, { speaker: speaker.trim(), text: text.trim() }),
    onSuccess: async (created) => {
      keepSpeaker(speaker.trim());
      setClaim(created);
      await invalidate();
    },
  });
  const confirm = useMutation({
    mutationFn: () => setClaimStatus(claim!.id, "confirmed"),
    onSuccess: async () => {
      toast.success(`${question.column.name} is answered`);
      await invalidate();
      onDone();
    },
  });

  if (claim) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
        <span>
          Saved as a stated claim by <span className="font-medium">{claim.speaker}</span>. Confirm it to close the question and put it in the data spec.
        </span>
        <Button size="sm" onClick={() => confirm.mutate()} disabled={confirm.isPending}>
          <CheckIcon aria-hidden="true" /> Confirm claim
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Later
        </Button>
      </div>
    );
  }

  return (
    <form
      className="grid gap-3 rounded-md border p-3 sm:grid-cols-[14rem_1fr]"
      onSubmit={(e) => {
        e.preventDefault();
        answer.mutate();
      }}
    >
      <p className="text-sm text-muted-foreground sm:col-span-2">{question.question}</p>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-speaker`}>Who answered</Label>
        <Input id={`${id}-speaker`} value={speaker} onChange={(e) => setSpeaker(e.target.value)} placeholder="Name of the customer contact" required maxLength={120} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-text`}>Answer</Label>
        <Textarea id={`${id}-text`} value={text} onChange={(e) => setText(e.target.value)} placeholder={`${question.column.name} measures ... in ..., logged every ...`} required minLength={3} maxLength={4000} rows={3} />
      </div>
      <div className="flex gap-2 sm:col-span-2 sm:justify-end">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={answer.isPending || speaker.trim().length === 0 || text.trim().length < 3}>
          <SendIcon aria-hidden="true" /> Save answer
        </Button>
      </div>
    </form>
  );
}
