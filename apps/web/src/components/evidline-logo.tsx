import { AnimatedBrand } from "@/components/animated-brand";
import animationData from "@/assets/evidline-logo.json";
import logo from "@/assets/evidline-logo.svg?raw";

export function EvidlineLogo({ className, replayKey }: { className?: string; replayKey?: string }) {
  return <AnimatedBrand artwork={logo} animationData={animationData} className={className} replayKey={replayKey} />;
}
