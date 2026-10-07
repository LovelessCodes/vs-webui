import { useQueryClient } from "@tanstack/react-query";
import { WifiOff } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

type ConnectionState = "connecting" | "online" | "offline";

interface ConnectionContextValue {
  state: ConnectionState;
  retry: () => void;
}

const ConnectionContext = createContext<ConnectionContextValue>({
  state: "connecting",
  retry: () => {},
});

export function useConnection() {
  return useContext(ConnectionContext);
}

/** No server message for this long means the link is dead (heartbeat: 10 s). */
const WATCHDOG_MS = 25_000;
const MAX_RETRY_MS = 10_000;

/** Opens the liveness socket and tracks whether the manager is reachable. */
export function ConnectionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ConnectionState>("connecting");
  const socketRef = useRef<WebSocket | null>(null);
  const watchdogRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const attemptRef = useRef(0);
  const wasOfflineRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    clearTimers();
    // Drop any previous socket without letting its close handler reconnect.
    const previous = socketRef.current;
    socketRef.current = null;
    if (previous) {
      try {
        previous.close();
      } catch {
        // already closed
      }
    }

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${window.location.host}/api/ws`);
    socketRef.current = socket;

    const armWatchdog = () => {
      if (watchdogRef.current !== null) window.clearTimeout(watchdogRef.current);
      watchdogRef.current = window.setTimeout(() => {
        // Half-open link (e.g. network drop): force the reconnect path.
        try {
          socket.close();
        } catch {
          // already closed
        }
      }, WATCHDOG_MS);
    };

    socket.onopen = () => {
      attemptRef.current = 0;
      setState("online");
      armWatchdog();
      if (wasOfflineRef.current) {
        wasOfflineRef.current = false;
        void queryClient.invalidateQueries();
      }
    };
    socket.onmessage = () => armWatchdog();
    socket.onclose = () => {
      if (socketRef.current !== socket) return;
      socketRef.current = null;
      clearTimers();
      wasOfflineRef.current = true;
      setState("offline");
      const delay = Math.min(MAX_RETRY_MS, 1000 * 2 ** Math.min(attemptRef.current, 4));
      attemptRef.current += 1;
      retryTimerRef.current = window.setTimeout(connect, delay);
    };
    socket.onerror = () => {
      // onclose always follows; reconnect logic lives there.
    };
  }, [clearTimers, queryClient]);

  useEffect(() => {
    connect();
    return () => {
      clearTimers();
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        try {
          socket.close();
        } catch {
          // already closed
        }
      }
    };
  }, [connect, clearTimers]);

  const retry = useCallback(() => {
    attemptRef.current = 0;
    connect();
  }, [connect]);

  return (
    <ConnectionContext.Provider value={{ state, retry }}>{children}</ConnectionContext.Provider>
  );
}

/** Dims and blocks the whole app while the manager is unreachable. */
export function ConnectionGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { state, retry } = useConnection();
  const offline = state === "offline";

  return (
    <>
      <div
        aria-hidden={offline || undefined}
        className={offline ? "pointer-events-none opacity-50" : undefined}
        inert={offline ? true : undefined}
      >
        {children}
      </div>
      {offline && (
        <div className="bg-background/80 fixed inset-0 z-[60] flex items-center justify-center p-6 backdrop-blur-sm">
          <div className="border-border bg-card grid w-full max-w-sm gap-3 border p-6 text-center">
            <div className="border-warning/40 bg-warning/10 mx-auto flex size-10 items-center justify-center border">
              <WifiOff className="text-warning size-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">{t("connection.lost")}</p>
              <p className="text-muted-foreground mt-1 text-xs">{t("connection.hint")}</p>
            </div>
            <Button onClick={retry} variant="accent-primary">
              {t("connection.retry")}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
