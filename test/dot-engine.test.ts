import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { executeGraph, parseDotGraph, validateDotGraph } from "../apps/factory-runner/src/engine/index.js";

describe("DOT engine", () => {
  it("executes parallel fan-out and fan-in", async () => {
    const graph = parseDotGraph(`
      digraph parallel_review {
        start [shape=Mdiamond, type="start"];
        fanout [shape=component, type="parallel"];
        reviewer_a [shape=box, type="codergen", prompt="review-a"];
        reviewer_b [shape=box, type="codergen", prompt="review-b"];
        fan_in [shape=tripleoctagon, type="parallel.fan_in"];
        synthesis [shape=box, type="codergen", prompt="synthesis"];
        done [shape=Msquare, type="exit"];

        start -> fanout;
        fanout -> reviewer_a [label="a"];
        fanout -> reviewer_b [label="b"];
        reviewer_a -> fan_in;
        reviewer_b -> fan_in;
        fan_in -> synthesis;
        synthesis -> done;
      }
    `);

    validateDotGraph(graph);

    const result = await executeGraph({
      graph,
      callbacks: {
        codergen: async ({ node }) => {
          if (node.id === "reviewer_a") {
            return "review-a-output";
          }
          if (node.id === "reviewer_b") {
            return "review-b-output";
          }
          if (node.id === "synthesis") {
            return "combined-report";
          }
          return "";
        }
      }
    });

    expect(result.exitNodeId).toBe("done");
    expect(result.state.parallelOutputs.fanout).toEqual({
      a: "review-a-output",
      b: "review-b-output"
    });
    expect(result.state.nodeOutputs.synthesis).toBe("combined-report");
  });

  it("supports checkpoint resume with explicit start node", async () => {
    const graph = parseDotGraph(`
      digraph resume_path {
        start [shape=Mdiamond, type="start"];
        stage_a [shape=box, type="codergen", prompt="A"];
        done [shape=Msquare, type="exit"];

        start -> stage_a;
        stage_a -> done;
      }
    `);

    validateDotGraph(graph);

    const resumed = await executeGraph({
      graph,
      startNodeId: "stage_a",
      initialState: {
        context: { resumed: true },
        nodeOutputs: {},
        parallelOutputs: {}
      },
      callbacks: {
        codergen: async ({ node }) => `ran-${node.id}`
      }
    });

    expect(resumed.exitNodeId).toBe("done");
    expect(resumed.state.nodeOutputs.stage_a).toBe("ran-stage_a");
    expect(resumed.state.context.resumed).toBe(true);
  });

  it("includes the expected global security council topology", () => {
    const source = readFileSync(
      join(process.cwd(), "factory/security-review-council.dot"),
      "utf8"
    );
    const graph = parseDotGraph(source);
    validateDotGraph(graph);

    expect(graph.graphAttrs.final_artifact_key).toBe("security-review-report.md");
    expect(graph.graphAttrs.final_output_node).toBe("synthesis");

    const reviewerNodes = graph.nodeOrder.filter((nodeId) =>
      nodeId.startsWith("reviewer_")
    );
    expect(reviewerNodes).toHaveLength(6);

    const synthesisNode = graph.nodes.synthesis;
    expect(synthesisNode?.attrs.provider).toBe("openrouter");
    expect(synthesisNode?.attrs.model).toBe("google/gemini-3.1-pro-preview");
  });
});
