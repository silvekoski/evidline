import { MicIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVoiceRecorder } from "./use-voice-recorder";

export function VoiceRecorder({ onRecorded, disabled }: { onRecorded: (file: File) => void; disabled?: boolean }) {
  const recorder = useVoiceRecorder(onRecorded);
  if (!recorder.supported) return null;
  return (
    <div className="flex items-center gap-2">
      {recorder.recording ? (
        <Button size="sm" variant="outline" onClick={recorder.stop} aria-label="Stop the recording">
          <SquareIcon aria-hidden="true" /> Stop ({recorder.seconds} s)
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={recorder.start} disabled={disabled} aria-label="Record a voice note">
          <MicIcon aria-hidden="true" /> Record a voice note
        </Button>
      )}
      <span aria-live="polite" className="text-xs text-muted-foreground">
        {recorder.recording ? "Recording. The audio stays in the browser until you stop." : recorder.error}
      </span>
    </div>
  );
}
