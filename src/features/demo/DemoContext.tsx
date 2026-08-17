import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/AuthContext";
import { isDemoOrg } from "@/features/demo/demoAccess";
import { useResetDemo } from "@/hooks/useDemo";

interface DemoContextType {
  isDemoOrg: boolean;
  isBarHidden: boolean;
  hideBar: () => void;
  showBar: () => void;
  volume: "small" | "full";
  reset: () => void;
  isResetting: boolean;
}

const DemoContext = createContext<DemoContextType | undefined>(undefined);

export function DemoProvider({ children }: { children: ReactNode }) {
  const { currentOrg } = useAuth();
  const demo = isDemoOrg(currentOrg);
  const [isBarHidden, setBarHidden] = useState(false);
  const resetMut = useResetDemo();
  // Phase 1: volume is not yet read back from demo_state in the client; default 'full'.
  // Phase 2 wires demo_state (scene + volume) into this provider.
  const volume: "small" | "full" = "full";

  const reset = useCallback(() => {
    if (!currentOrg) return;
    resetMut.mutate(
      { orgId: currentOrg.id, volume },
      { onSuccess: () => toast.success("Demo reset"), onError: (e: Error) => toast.error(e.message) },
    );
  }, [currentOrg, resetMut, volume]);

  const value: DemoContextType = {
    isDemoOrg: demo,
    isBarHidden,
    hideBar: useCallback(() => setBarHidden(true), []),
    showBar: useCallback(() => setBarHidden(false), []),
    volume,
    reset,
    isResetting: resetMut.isPending,
  };
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error("useDemo must be used within DemoProvider");
  return ctx;
}
