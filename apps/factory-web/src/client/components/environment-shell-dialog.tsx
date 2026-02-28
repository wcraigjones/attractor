import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { toast } from "sonner";
import "@xterm/xterm/css/xterm.css";

import {
  buildWebSocketUrl,
  createEnvironmentShellSession,
  listProjects,
  terminateEnvironmentShellSession
} from "../lib/api";
import { parseEnvironmentShellServerMessage } from "../lib/environment-shell";
import type {
  Environment,
  EnvironmentShellClientMessage,
  EnvironmentShellMode,
  EnvironmentShellSession
} from "../lib/types";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

interface EnvironmentShellDialogProps {
  open: boolean;
  environment: Environment | null;
  defaultProjectId?: string;
  onClose: () => void;
}

export function EnvironmentShellDialog(props: EnvironmentShellDialogProps) {
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [mode, setMode] = useState<EnvironmentShellMode>("project");
  const [projectId, setProjectId] = useState("");
  const [injectSecrets, setInjectSecrets] = useState(true);
  const [status, setStatus] = useState<"idle" | "starting pod" | "connecting" | "ready" | "disconnected" | "error">(
    "idle"
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [session, setSession] = useState<EnvironmentShellSession | null>(null);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    enabled: props.open
  });

  useEffect(() => {
    if (!props.open) {
      return;
    }
    setMode("project");
    setInjectSecrets(true);
    setStatus("idle");
    setErrorMessage(null);
    setSession(null);
    setProjectId(props.defaultProjectId ?? "");
  }, [props.defaultProjectId, props.open]);

  useEffect(() => {
    if (!props.open || projectId.length > 0) {
      return;
    }
    const fallbackProjectId = projectsQuery.data?.[0]?.id;
    if (fallbackProjectId) {
      setProjectId(fallbackProjectId);
    }
  }, [projectId, projectsQuery.data, props.open]);

  const terminateMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      await terminateEnvironmentShellSession(sessionId);
    }
  });

  const launchMutation = useMutation({
    mutationFn: async () => {
      if (!props.environment) {
        throw new Error("Select an environment first");
      }
      if (mode === "project" && projectId.trim().length === 0) {
        throw new Error("Project is required for project shell mode");
      }
      return createEnvironmentShellSession(props.environment.id, {
        mode,
        ...(mode === "project" ? { projectId } : {}),
        injectSecrets
      });
    },
    onMutate: () => {
      setStatus("starting pod");
      setErrorMessage(null);
    },
    onSuccess: (createdSession) => {
      setSession(createdSession);
      sessionIdRef.current = createdSession.id;
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      setStatus("error");
      setErrorMessage(message);
      toast.error(message);
    }
  });

  const availableProjects = projectsQuery.data ?? [];

  const canLaunch = useMemo(() => {
    if (!props.environment) {
      return false;
    }
    if (mode === "project" && projectId.length === 0) {
      return false;
    }
    return !launchMutation.isPending && !session;
  }, [launchMutation.isPending, mode, projectId, props.environment, session]);

  useEffect(() => {
    if (!props.open || !session || !terminalHostRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "Menlo, Monaco, monospace",
      fontSize: 12,
      convertEol: true
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalHostRef.current);
    fitAddon.fit();
    terminal.writeln(`Session ${session.id}`);
    terminal.writeln(`Namespace: ${session.namespace}`);
    terminal.writeln("");
    terminalRef.current = terminal;
    fitRef.current = fitAddon;

    const socket = new WebSocket(buildWebSocketUrl(session.streamPath));
    socketRef.current = socket;
    setStatus("connecting");

    const sendClientMessage = (message: EnvironmentShellClientMessage) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    };

    const sendResize = () => {
      fitAddon.fit();
      const cols = terminal.cols;
      const rows = terminal.rows;
      if (cols > 0 && rows > 0) {
        sendClientMessage({ type: "resize", cols, rows });
      }
    };

    const onWindowResize = () => {
      sendResize();
    };

    const onDataDisposable = terminal.onData((data) => {
      sendClientMessage({ type: "input", data });
    });

    socket.addEventListener("open", () => {
      sendResize();
    });
    socket.addEventListener("message", (event) => {
      const message = parseEnvironmentShellServerMessage(String(event.data));
      if (!message) {
        return;
      }
      if (message.type === "status") {
        setStatus(message.state);
        return;
      }
      if (message.type === "output") {
        terminal.write(message.data);
        return;
      }
      if (message.type === "error") {
        setStatus("error");
        setErrorMessage(message.message);
        terminal.writeln(`\r\n[error] ${message.message}`);
        return;
      }
      if (message.type === "exit") {
        setStatus("disconnected");
        terminal.writeln("\r\n[session ended]");
      }
    });
    socket.addEventListener("close", () => {
      setStatus("disconnected");
    });
    socket.addEventListener("error", () => {
      setStatus("error");
      setErrorMessage("WebSocket connection failed");
    });

    window.addEventListener("resize", onWindowResize);
    return () => {
      window.removeEventListener("resize", onWindowResize);
      onDataDisposable.dispose();
      socket.close();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      socketRef.current = null;
    };
  }, [props.open, session]);

  useEffect(() => {
    return () => {
      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId) {
        return;
      }
      void terminateEnvironmentShellSession(activeSessionId).catch(() => {});
      sessionIdRef.current = null;
    };
  }, []);

  const closeDialog = async () => {
    const activeSessionId = session?.id ?? sessionIdRef.current;
    if (activeSessionId) {
      try {
        await terminateMutation.mutateAsync(activeSessionId);
      } catch {
        // Best-effort cleanup.
      }
      sessionIdRef.current = null;
    }
    props.onClose();
  };

  if (!props.open || !props.environment) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 p-4">
      <Card className="mx-auto flex h-[90vh] w-full max-w-5xl flex-col">
        <CardHeader>
          <CardTitle>Environment Shell</CardTitle>
          <CardDescription>
            {props.environment.name} ({props.environment.kind}) on {mode === "project" ? "project namespace" : "system namespace"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label>Mode</Label>
              <Select value={mode} onValueChange={(value: EnvironmentShellMode) => setMode(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="project">project</SelectItem>
                  <SelectItem value="system">system</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Project</Label>
              <Select
                value={projectId || undefined}
                onValueChange={setProjectId}
                disabled={mode !== "project"}
              >
                <SelectTrigger>
                  <SelectValue placeholder={mode === "project" ? "Select project" : "Not required for system mode"} />
                </SelectTrigger>
                <SelectContent>
                  {availableProjects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Inject Secrets</Label>
              <Select value={injectSecrets ? "yes" : "no"} onValueChange={(value) => setInjectSecrets(value === "yes")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">yes</SelectItem>
                  <SelectItem value="no">no</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={() => launchMutation.mutate()} disabled={!canLaunch}>
              {launchMutation.isPending ? "Launching..." : "Launch Shell"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const activeSessionId = session?.id ?? sessionIdRef.current;
                if (!activeSessionId) {
                  return;
                }
                void terminateMutation.mutateAsync(activeSessionId).finally(() => {
                  setSession(null);
                  sessionIdRef.current = null;
                  setStatus("disconnected");
                });
              }}
              disabled={!session}
            >
              Terminate Session
            </Button>
            <Button variant="outline" onClick={() => void closeDialog()}>
              Close
            </Button>
            <p className="text-sm text-muted-foreground">Status: {status}</p>
          </div>

          {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}

          <div
            ref={terminalHostRef}
            className="min-h-[420px] flex-1 overflow-hidden rounded-md border border-border bg-black p-2"
          />
        </CardContent>
      </Card>
    </div>
  );
}
