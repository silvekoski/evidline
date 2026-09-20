import { BotIcon } from "lucide-react";
import { siAnthropic, siDeepseek, siGooglegemini, siKimi, siMetaai, siMinimax, siMistralai, siMoonshotai, siNvidia, siOllama, siPerplexity, siQwen, type SimpleIcon } from "simple-icons";
import { cn } from "cn";

const ICONS_BY_ORG: Record<string, SimpleIcon> = {
  "deepseek-ai": siDeepseek,
  deepseek: siDeepseek,
  moonshotai: siMoonshotai,
  qwen: siQwen,
  anthropic: siAnthropic,
  google: siGooglegemini,
  "meta-llama": siMetaai,
  mistralai: siMistralai,
  "perplexity-ai": siPerplexity,
  nvidia: siNvidia,
  "minimax-ai": siMinimax,
  ollama: siOllama,
};

function findIcon(model: string): SimpleIcon | null {
  if (/kimi/i.test(model)) return siKimi;
  const org = model.split("/")[0]?.toLowerCase();
  return (org ? ICONS_BY_ORG[org] : null) ?? null;
}

export function ModelLogo({ model, className }: { model: string; className?: string }) {
  const icon = findIcon(model);
  if (!icon) return <BotIcon aria-label={model} className={cn("size-3.5 shrink-0", className)} />;
  return (
    <svg role="img" aria-label={icon.title} viewBox="0 0 24 24" fill="currentColor" className={cn("size-3.5 shrink-0", className)}>
      <path d={icon.path} />
    </svg>
  );
}
