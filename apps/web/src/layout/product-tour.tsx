import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

type TourStep = { id: string; selector: string | null; placement: "right" | "bottom"; title: string; body: string };

const CARD_WIDTH = 320;

const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    selector: null,
    placement: "bottom",
    title: "A short tour",
    body: "This tour points out the main parts of Process Monitor. Skip it at any time.",
  },
  {
    id: "workspace",
    selector: '[data-tour="tour-workspace"]',
    placement: "right",
    title: "Your workspace",
    body: "One workspace holds one customer: its runs, sources, claims, and data spec. Switch or add a workspace here.",
  },
  {
    id: "run",
    selector: '[data-tour="tour-run"]',
    placement: "right",
    title: "Start a run",
    body: "Drop a CSV here, or pick a file under data/, to start a run. The pipeline needs no settings.",
  },
  {
    id: "runs",
    selector: '[data-tour="tour-runs"]',
    placement: "right",
    title: "Every run",
    body: "Find each run you started, and open its sensors, quality, drift, and diagnosis.",
  },
  {
    id: "sources",
    selector: '[data-tour="tour-sources"]',
    placement: "right",
    title: "Customer knowledge",
    body: "Add call transcripts, voice notes, Slack threads, emails, and files. Each source turns into searchable, linked claims.",
  },
  {
    id: "connectors",
    selector: '[data-tour="tour-connectors"]',
    placement: "right",
    title: "Connect a source",
    body: "Connect Teams, a shared mailbox, or Slack, so new sources arrive on their own.",
  },
  {
    id: "search",
    selector: '[data-tour="tour-search"]',
    placement: "bottom",
    title: "Jump to anything",
    body: "Press Cmd K, or Ctrl K, to jump to a run, screen, or source by name.",
  },
];

const storageKey = (slug: string) => `tpm.tour.${slug}`;

export function useProductTour(slug: string) {
  const [index, setIndex] = useState<number | null>(null);

  useEffect(() => {
    setIndex(localStorage.getItem(storageKey(slug)) ? null : 0);
  }, [slug]);

  const finish = useCallback(() => {
    localStorage.setItem(storageKey(slug), "1");
    setIndex(null);
  }, [slug]);

  const next = useCallback(() => {
    setIndex((current) => {
      if (current === null) return current;
      const upcoming = current + 1;
      if (upcoming >= TOUR_STEPS.length) {
        localStorage.setItem(storageKey(slug), "1");
        return null;
      }
      return upcoming;
    });
  }, [slug]);

  const back = useCallback(() => {
    setIndex((current) => (current !== null && current > 0 ? current - 1 : current));
  }, []);

  const restart = useCallback(() => setIndex(0), []);

  return { index, next, back, skip: finish, restart };
}

function clampLeft(left: number) {
  return Math.min(Math.max(left, 16), window.innerWidth - CARD_WIDTH - 16);
}

export function ProductTour({ index, onNext, onBack, onSkip }: { index: number | null; onNext: () => void; onBack: () => void; onSkip: () => void }) {
  const step = index === null ? null : TOUR_STEPS[index];
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!step) return;
    const measure = () => {
      const target = step.selector ? document.querySelector(step.selector) : null;
      const box = target?.getBoundingClientRect() ?? null;
      setRect(box && box.width > 0 && box.height > 0 ? box : null);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step]);

  useEffect(() => {
    if (step) cardRef.current?.focus();
  }, [step]);

  if (!step) return null;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") onSkip();
  };

  const cardStyle: CSSProperties = rect
    ? step.placement === "right"
      ? { top: Math.min(Math.max(rect.top + rect.height / 2 - 90, 16), window.innerHeight - 220), left: clampLeft(rect.right + 16) }
      : { top: Math.min(rect.bottom + 12, window.innerHeight - 220), left: clampLeft(rect.left) }
    : { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };

  return createPortal(
    <div className="fixed inset-0 z-50">
      {rect ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-md transition-all duration-200"
          style={{
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
            boxShadow: "0 0 0 2px var(--primary), 0 0 0 9999px rgb(0 0 0 / 0.75)",
          }}
        />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 bg-black/75" />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-step-title"
        aria-describedby="tour-step-body"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="absolute outline-none transition-all duration-200"
        style={{ width: CARD_WIDTH, ...cardStyle }}
      >
        <Card>
          <CardHeader>
            <CardTitle id="tour-step-title">{step.title}</CardTitle>
            <CardDescription id="tour-step-body">{step.body}</CardDescription>
          </CardHeader>
          <CardFooter className="justify-between border-t-0 bg-transparent pt-0">
            <span className="text-xs text-muted-foreground">
              {index! + 1} / {TOUR_STEPS.length}
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onSkip}>
                Skip tour
              </Button>
              {index! > 0 && (
                <Button type="button" variant="outline" size="sm" onClick={onBack}>
                  Back
                </Button>
              )}
              <Button type="button" size="sm" onClick={onNext} autoFocus>
                {index === TOUR_STEPS.length - 1 ? "Finish" : "Next"}
              </Button>
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>,
    document.body,
  );
}
