import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckIcon, UploadIcon } from "lucide-react";
import type { Source } from "@tpm/schemas";
import { uploadThroughLink } from "@/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VoiceRecorder } from "@/components/knowledge/voice-recorder";

export function PublicUploadScreen({ token }: { token: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [done, setDone] = useState<Source[]>([]);
  const upload = useMutation({ mutationFn: (files: File[]) => uploadThroughLink(token, files), onSuccess: (list) => setDone((d) => [...d, ...list]) });
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Send files to Norrin</CardTitle>
          <CardDescription>Call recordings as VTT, emails as EML, documents, tag lists, and voice notes. The files stay on the Norrin server.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div
            className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const files = Array.from(e.dataTransfer.files);
              if (files.length) upload.mutate(files);
            }}
          >
            <UploadIcon aria-hidden="true" />
            <p>Drop files here, or</p>
            <input ref={input} type="file" multiple className="sr-only" aria-label="Choose files" onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length) upload.mutate(files); e.target.value = ""; }} />
            <Button size="sm" onClick={() => input.current?.click()} disabled={upload.isPending}>
              Choose files
            </Button>
          </div>
          <VoiceRecorder onRecorded={(file) => upload.mutate([file])} disabled={upload.isPending} />
          {upload.isError && <p className="text-sm">{upload.error.message}</p>}
          {done.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm" aria-label="Received files">
              {done.map((s) => (
                <li key={s.id} className="flex items-center gap-2">
                  <CheckIcon aria-hidden="true" className="size-4" /> {s.title}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
