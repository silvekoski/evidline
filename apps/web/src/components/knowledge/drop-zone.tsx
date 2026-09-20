import { useState, type ReactNode } from "react";
import { UploadCloudIcon } from "lucide-react";
import { cn } from "cn";

const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

export function DropZone({ onFiles, disabled, className, children }: { onFiles: (files: File[]) => void; disabled?: boolean; className?: string; children: ReactNode }) {
  const [depth, setDepth] = useState(0);
  const over = depth > 0 && !disabled;
  return (
    <div
      className={cn("relative", className)}
      onDragEnter={(e) => hasFiles(e) && setDepth((d) => d + 1)}
      onDragLeave={(e) => hasFiles(e) && setDepth((d) => Math.max(0, d - 1))}
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDepth(0);
        const files = Array.from(e.dataTransfer.files);
        if (files.length && !disabled) onFiles(files);
      }}
    >
      {children}
      {over && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-foreground bg-background/90" aria-live="polite">
          <p className="flex items-center gap-2 text-sm font-medium">
            <UploadCloudIcon aria-hidden="true" className="size-5" /> Drop files to add them to this workspace
          </p>
        </div>
      )}
    </div>
  );
}
