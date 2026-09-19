import { useEffect, useRef, useState } from "react";
import { MicIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

const mimeType = (): string => ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";

export function VoiceRecorder({ onRecorded, disabled }: { onRecorded: (file: File) => void; disabled?: boolean }) {
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const supported = typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = mimeType();
      const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const ext = rec.mimeType.includes("mp4") ? "m4a" : "webm";
        onRecorded(new File(chunks.current, `voice-note-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`, { type: rec.mimeType }));
      };
      rec.start(1000);
      recorder.current = rec;
      setSeconds(0);
      setRecording(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const stop = () => {
    recorder.current?.stop();
    recorder.current = null;
    setRecording(false);
  };

  if (!supported) return null;
  return (
    <div className="flex items-center gap-2">
      {recording ? (
        <Button size="sm" variant="outline" onClick={stop} aria-label="Stop the recording">
          <SquareIcon aria-hidden="true" /> Stop ({seconds} s)
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={start} disabled={disabled} aria-label="Record a voice note">
          <MicIcon aria-hidden="true" /> Record a voice note
        </Button>
      )}
      <span aria-live="polite" className="text-xs text-muted-foreground">
        {recording ? "Recording. The audio stays in the browser until you stop." : error}
      </span>
    </div>
  );
}
