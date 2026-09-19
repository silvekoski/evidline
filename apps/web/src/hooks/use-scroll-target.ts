import { useEffect } from "react";

export function useScrollTarget(id: string | null) {
  useEffect(() => {
    if (id) document.getElementById(id)?.scrollIntoView({ block: "nearest" });
  }, [id]);
}
