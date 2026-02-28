export type HandlerType =
  | "start"
  | "exit"
  | "codergen"
  | "wait.human"
  | "conditional"
  | "parallel"
  | "parallel.fan_in"
  | "tool"
  | "stack.manager_loop"
  | "custom";

export interface DotNode {
  id: string;
  attrs: Record<string, string>;
  label: string;
  prompt: string;
  shape: string;
  type: HandlerType;
}

export interface DotEdge {
  from: string;
  to: string;
  attrs: Record<string, string>;
  label: string;
  condition: string;
  weight: number;
}

export interface DotGraph {
  name: string;
  graphAttrs: Record<string, string>;
  nodeDefaults: Record<string, string>;
  edgeDefaults: Record<string, string>;
  nodes: Record<string, DotNode>;
  nodeOrder: string[];
  edges: DotEdge[];
}

export interface EngineState {
  context: Record<string, unknown>;
  nodeOutputs: Record<string, string>;
  parallelOutputs: Record<string, Record<string, string>>;
}

export interface CodergenInvocation {
  node: DotNode;
  prompt: string;
  state: EngineState;
}

export interface ToolInvocation {
  node: DotNode;
  state: EngineState;
}

export interface HumanQuestion {
  nodeId: string;
  prompt: string;
  options?: string[];
  timeoutMs?: number;
}

export interface EngineEvent {
  type: string;
  nodeId?: string;
  payload?: unknown;
}

export interface EngineCallbacks {
  codergen: (input: CodergenInvocation) => Promise<string>;
  tool?: (input: ToolInvocation) => Promise<string>;
  waitForHuman?: (question: HumanQuestion) => Promise<string>;
  customHandlers?: Record<string, (node: DotNode, state: EngineState) => Promise<string>>;
  onEvent?: (event: EngineEvent) => Promise<void> | void;
  saveCheckpoint?: (nodeId: string, state: EngineState) => Promise<void>;
  saveOutcome?: (nodeId: string, status: string, payload: unknown, attempt: number) => Promise<void>;
}

export interface ExecuteGraphInput {
  graph: DotGraph;
  initialState?: EngineState;
  startNodeId?: string;
  callbacks: EngineCallbacks;
  maxSteps?: number;
}

export interface ExecuteGraphResult {
  state: EngineState;
  exitNodeId: string;
}
