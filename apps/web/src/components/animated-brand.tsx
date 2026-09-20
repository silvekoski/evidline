import { useEffect, useRef, useState } from "react";
import type { AnimationItem } from "lottie-web";
import { cn } from "cn";

type AnimatedBrandProps = {
  artwork: string;
  animationData: { w: number; h: number };
  className?: string;
  replayKey?: string;
};

export function AnimatedBrand({ artwork, animationData, className, replayKey }: AnimatedBrandProps) {
  const container = useRef<HTMLSpanElement>(null);
  const animation = useRef<AnimationItem | null>(null);
  const replay = useRef<(restart?: boolean) => void>(() => {});
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const element = container.current;
    if (!element) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;
    let loading = false;
    let visible = false;

    const finish = () => {
      animation.current?.pause();
      setPlaying(false);
    };

    const play = (restart = false) => {
      if (!animation.current?.isLoaded || motion.matches || document.hidden || !visible) return;
      if (!restart && !animation.current.isPaused) return;
      animation.current.goToAndPlay(0, true);
      setPlaying(true);
    };
    replay.current = play;

    const initialize = async () => {
      if (disposed || motion.matches || loading || animation.current || !visible) return;
      loading = true;
      try {
        // The small SVG player is fetched only for a visible, motion-enabled logo.
        const { default: lottie } = await import("lottie-web/build/player/lottie_light");
        if (disposed || motion.matches) return;
        const player = lottie.loadAnimation({
          container: element,
          renderer: "svg",
          loop: false,
          autoplay: false,
          animationData: structuredClone(animationData),
          rendererSettings: { preserveAspectRatio: "xMidYMid meet", focusable: false },
        });
        animation.current = player;
        player.addEventListener("complete", finish);
        player.addEventListener("data_failed", finish);
        player.addEventListener("error", finish);
        player.addEventListener("DOMLoaded", () => play());
        if (player.isLoaded) play();
      } catch {
        // The original SVG stays visible if the optional player cannot load.
        if (!disposed) finish();
      } finally {
        loading = false;
      }
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      if (visible) void initialize();
      else finish();
    });
    observer.observe(element);

    const onMotionChange = () => {
      if (motion.matches) finish();
      else void initialize();
    };
    const onVisibilityChange = () => {
      if (document.hidden) finish();
    };
    motion.addEventListener("change", onMotionChange);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      disposed = true;
      observer.disconnect();
      motion.removeEventListener("change", onMotionChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      replay.current = () => {};
      animation.current?.destroy();
      animation.current = null;
    };
  }, [animationData]);

  useEffect(() => {
    // Let the new route commit before starting the decorative animation.
    const frame = requestAnimationFrame(() => replay.current(true));
    return () => cancelAnimationFrame(frame);
  }, [replayKey]);

  return (
    <span
      role="img"
      aria-label="evidline"
      data-playing={playing}
      className={cn("relative inline-block shrink-0 text-primary", className)}
      style={{ aspectRatio: `${animationData.w} / ${animationData.h}` }}
      onPointerEnter={() => replay.current()}
    >
      <span
        aria-hidden="true"
        className={cn("block h-full [&>svg]:h-full [&>svg]:w-full", playing && "invisible motion-reduce:visible")}
        dangerouslySetInnerHTML={{ __html: artwork }}
      />
      <span
        ref={container}
        aria-hidden="true"
        className={cn("pointer-events-none absolute inset-0 contain-paint [&_path[fill]:not([fill=none])]:fill-current [&_path[stroke]]:stroke-current motion-reduce:hidden", !playing && "invisible")}
      />
    </span>
  );
}
