import { useEffect, useRef, useState } from "react";

const mimeType = (): string => ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";

export type VoiceRecorderState = { supported: boolean; recording: boolean; seconds: number; error: string | null; start: () => Promise<void>; stop: () => void };

export function useVoiceRecorder(onRecorded: (file: File) => void): VoiceRecorderState {
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

  return { supported, recording, seconds, error, start, stop };
}
