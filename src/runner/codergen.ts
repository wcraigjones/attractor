import {
  streamSimple,
  validateToolCall,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type Message,
  type Tool,
  type ToolCall,
  type ToolResultMessage
} from "@mariozechner/pi-ai";

import { type RunModelConfig, validateRunModelConfig } from "../run-config.js";

export interface PriorArtifact {
  id: string;
  content: string;
}

export interface CodergenNodeInput {
  model: RunModelConfig;
  prompt: string;
  systemPrompt?: string;
  priorArtifacts?: PriorArtifact[];
  tools?: Tool[];
  maxToolRounds?: number;
  onEvent?: (event: CodergenStreamEvent) => void;
  toolHandlers?: Record<string, ToolExecutionHandler>;
}

export interface CodergenRunResult {
  rounds: number;
  finalMessage: AssistantMessage;
  finalText: string;
  messages: Message[];
}

export type ToolExecutionResult =
  | string
  | {
      text: string;
      isError?: boolean;
      details?: unknown;
    };

export type ToolExecutionHandler = (
  toolCall: ToolCall
) => Promise<ToolExecutionResult> | ToolExecutionResult;

export type CodergenStreamEvent =
  | { round: number; type: "text_delta"; delta: string }
  | { round: number; type: "thinking_delta"; delta: string }
  | { round: number; type: "toolcall_start"; contentIndex: number }
  | { round: number; type: "toolcall_delta"; contentIndex: number; delta: string }
  | {
      round: number;
      type: "toolcall_end";
      contentIndex: number;
      toolCallId: string;
      toolName: string;
    }
  | { round: number; type: "done"; reason: "stop" | "length" | "toolUse" }
  | { round: number; type: "error"; reason: "aborted" | "error"; message: string };

const DEFAULT_MAX_TOOL_ROUNDS = 8;

function composePrompt(prompt: string, priorArtifacts: PriorArtifact[]): string {
  if (priorArtifacts.length === 0) {
    return prompt;
  }

  const artifactText = priorArtifacts
    .map(
      (artifact) =>
        `Artifact ${artifact.id}:\n${artifact.content.trim()}`
    )
    .join("\n\n");

  return `${prompt}\n\nPrior stage artifacts:\n${artifactText}`;
}

export function buildCodergenContext(input: CodergenNodeInput): Context {
  const messagePrompt = composePrompt(input.prompt, input.priorArtifacts ?? []);

  return {
    ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
    messages: [
      {
        role: "user",
        content: messagePrompt,
        timestamp: Date.now()
      }
    ],
    ...(input.tools && input.tools.length > 0 ? { tools: input.tools } : {})
  };
}

function extractText(message: AssistantMessage): string {
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function toStreamEvent(
  round: number,
  event: AssistantMessageEvent
): CodergenStreamEvent | null {
  if (event.type === "text_delta") {
    return { round, type: "text_delta", delta: event.delta };
  }
  if (event.type === "thinking_delta") {
    return { round, type: "thinking_delta", delta: event.delta };
  }
  if (event.type === "toolcall_start") {
    return { round, type: "toolcall_start", contentIndex: event.contentIndex };
  }
  if (event.type === "toolcall_delta") {
    return {
      round,
      type: "toolcall_delta",
      contentIndex: event.contentIndex,
      delta: event.delta
    };
  }
  if (event.type === "toolcall_end") {
    return {
      round,
      type: "toolcall_end",
      contentIndex: event.contentIndex,
      toolCallId: event.toolCall.id,
      toolName: event.toolCall.name
    };
  }
  if (event.type === "done") {
    return { round, type: "done", reason: event.reason };
  }
  if (event.type === "error") {
    return { round, type: "error", reason: event.reason, message: event.error.errorMessage ?? "LLM error" };
  }
  return null;
}

function toToolResultMessage(
  toolCall: ToolCall,
  result: ToolExecutionResult
): ToolResultMessage {
  if (typeof result === "string") {
    return {
      role: "toolResult",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [{ type: "text", text: result }],
      isError: false,
      timestamp: Date.now()
    };
  }

  return {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [{ type: "text", text: result.text }],
    isError: result.isError ?? false,
    ...(result.details !== undefined ? { details: result.details } : {}),
    timestamp: Date.now()
  };
}

async function executeToolCall(
  toolCall: ToolCall,
  handlers: Record<string, ToolExecutionHandler> | undefined
): Promise<ToolResultMessage> {
  const handler = handlers?.[toolCall.name];
  if (!handler) {
    return {
      role: "toolResult",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [{ type: "text", text: `No handler registered for tool "${toolCall.name}"` }],
      isError: true,
      timestamp: Date.now()
    };
  }

  try {
    const result = await handler(toolCall);
    return toToolResultMessage(toolCall, result);
  } catch (error) {
    return {
      role: "toolResult",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
      isError: true,
      timestamp: Date.now()
    };
  }
}

export async function runCodergenNode(input: CodergenNodeInput): Promise<CodergenRunResult> {
  const validatedModelConfig = validateRunModelConfig(input.model);
  const context = buildCodergenContext(input);
  const maxToolRounds = input.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;

  for (let round = 1; round <= maxToolRounds; round += 1) {
    const stream = streamSimple(validatedModelConfig.model, context, {
      ...(validatedModelConfig.reasoningLevel
        ? { reasoning: validatedModelConfig.reasoningLevel }
        : {}),
      ...(validatedModelConfig.temperature !== undefined
        ? { temperature: validatedModelConfig.temperature }
        : {}),
      ...(validatedModelConfig.maxTokens !== undefined
        ? { maxTokens: validatedModelConfig.maxTokens }
        : {})
    });

    for await (const event of stream) {
      const mappedEvent = toStreamEvent(round, event);
      if (mappedEvent) {
        input.onEvent?.(mappedEvent);
      }
    }

    const assistantMessage = await stream.result();
    context.messages.push(assistantMessage);

    const toolCalls = assistantMessage.content.filter(
      (block): block is ToolCall => block.type === "toolCall"
    );

    if (toolCalls.length === 0) {
      return {
        rounds: round,
        finalMessage: assistantMessage,
        finalText: extractText(assistantMessage),
        messages: context.messages
      };
    }

    if (context.tools && context.tools.length > 0) {
      for (const toolCall of toolCalls) {
        validateToolCall(context.tools, toolCall);
      }
    }

    for (const toolCall of toolCalls) {
      context.messages.push(await executeToolCall(toolCall, input.toolHandlers));
    }
  }

  throw new Error(
    `Tool call loop exceeded ${maxToolRounds} rounds for provider ${validatedModelConfig.provider} model ${validatedModelConfig.modelId}`
  );
}
