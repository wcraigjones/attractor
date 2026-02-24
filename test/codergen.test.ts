import {
  Type,
  getModel,
  getModels,
  getProviders,
  registerApiProvider,
  resetApiProviders,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  type ToolCall
} from "@mariozechner/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { runCodergenNode, type CodergenStreamEvent } from "../src/runner/codergen.js";

function usage() {
  return {
    input: 10,
    output: 10,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 20,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0
    }
  };
}

function assistantMessage(
  provider: string,
  modelId: string,
  api: string,
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"]
): AssistantMessage {
  return {
    role: "assistant",
    provider,
    model: modelId,
    api,
    content,
    usage: usage(),
    stopReason,
    timestamp: Date.now()
  };
}

function staticStream(
  events: AssistantMessageEvent[],
  message: AssistantMessage
): AssistantMessageEventStream {
  return {
    async result() {
      return message;
    },
    [Symbol.asyncIterator]: async function* () {
      for (const event of events) {
        yield event;
      }
    }
  };
}

afterEach(() => {
  resetApiProviders();
});

describe("codergen runner", () => {
  it("executes tool call roundtrip and forwards stream events", async () => {
    const provider = getProviders()[0];
    expect(provider).toBeTruthy();

    const model = getModels(provider as never)[0];
    expect(model).toBeTruthy();

    const resolvedModel = getModel(provider as never, model!.id as never);
    expect(resolvedModel).toBeTruthy();

    registerApiProvider({
      api: model!.api,
      stream: (_model, context) => fakeProviderStream(model!, context),
      streamSimple: (_model, context) => fakeProviderStream(model!, context)
    }, "codergen-test-provider");

    let handledCall: ToolCall | undefined;
    const events: CodergenStreamEvent[] = [];

    const result = await runCodergenNode({
      model: {
        provider,
        modelId: model!.id,
        reasoningLevel: "high"
      },
      prompt: "Create a short plan and then finalize.",
      priorArtifacts: [
        { id: "planning/requirements", content: "Need unit tests and docs updates." }
      ],
      tools: [
        {
          name: "get_plan",
          description: "Returns project plan details",
          parameters: Type.Object({
            topic: Type.String()
          })
        }
      ],
      toolHandlers: {
        get_plan: (toolCall) => {
          handledCall = toolCall;
          return "Plan: write tests first, then implement.";
        }
      },
      onEvent: (event) => {
        events.push(event);
      }
    });

    expect(handledCall?.name).toBe("get_plan");
    expect(result.rounds).toBe(2);
    expect(result.finalText).toContain("Completed");
    expect(events.some((event) => event.type === "thinking_delta")).toBe(true);
    expect(events.some((event) => event.type === "text_delta")).toBe(true);
    expect(events.some((event) => event.type === "toolcall_end")).toBe(true);
  });
});

function fakeProviderStream(
  model: { provider: string; id: string; api: string },
  context: Context
): AssistantMessageEventStream {
  const hasToolResult = context.messages.some((message) => message.role === "toolResult");
  if (!hasToolResult) {
    const toolCall: ToolCall = {
      type: "toolCall",
      id: "tool-1",
      name: "get_plan",
      arguments: {
        topic: "implementation"
      }
    };

    const partial = assistantMessage(model.provider, model.id, model.api, [toolCall], "toolUse");
    const message = assistantMessage(model.provider, model.id, model.api, [toolCall], "toolUse");

    return staticStream(
      [
        {
          type: "thinking_delta",
          contentIndex: 0,
          delta: "Analyzing",
          partial
        },
        {
          type: "toolcall_start",
          contentIndex: 1,
          partial
        },
        {
          type: "toolcall_end",
          contentIndex: 1,
          toolCall,
          partial
        },
        {
          type: "done",
          reason: "toolUse",
          message
        }
      ],
      message
    );
  }

  const textMessage = assistantMessage(
    model.provider,
    model.id,
    model.api,
    [{ type: "text", text: "Completed implementation plan." }],
    "stop"
  );
  const partial = assistantMessage(
    model.provider,
    model.id,
    model.api,
    [{ type: "text", text: "Completed" }],
    "stop"
  );

  return staticStream(
    [
      {
        type: "text_delta",
        contentIndex: 0,
        delta: "Completed",
        partial
      },
      {
        type: "done",
        reason: "stop",
        message: textMessage
      }
    ],
    textMessage
  );
}
