import { AnimatedBrand } from "@/components/animated-brand";
import animationData from "@/assets/evidline-mark.json";
import mark from "@/assets/evidline-mark.svg?raw";

export function EvidlineMark({ className, replayKey }: { className?: string; replayKey?: string }) {
  return <AnimatedBrand artwork={mark} animationData={animationData} className={className} replayKey={replayKey} />;
}
