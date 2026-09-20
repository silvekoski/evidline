import { useRef, type ReactNode } from "react";

export function FilePicker({ accept, multiple, label, onFiles, children }: { accept: string; multiple?: boolean; label: string; onFiles: (files: File[]) => void; children: (open: () => void) => ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        tabIndex={-1}
        aria-label={label}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
      {children(() => input.current?.click())}
    </>
  );
}
