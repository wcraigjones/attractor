import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "../components/ui/toast";

import {
  getGlobalAttractor,
  getGlobalAttractorVersion,
  getProjectAttractor,
  getProjectAttractorVersion,
  listGlobalAttractorVersions,
  listProjectAttractorVersions,
  updateGlobalAttractor,
  updateProjectAttractor
} from "../lib/api";
import type {
  AttractorDef,
  AttractorDiagnostic,
  AttractorVersion,
  GlobalAttractor,
  RunModelConfig,
  RunType
} from "../lib/types";
import { lintDotGraph, parseDotGraph, serializeDotGraphCanonical, type DotGraph } from "@attractor/dot-engine";
import { PageTitle } from "../components/layout/page-title";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Textarea } from "../components/ui/textarea";

const MonacoEditor = lazy(async () => {
  const module = await import("@monaco-editor/react");
  return { default: module.default };
});

const MonacoDiffEditor = lazy(async () => {
  const module = await import("@monaco-editor/react");
  return { default: module.DiffEditor };
});

interface LayoutNode {
  id: string;
  x: number;
  y: number;
}

function layoutNodes(nodeIds: string[]): { nodes: LayoutNode[]; width: number; height: number } {
  const count = Math.max(1, nodeIds.length);
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rowHeight = 130;
  const colWidth = 220;
  const rows = Math.ceil(count / columns);
  const width = Math.max(800, columns * colWidth + 120);
  const height = Math.max(300, rows * rowHeight + 120);

  const nodes = nodeIds.map((id, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    return {
      id,
      x: 80 + col * colWidth,
      y: 70 + row * rowHeight
    };
  });
  return { nodes, width, height };
}

function severityVariant(
  severity: AttractorDiagnostic["severity"]
): "destructive" | "warning" | "secondary" {
  if (severity === "ERROR") {
    return "destructive";
  }
  if (severity === "WARNING") {
    return "warning";
  }
  return "secondary";
}

function useParsedGraph(content: string): {
  graph: DotGraph | null;
  diagnostics: AttractorDiagnostic[];
  parseError: string | null;
} {
  return useMemo(() => {
    try {
      const parsed = parseDotGraph(content);
      const diagnostics = lintDotGraph(parsed) as AttractorDiagnostic[];
      return {
        graph: parsed,
        diagnostics,
        parseError: null
      };
    } catch (error) {
      return {
        graph: null,
        diagnostics: [
          {
            rule: "parse_error",
            severity: "ERROR",
            message: error instanceof Error ? error.message : String(error)
          }
        ],
        parseError: error instanceof Error ? error.message : String(error)
      };
    }
  }, [content]);
}

function formatVersionLabel(version: AttractorVersion): string {
  return `v${version.version} • ${new Date(version.createdAt).toLocaleString()}`;
}

const DEFAULT_ATTRACTOR_MODEL_CONFIG: RunModelConfig = {
  provider: "anthropic",
  modelId: "claude-sonnet-4-20250514",
  reasoningLevel: "high",
  temperature: 0.2
};

function GraphSvg(props: {
  graph: DotGraph;
  selectedNodeId: string | null;
  selectedEdgeIndex: number | null;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeIndex: number) => void;
  readOnly?: boolean;
}) {
  const orderedNodeIds = props.graph.nodeOrder.filter((nodeId) => Boolean(props.graph.nodes[nodeId]));
  const layout = layoutNodes(orderedNodeIds);
  const nodeById = new Map(layout.nodes.map((item) => [item.id, item]));

  return (
    <div className="overflow-auto rounded-md border border-border bg-muted/20 p-2">
      <svg width={layout.width} height={layout.height} role="img" aria-label="Attractor graph preview">
        <defs>
          <marker id="arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L10,4 L0,8 z" fill="#64748b" />
          </marker>
        </defs>

        {props.graph.edges.map((edge, index) => {
          const from = nodeById.get(edge.from);
          const to = nodeById.get(edge.to);
          if (!from || !to) {
            return null;
          }
          const selected = props.selectedEdgeIndex === index;
          const startX = from.x + 70;
          const startY = from.y + 26;
          const endX = to.x + 70;
          const endY = to.y + 26;
          const labelX = (startX + endX) / 2;
          const labelY = (startY + endY) / 2 - 8;

          return (
            <g key={`${edge.from}-${edge.to}-${index}`}>
              <line
                x1={startX}
                y1={startY}
                x2={endX}
                y2={endY}
                stroke={selected ? "#2563eb" : "#64748b"}
                strokeWidth={selected ? 2.5 : 1.5}
                markerEnd="url(#arrow)"
                onClick={() => {
                  if (!props.readOnly) {
                    props.onSelectEdge(index);
                  }
                }}
                className={props.readOnly ? undefined : "cursor-pointer"}
              />
              {edge.label.trim().length > 0 ? (
                <text x={labelX} y={labelY} textAnchor="middle" className="fill-slate-700 text-[11px]">
                  {edge.label}
                </text>
              ) : null}
            </g>
          );
        })}

        {layout.nodes.map((node) => {
          const graphNode = props.graph.nodes[node.id];
          if (!graphNode) {
            return null;
          }
          const selected = props.selectedNodeId === node.id;
          return (
            <g
              key={node.id}
              onClick={() => {
                if (!props.readOnly) {
                  props.onSelectNode(node.id);
                }
              }}
              className={props.readOnly ? undefined : "cursor-pointer"}
            >
              <rect
                x={node.x}
                y={node.y}
                rx={8}
                ry={8}
                width={140}
                height={52}
                fill={selected ? "#dbeafe" : "#ffffff"}
                stroke={selected ? "#2563eb" : "#94a3b8"}
                strokeWidth={selected ? 2.5 : 1.2}
              />
              <text x={node.x + 70} y={node.y + 20} textAnchor="middle" className="fill-slate-800 text-[12px] font-semibold">
                {graphNode.label}
              </text>
              <text x={node.x + 70} y={node.y + 37} textAnchor="middle" className="fill-slate-500 text-[10px]">
                {graphNode.type}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function AttractorStudioContent(props: {
  scope: "project" | "global";
  projectId?: string;
  attractorId: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const tab = searchParams.get("tab") === "viewer" ? "viewer" : "editor";
  const [name, setName] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [defaultRunType, setDefaultRunType] = useState<RunType>("planning");
  const [modelProvider, setModelProvider] = useState(DEFAULT_ATTRACTOR_MODEL_CONFIG.provider);
  const [modelId, setModelId] = useState(DEFAULT_ATTRACTOR_MODEL_CONFIG.modelId);
  const [reasoningLevel, setReasoningLevel] = useState<
    "minimal" | "low" | "medium" | "high" | "xhigh"
  >(DEFAULT_ATTRACTOR_MODEL_CONFIG.reasoningLevel ?? "high");
  const [description, setDescription] = useState("");
  const [active, setActive] = useState(true);
  const [content, setContent] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeIndex, setSelectedEdgeIndex] = useState<number | null>(null);
  const [newEdgeFrom, setNewEdgeFrom] = useState("");
  const [newEdgeTo, setNewEdgeTo] = useState("");
  const [newEdgeLabel, setNewEdgeLabel] = useState("");
  const [graphAttrsJson, setGraphAttrsJson] = useState("{}");
  const [nodeAttrsJson, setNodeAttrsJson] = useState("{}");
  const [edgeAttrsJson, setEdgeAttrsJson] = useState("{}");
  const [diffVersionContent, setDiffVersionContent] = useState<string | null>(null);
  const [diffVersionLabel, setDiffVersionLabel] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ["attractor-detail", props.scope, props.projectId, props.attractorId],
    queryFn: () => {
      if (props.scope === "global") {
        return getGlobalAttractor(props.attractorId);
      }
      return getProjectAttractor(props.projectId ?? "", props.attractorId);
    },
    enabled: props.attractorId.length > 0 && (props.scope === "global" || (props.projectId ?? "").length > 0)
  });

  const versionsQuery = useQuery({
    queryKey: ["attractor-versions", props.scope, props.projectId, props.attractorId],
    queryFn: () => {
      if (props.scope === "global") {
        return listGlobalAttractorVersions(props.attractorId);
      }
      return listProjectAttractorVersions(props.projectId ?? "", props.attractorId);
    },
    enabled: detailQuery.isSuccess
  });

  useEffect(() => {
    if (!detailQuery.data) {
      return;
    }
    const attractor = detailQuery.data.attractor as AttractorDef | GlobalAttractor;
    setName(attractor.name);
    setRepoPath(attractor.repoPath ?? "");
    setDefaultRunType(attractor.defaultRunType);
    const nextModelConfig = attractor.modelConfig ?? DEFAULT_ATTRACTOR_MODEL_CONFIG;
    setModelProvider(nextModelConfig.provider);
    setModelId(nextModelConfig.modelId);
    setReasoningLevel(nextModelConfig.reasoningLevel ?? "high");
    setDescription(attractor.description ?? "");
    setActive(attractor.active);
    setContent(detailQuery.data.content ?? "");
  }, [detailQuery.data]);

  const parsedGraph = useParsedGraph(content);
  const errorCount = parsedGraph.diagnostics.filter((item) => item.severity === "ERROR").length;
  const warningCount = parsedGraph.diagnostics.filter((item) => item.severity === "WARNING").length;

  useEffect(() => {
    if (!parsedGraph.graph) {
      setGraphAttrsJson("{}");
      return;
    }
    setGraphAttrsJson(JSON.stringify(parsedGraph.graph.graphAttrs, null, 2));
  }, [parsedGraph.graph]);

  useEffect(() => {
    if (!parsedGraph.graph || !selectedNodeId || !parsedGraph.graph.nodes[selectedNodeId]) {
      setNodeAttrsJson("{}");
      return;
    }
    setNodeAttrsJson(JSON.stringify(parsedGraph.graph.nodes[selectedNodeId].attrs, null, 2));
  }, [parsedGraph.graph, selectedNodeId]);

  useEffect(() => {
    if (!parsedGraph.graph || selectedEdgeIndex === null || !parsedGraph.graph.edges[selectedEdgeIndex]) {
      setEdgeAttrsJson("{}");
      return;
    }
    setEdgeAttrsJson(JSON.stringify(parsedGraph.graph.edges[selectedEdgeIndex].attrs, null, 2));
  }, [parsedGraph.graph, selectedEdgeIndex]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!modelProvider.trim() || !modelId.trim()) {
        throw new Error("Model provider and model id are required");
      }
      const currentVersion = detailQuery.data?.attractor.contentVersion ?? 0;
      const modelConfig: RunModelConfig = {
        provider: modelProvider.trim(),
        modelId: modelId.trim(),
        reasoningLevel,
        temperature: 0.2
      };
      if (props.scope === "global") {
        return updateGlobalAttractor(props.attractorId, {
          expectedContentVersion: currentVersion,
          name: name.trim(),
          content,
          repoPath: repoPath.trim().length > 0 ? repoPath.trim() : null,
          defaultRunType,
          modelConfig,
          description: description.trim().length > 0 ? description.trim() : null,
          active
        });
      }
      return updateProjectAttractor(props.projectId ?? "", props.attractorId, {
        expectedContentVersion: currentVersion,
        name: name.trim(),
        content,
        repoPath: repoPath.trim().length > 0 ? repoPath.trim() : null,
        defaultRunType,
        modelConfig,
        description: description.trim().length > 0 ? description.trim() : null,
        active
      });
    },
    onSuccess: (payload) => {
      toast.success("Attractor saved");
      setContent(payload.content ?? "");
      void queryClient.invalidateQueries({
        queryKey: ["attractor-detail", props.scope, props.projectId, props.attractorId]
      });
      void queryClient.invalidateQueries({
        queryKey: ["attractor-versions", props.scope, props.projectId, props.attractorId]
      });
      void queryClient.invalidateQueries({ queryKey: ["attractors", props.projectId] });
      void queryClient.invalidateQueries({ queryKey: ["global-attractors"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error));
      void queryClient.invalidateQueries({
        queryKey: ["attractor-detail", props.scope, props.projectId, props.attractorId]
      });
    }
  });

  const loadVersion = async (version: AttractorVersion, applyToEditor: boolean) => {
    try {
      const payload =
        props.scope === "global"
          ? await getGlobalAttractorVersion(props.attractorId, version.version)
          : await getProjectAttractorVersion(props.projectId ?? "", props.attractorId, version.version);
      setDiffVersionContent(payload.content ?? "");
      setDiffVersionLabel(formatVersionLabel(version));
      if (applyToEditor) {
        setContent(payload.content ?? "");
        toast.success(`Loaded ${formatVersionLabel(version)} into editor`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const mutateGraph = (mutator: (graph: DotGraph) => void) => {
    if (!parsedGraph.graph) {
      toast.error("DOT must parse before visual edits can be applied");
      return;
    }
    const next = structuredClone(parsedGraph.graph);
    mutator(next);
    setContent(serializeDotGraphCanonical(next));
  };

  const selectedNode = selectedNodeId && parsedGraph.graph ? parsedGraph.graph.nodes[selectedNodeId] : null;
  const selectedEdge =
    selectedEdgeIndex !== null && parsedGraph.graph
      ? parsedGraph.graph.edges[selectedEdgeIndex] ?? null
      : null;

  const versions = versionsQuery.data ?? [];

  if (detailQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading attractor...</p>;
  }
  if (!detailQuery.data) {
    return <p className="text-sm text-destructive">Failed to load attractor.</p>;
  }

  const attractor = detailQuery.data.attractor;
  const backTo =
    props.scope === "global"
      ? "/attractors/global"
      : `/projects/${props.projectId ?? ""}/attractors`;

  return (
    <div>
      <PageTitle
        title={`${attractor.name} Studio`}
        description={props.scope === "global" ? "Global attractor editor/viewer" : "Project attractor editor/viewer"}
        actions={
          <>
            <Button asChild variant="outline">
              <Link to={backTo}>Back</Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                try {
                  const parsed = parseDotGraph(content);
                  setContent(serializeDotGraphCanonical(parsed));
                  toast.success("DOT formatted using canonical serializer");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : String(error));
                }
              }}
            >
              Format Canonical
            </Button>
            <Button
              onClick={() => {
                saveMutation.mutate();
              }}
              disabled={saveMutation.isPending || name.trim().length === 0 || errorCount > 0}
            >
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge variant="secondary">Version {attractor.contentVersion > 0 ? attractor.contentVersion : "legacy"}</Badge>
        <Badge variant={errorCount > 0 ? "destructive" : "success"}>{errorCount} errors</Badge>
        <Badge variant={warningCount > 0 ? "warning" : "secondary"}>{warningCount} warnings</Badge>
        <Badge variant={attractor.contentPath ? "success" : "warning"}>
          {attractor.contentPath ? "Storage-backed" : "Legacy (repoPath only)"}
        </Badge>
      </div>

      <div className="mb-4 flex gap-2">
        <Button
          variant={tab === "editor" ? "default" : "outline"}
          onClick={() => {
            const next = new URLSearchParams(searchParams);
            next.set("tab", "editor");
            setSearchParams(next, { replace: true });
          }}
        >
          Editor
        </Button>
        <Button
          variant={tab === "viewer" ? "default" : "outline"}
          onClick={() => {
            const next = new URLSearchParams(searchParams);
            next.set("tab", "viewer");
            setSearchParams(next, { replace: true });
          }}
        >
          Viewer
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[2fr,1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{tab === "editor" ? "Visual Builder" : "Graph Viewer"}</CardTitle>
            <CardDescription>
              {tab === "editor"
                ? "Canvas-first editing with node/edge inspectors and advanced attribute JSON editors."
                : "Read-only graph rendering from current DOT content."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {parsedGraph.graph ? (
              <GraphSvg
                graph={parsedGraph.graph}
                selectedNodeId={selectedNodeId}
                selectedEdgeIndex={selectedEdgeIndex}
                onSelectNode={(nodeId) => {
                  setSelectedNodeId(nodeId);
                  setSelectedEdgeIndex(null);
                }}
                onSelectEdge={(edgeIndex) => {
                  setSelectedEdgeIndex(edgeIndex);
                  setSelectedNodeId(null);
                }}
                readOnly={tab === "viewer"}
              />
            ) : (
              <p className="text-sm text-destructive">{parsedGraph.parseError ?? "DOT parse error"}</p>
            )}

            {tab === "editor" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2 rounded-md border border-border p-3">
                  <Label>Node Actions</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      mutateGraph((graph) => {
                        const base = "node";
                        let index = graph.nodeOrder.length + 1;
                        let candidate = `${base}_${index}`;
                        while (graph.nodes[candidate]) {
                          index += 1;
                          candidate = `${base}_${index}`;
                        }
                        graph.nodes[candidate] = {
                          id: candidate,
                          attrs: {
                            shape: "box",
                            type: "codergen",
                            label: candidate,
                            prompt: ""
                          },
                          label: candidate,
                          prompt: "",
                          shape: "box",
                          type: "codergen"
                        };
                        graph.nodeOrder.push(candidate);
                      });
                    }}
                  >
                    Add Node
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!selectedNodeId}
                    onClick={() => {
                      if (!selectedNodeId) {
                        return;
                      }
                      mutateGraph((graph) => {
                        delete graph.nodes[selectedNodeId];
                        graph.nodeOrder = graph.nodeOrder.filter((nodeId) => nodeId !== selectedNodeId);
                        graph.edges = graph.edges.filter(
                          (edge) => edge.from !== selectedNodeId && edge.to !== selectedNodeId
                        );
                      });
                      setSelectedNodeId(null);
                    }}
                  >
                    Delete Selected Node
                  </Button>
                </div>

                <div className="space-y-2 rounded-md border border-border p-3">
                  <Label>Add Edge</Label>
                  <Select value={newEdgeFrom.length > 0 ? newEdgeFrom : undefined} onValueChange={setNewEdgeFrom}>
                    <SelectTrigger>
                      <SelectValue placeholder="From node" />
                    </SelectTrigger>
                    <SelectContent>
                      {(parsedGraph.graph?.nodeOrder ?? []).map((nodeId) => (
                        <SelectItem key={`from-${nodeId}`} value={nodeId}>
                          {nodeId}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={newEdgeTo.length > 0 ? newEdgeTo : undefined} onValueChange={setNewEdgeTo}>
                    <SelectTrigger>
                      <SelectValue placeholder="To node" />
                    </SelectTrigger>
                    <SelectContent>
                      {(parsedGraph.graph?.nodeOrder ?? []).map((nodeId) => (
                        <SelectItem key={`to-${nodeId}`} value={nodeId}>
                          {nodeId}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={newEdgeLabel}
                    onChange={(event) => setNewEdgeLabel(event.target.value)}
                    placeholder="Edge label"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!newEdgeFrom || !newEdgeTo}
                    onClick={() => {
                      mutateGraph((graph) => {
                        graph.edges.push({
                          from: newEdgeFrom,
                          to: newEdgeTo,
                          attrs: {
                            ...(newEdgeLabel.trim().length > 0 ? { label: newEdgeLabel.trim() } : {})
                          },
                          label: newEdgeLabel.trim(),
                          condition: "",
                          weight: 0
                        });
                      });
                      setNewEdgeLabel("");
                    }}
                  >
                    Add Edge
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={selectedEdgeIndex === null}
                    onClick={() => {
                      if (selectedEdgeIndex === null) {
                        return;
                      }
                      mutateGraph((graph) => {
                        graph.edges = graph.edges.filter((_, index) => index !== selectedEdgeIndex);
                      });
                      setSelectedEdgeIndex(null);
                    }}
                  >
                    Delete Selected Edge
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Inspector</CardTitle>
            <CardDescription>Metadata, typed fields, advanced JSON attributes, and version history.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={name} onChange={(event) => setName(event.target.value)} disabled={tab === "viewer"} />
            </div>
            <div className="space-y-1">
              <Label>Source Label (repoPath)</Label>
              <Input value={repoPath} onChange={(event) => setRepoPath(event.target.value)} disabled={tab === "viewer"} />
            </div>
            <div className="space-y-1">
              <Label>Default Run Type</Label>
              <Select value={defaultRunType} onValueChange={(value: RunType) => setDefaultRunType(value)} disabled={tab === "viewer"}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="planning">planning</SelectItem>
                  <SelectItem value="implementation">implementation</SelectItem>
                  <SelectItem value="task">task</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Model Provider</Label>
              <Input value={modelProvider} onChange={(event) => setModelProvider(event.target.value)} disabled={tab === "viewer"} />
            </div>
            <div className="space-y-1">
              <Label>Model ID</Label>
              <Input value={modelId} onChange={(event) => setModelId(event.target.value)} disabled={tab === "viewer"} />
            </div>
            <div className="space-y-1">
              <Label>Reasoning</Label>
              <Select
                value={reasoningLevel}
                onValueChange={(value: "minimal" | "low" | "medium" | "high" | "xhigh") => setReasoningLevel(value)}
                disabled={tab === "viewer"}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minimal">minimal</SelectItem>
                  <SelectItem value="low">low</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="high">high</SelectItem>
                  <SelectItem value="xhigh">xhigh</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={active ? "active" : "inactive"} onValueChange={(value) => setActive(value === "active")} disabled={tab === "viewer"}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea value={description} onChange={(event) => setDescription(event.target.value)} disabled={tab === "viewer"} />
            </div>

            <div className="space-y-1">
              <Label>Graph Attributes (JSON)</Label>
              <Textarea
                className="min-h-[120px] font-mono text-xs"
                value={graphAttrsJson}
                onChange={(event) => setGraphAttrsJson(event.target.value)}
                disabled={tab === "viewer"}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={tab === "viewer"}
                onClick={() => {
                  try {
                    const parsed = JSON.parse(graphAttrsJson) as Record<string, unknown>;
                    const attrs = Object.fromEntries(
                      Object.entries(parsed).map(([key, value]) => [key, String(value)])
                    );
                    mutateGraph((graph) => {
                      graph.graphAttrs = attrs;
                    });
                    toast.success("Graph attributes updated");
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : String(error));
                  }
                }}
              >
                Apply Graph Attr JSON
              </Button>
            </div>

            {selectedNode ? (
              <div className="space-y-1 rounded-md border border-border p-2">
                <p className="text-sm font-medium">Selected Node: {selectedNode.id}</p>
                <Input
                  value={selectedNode.attrs.label ?? ""}
                  onChange={(event) => {
                    const next = event.target.value;
                    mutateGraph((graph) => {
                      const node = graph.nodes[selectedNode.id];
                      if (!node) {
                        return;
                      }
                      node.attrs.label = next;
                      node.label = next;
                    });
                  }}
                  disabled={tab === "viewer"}
                  placeholder="label"
                />
                <Input
                  value={selectedNode.attrs.type ?? ""}
                  onChange={(event) => {
                    const next = event.target.value;
                    mutateGraph((graph) => {
                      const node = graph.nodes[selectedNode.id];
                      if (!node) {
                        return;
                      }
                      node.attrs.type = next;
                    });
                  }}
                  disabled={tab === "viewer"}
                  placeholder="type"
                />
                <Input
                  value={selectedNode.attrs.shape ?? ""}
                  onChange={(event) => {
                    const next = event.target.value;
                    mutateGraph((graph) => {
                      const node = graph.nodes[selectedNode.id];
                      if (!node) {
                        return;
                      }
                      node.attrs.shape = next;
                      node.shape = next;
                    });
                  }}
                  disabled={tab === "viewer"}
                  placeholder="shape"
                />
                <Textarea
                  className="min-h-[120px] font-mono text-xs"
                  value={nodeAttrsJson}
                  onChange={(event) => setNodeAttrsJson(event.target.value)}
                  disabled={tab === "viewer"}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={tab === "viewer"}
                  onClick={() => {
                    try {
                      const parsed = JSON.parse(nodeAttrsJson) as Record<string, unknown>;
                      const attrs = Object.fromEntries(
                        Object.entries(parsed).map(([key, value]) => [key, String(value)])
                      );
                      mutateGraph((graph) => {
                        const node = graph.nodes[selectedNode.id];
                        if (!node) {
                          return;
                        }
                        node.attrs = attrs;
                        node.label = attrs.label ?? node.id;
                        node.prompt = attrs.prompt ?? "";
                        node.shape = attrs.shape ?? "box";
                      });
                      toast.success("Node attributes updated");
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : String(error));
                    }
                  }}
                >
                  Apply Node Attr JSON
                </Button>
              </div>
            ) : null}

            {selectedEdge ? (
              <div className="space-y-1 rounded-md border border-border p-2">
                <p className="text-sm font-medium">
                  Selected Edge: {selectedEdge.from} -&gt; {selectedEdge.to}
                </p>
                <Input
                  value={selectedEdge.attrs.label ?? ""}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (selectedEdgeIndex === null) {
                      return;
                    }
                    mutateGraph((graph) => {
                      const edge = graph.edges[selectedEdgeIndex];
                      if (!edge) {
                        return;
                      }
                      edge.attrs.label = next;
                      edge.label = next;
                    });
                  }}
                  disabled={tab === "viewer"}
                  placeholder="label"
                />
                <Input
                  value={selectedEdge.attrs.condition ?? ""}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (selectedEdgeIndex === null) {
                      return;
                    }
                    mutateGraph((graph) => {
                      const edge = graph.edges[selectedEdgeIndex];
                      if (!edge) {
                        return;
                      }
                      edge.attrs.condition = next;
                      edge.condition = next;
                    });
                  }}
                  disabled={tab === "viewer"}
                  placeholder="condition"
                />
                <Textarea
                  className="min-h-[120px] font-mono text-xs"
                  value={edgeAttrsJson}
                  onChange={(event) => setEdgeAttrsJson(event.target.value)}
                  disabled={tab === "viewer"}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={tab === "viewer"}
                  onClick={() => {
                    try {
                      if (selectedEdgeIndex === null) {
                        return;
                      }
                      const parsed = JSON.parse(edgeAttrsJson) as Record<string, unknown>;
                      const attrs = Object.fromEntries(
                        Object.entries(parsed).map(([key, value]) => [key, String(value)])
                      );
                      mutateGraph((graph) => {
                        const edge = graph.edges[selectedEdgeIndex];
                        if (!edge) {
                          return;
                        }
                        edge.attrs = attrs;
                        edge.label = attrs.label ?? "";
                        edge.condition = attrs.condition ?? "";
                        edge.weight = Number.parseInt(attrs.weight ?? "0", 10) || 0;
                      });
                      toast.success("Edge attributes updated");
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : String(error));
                    }
                  }}
                >
                  Apply Edge Attr JSON
                </Button>
              </div>
            ) : null}

            <div className="space-y-2 rounded-md border border-border p-2">
              <p className="text-sm font-medium">Version History</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Version</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {versions.map((version) => (
                    <TableRow key={version.id}>
                      <TableCell className="text-xs">{formatVersionLabel(version)}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              void loadVersion(version, false);
                            }}
                          >
                            Diff
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={tab === "viewer"}
                            onClick={() => {
                              void loadVersion(version, true);
                            }}
                          >
                            Restore
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {versions.length === 0 ? (
                <p className="text-xs text-muted-foreground">No versions recorded yet.</p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Raw DOT</CardTitle>
          <CardDescription>Advanced editor panel. Visual and text views both write canonical DOT.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Loading editor...</div>}>
            <MonacoEditor
              height="38vh"
              value={content}
              language="plaintext"
              theme="vs-light"
              onChange={(value) => setContent(value ?? "")}
              options={{
                readOnly: tab === "viewer",
                minimap: { enabled: false },
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                fontSize: 13,
                wordWrap: "on"
              }}
            />
          </Suspense>
        </CardContent>
      </Card>

      {diffVersionContent !== null ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Version Diff</CardTitle>
            <CardDescription>{diffVersionLabel ?? "Selected version"}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Loading diff editor...</div>}>
              <MonacoDiffEditor
                height="34vh"
                original={diffVersionContent}
                modified={content}
                language="plaintext"
                theme="vs-light"
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  fontSize: 13,
                  wordWrap: "on"
                }}
              />
            </Suspense>
          </CardContent>
        </Card>
      ) : null}

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Diagnostics</CardTitle>
          <CardDescription>Parser and linter diagnostics from the current DOT content.</CardDescription>
        </CardHeader>
        <CardContent>
          {parsedGraph.diagnostics.length === 0 ? (
            <p className="text-sm text-muted-foreground">No diagnostics.</p>
          ) : (
            <div className="space-y-2">
              {parsedGraph.diagnostics.map((diagnostic, index) => (
                <div key={`${diagnostic.rule}-${index}`} className="rounded-md border border-border p-2">
                  <div className="mb-1 flex items-center gap-2">
                    <Badge variant={severityVariant(diagnostic.severity)}>{diagnostic.severity}</Badge>
                    <span className="mono text-xs">{diagnostic.rule}</span>
                    {diagnostic.nodeId ? <Badge variant="outline">node: {diagnostic.nodeId}</Badge> : null}
                    {diagnostic.edge ? (
                      <Badge variant="outline">
                        edge: {diagnostic.edge.from} -&gt; {diagnostic.edge.to}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-sm">{diagnostic.message}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 flex gap-2">
        {props.scope === "project" && props.projectId ? (
          <Button
            variant="outline"
            onClick={() => {
              navigate(`/projects/${props.projectId}/runs?attractorDefId=${attractor.id}`);
            }}
          >
            Run With This Attractor
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function ProjectAttractorStudioPage() {
  const params = useParams<{ projectId: string; attractorId: string }>();
  const projectId = params.projectId ?? "";
  const attractorId = params.attractorId ?? "";

  if (!projectId || !attractorId) {
    return <p className="text-sm text-destructive">Missing project or attractor identifier.</p>;
  }

  return <AttractorStudioContent scope="project" projectId={projectId} attractorId={attractorId} />;
}

export function GlobalAttractorStudioPage() {
  const params = useParams<{ attractorId: string }>();
  const attractorId = params.attractorId ?? "";

  if (!attractorId) {
    return <p className="text-sm text-destructive">Missing attractor identifier.</p>;
  }

  return <AttractorStudioContent scope="global" attractorId={attractorId} />;
}
