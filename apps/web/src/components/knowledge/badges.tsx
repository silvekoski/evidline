import type { ComponentProps } from "react";
import { BotIcon, CheckIcon, CircleDashedIcon, CircleXIcon, DatabaseIcon, FileAudioIcon, FileIcon, FileSpreadsheetIcon, FileTextIcon, MailIcon, MessageSquareIcon, MessageSquareTextIcon, MicIcon, NotebookPenIcon, PhoneIcon, PresentationIcon, ScanTextIcon, UserIcon } from "lucide-react";
import { cn } from "cn";
import type { ClaimStatus, Provenance, Source, SourceKind, SourceStatus } from "@tpm/schemas";
import { Badge } from "@/components/ui/badge";

type Style = { icon: typeof CheckIcon; word: string; variant: ComponentProps<typeof Badge>["variant"]; className?: string };

const provenance: Record<Provenance, Style> = {
  data: { icon: DatabaseIcon, word: "data", variant: "default" },
  person: { icon: UserIcon, word: "person", variant: "outline", className: "border-foreground" },
  model: { icon: BotIcon, word: "model", variant: "outline", className: "border-dashed italic" },
};

const claimStatus: Record<ClaimStatus, Style> = {
  hypothesis: { icon: CircleDashedIcon, word: "hypothesis", variant: "ghost", className: "italic px-0 text-muted-foreground" },
  stated: { icon: MessageSquareTextIcon, word: "stated", variant: "ghost", className: "px-0" },
  confirmed: { icon: CheckIcon, word: "confirmed", variant: "ghost", className: "px-0" },
  contradicted: { icon: CircleXIcon, word: "contradicted", variant: "ghost", className: "px-0 line-through" },
};

const sourceKind: Record<SourceKind, Style> = {
  teams_call: { icon: PhoneIcon, word: "Teams call", variant: "outline" },
  slack_thread: { icon: MessageSquareIcon, word: "Slack thread", variant: "outline" },
  email: { icon: MailIcon, word: "Email", variant: "outline" },
  file: { icon: FileIcon, word: "File", variant: "outline" },
  voice_note: { icon: MicIcon, word: "Voice note", variant: "outline" },
  note: { icon: NotebookPenIcon, word: "Answer", variant: "outline" },
};

const ocr: Style = { icon: ScanTextIcon, word: "OCR", variant: "outline", className: "border-dashed" };

export const sourceStatusWord: Record<SourceStatus, string> = {
  received: "received",
  processing: "processing",
  processed: "processed",
  failed: "failed",
  needs_ocr: "needs OCR",
  sensor_data: "sensor data",
};

function Styled({ style, className, label }: { style: Style; className?: string; label?: string }) {
  const Icon = style.icon;
  return (
    <Badge variant={style.variant} className={cn("font-normal", style.className, className)}>
      <Icon aria-hidden="true" />
      {label ?? style.word}
    </Badge>
  );
}

export const ProvenanceBadge = ({ value, className }: { value: Provenance; className?: string }) => <Styled style={provenance[value]} className={className} />;
export const ClaimStatusBadge = ({ value, className }: { value: ClaimStatus; className?: string }) => <Styled style={claimStatus[value]} className={className} />;
export const SourceKindBadge = ({ value, className }: { value: SourceKind; className?: string }) => <Styled style={sourceKind[value]} className={className} />;
export const OcrBadge = ({ className }: { className?: string }) => <Styled style={ocr} className={className} />;
const fileIcons: [RegExp, typeof FileIcon][] = [
  [/\.(csv|xlsx)$/i, FileSpreadsheetIcon],
  [/\.(pptx)$/i, PresentationIcon],
  [/\.(txt|md|docx|vtt|pdf)$/i, FileTextIcon],
  [/\.(m4a|mp3|wav|ogg|webm)$/i, FileAudioIcon],
];

export const sourceIcon = (source: Pick<Source, "kind" | "title" | "mediaType">) =>
  source.kind === "file" ? (source.mediaType.startsWith("audio/") ? FileAudioIcon : (fileIcons.find(([re]) => re.test(source.title))?.[1] ?? FileIcon)) : sourceKind[source.kind].icon;
export const sourceKindWord = (value: SourceKind) => sourceKind[value].word;
