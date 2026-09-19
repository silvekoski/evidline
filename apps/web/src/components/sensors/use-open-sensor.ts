import { useCallback } from "react";
import { useNavigate } from "react-router";

export function useOpenSensor(): (alias: string | null) => void {
  const navigate = useNavigate();
  return useCallback((alias: string | null) => navigate({ hash: alias ? `#${alias}` : "" }, { replace: true }), [navigate]);
}
