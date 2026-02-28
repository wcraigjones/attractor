import { describe, expect, it } from "vitest";

import {
  applyGraphTransforms,
  executeGraph,
  lintDotGraph,
  parseDotGraph,
  validateDotGraph
} from "../apps/factory-runner/src/engine/index.js";

describe("DOT engine parity behavior", () => {
  it("flattens subgraphs and applies scoped defaults/classes", () => {
    const graph = parseDotGraph(`
      digraph scoped_defaults {
        start [shape=Mdiamond];
        done [shape=Msquare];

        subgraph cluster_loop {
          label = "Loop A";
          node [thread_id="loop-a", timeout="900s"];

          Plan [shape=box, label="Plan"];
          Implement [shape=box, timeout="1800s"];
        }

        start -> Plan -> Implement -> done;
      }
    `);

    const plan = graph.nodes.Plan;
    const implement = graph.nodes.Implement;

    expect(plan?.attrs.thread_id).toBe("loop-a");
    expect(plan?.attrs.timeout).toBe("900s");
    expect(plan?.attrs.class).toContain("loop-a");

    expect(implement?.attrs.thread_id).toBe("loop-a");
    expect(implement?.attrs.timeout).toBe("1800s");
  });

  it("applies variable expansion and stylesheet specificity", () => {
    const parsed = parseDotGraph(`
      digraph styled {
        graph [
          goal="Ship feature X",
          model_stylesheet="
            * { llm_model: base-model; llm_provider: openrouter; }
            box { llm_model: shape-model; }
            .fast { llm_model: class-model; }
            #review { reasoning_effort: high; }
          "
        ];

        start [shape=Mdiamond];
        done [shape=Msquare];
        plan [shape=box, class="fast", prompt="Plan for $goal"];
        review [shape=box, class="fast", llm_model="explicit-model", prompt="Review $goal"];

        start -> plan -> review -> done;
      }
    `);

    const graph = applyGraphTransforms(parsed);

    expect(graph.nodes.plan?.prompt).toBe("Plan for Ship feature X");
    expect(graph.nodes.plan?.attrs.llm_model).toBe("class-model");
    expect(graph.nodes.plan?.attrs.llm_provider).toBe("openrouter");

    expect(graph.nodes.review?.attrs.llm_model).toBe("explicit-model");
    expect(graph.nodes.review?.attrs.reasoning_effort).toBe("high");
  });

  it("provides lint diagnostics for structural and syntax issues", () => {
    const invalid = parseDotGraph(`
      digraph lint_bad {
        start [shape=Mdiamond];
        done [shape=Msquare];
        orphan [shape=box];

        start -> done;
        done -> start;
        start -> missing [condition="outcome==success"];
      }
    `);

    const diagnostics = lintDotGraph(invalid);
    const rules = diagnostics.map((item) => item.rule);

    expect(rules).toContain("exit_no_outgoing");
    expect(rules).toContain("edge_target_exists");
    expect(rules).toContain("condition_syntax");
    expect(rules).toContain("reachability");

    expect(() => validateDotGraph(invalid)).toThrowError();
  });

  it("uses edge-selection priority and routes by condition before preferred label", async () => {
    const graph = parseDotGraph(`
      digraph edge_priority {
        start [shape=Mdiamond];
        choose [shape=box, prompt="choose"];
        cond [shape=box, prompt="cond"];
        label_match [shape=box, prompt="label"];
        weighted [shape=box, prompt="weighted"];
        done [shape=Msquare];

        start -> choose;
        choose -> cond [condition="context.route=true", weight=0];
        choose -> label_match [label="[Y] Yes", weight=50];
        choose -> weighted [weight=999];
        cond -> done;
        label_match -> done;
        weighted -> done;
      }
    `);

    const executed: string[] = [];
    const result = await executeGraph({
      graph,
      callbacks: {
        codergen: async ({ node }) => {
          executed.push(node.id);
          if (node.id === "choose") {
            return {
              status: "success",
              preferred_label: "Yes",
              context_updates: {
                route: "true"
              }
            };
          }
          return `${node.id}-ok`;
        }
      }
    });

    expect(result.exitNodeId).toBe("done");
    expect(executed).toEqual(["choose", "cond"]);
    expect(result.state.nodeOutputs.weighted).toBeUndefined();
  });

  it("supports retry and allow_partial semantics", async () => {
    const graph = parseDotGraph(`
      digraph retry_partial {
        graph [default_max_retry=0];
        start [shape=Mdiamond];
        flaky [shape=box, max_retries=2, allow_partial=true, prompt="retry me"];
        done [shape=Msquare];

        start -> flaky -> done;
      }
    `);

    let attempts = 0;
    const result = await executeGraph({
      graph,
      callbacks: {
        codergen: async ({ node }) => {
          if (node.id !== "flaky") {
            return "ok";
          }
          attempts += 1;
          return {
            status: "retry",
            failure_reason: "transient"
          };
        }
      }
    });

    expect(result.exitNodeId).toBe("done");
    expect(attempts).toBe(3);
    expect(result.state.nodeOutcomes.flaky?.status).toBe("PARTIAL_SUCCESS");
  });

  it("enforces goal gates at exit and redirects to retry target", async () => {
    const graph = parseDotGraph(`
      digraph goal_gate {
        start [shape=Mdiamond];
        critical [shape=box, goal_gate=true, retry_target="critical", prompt="critical"];
        done [shape=Msquare];

        start -> critical;
        critical -> done [condition="outcome=fail"];
        critical -> done [condition="outcome=success"];
      }
    `);

    let criticalCalls = 0;
    const result = await executeGraph({
      graph,
      callbacks: {
        codergen: async ({ node }) => {
          if (node.id !== "critical") {
            return "ok";
          }
          criticalCalls += 1;
          if (criticalCalls === 1) {
            return {
              status: "fail",
              failure_reason: "initial failure"
            };
          }
          return {
            status: "success"
          };
        }
      }
    });

    expect(result.exitNodeId).toBe("done");
    expect(criticalCalls).toBe(2);
    expect(result.state.nodeOutcomes.critical?.status).toBe("SUCCESS");
  });

  it("derives wait.human options from outgoing edges", async () => {
    const graph = parseDotGraph(`
      digraph human_gate {
        start [shape=Mdiamond];
        gate [shape=hexagon, type="wait.human", label="Approve?"];
        approve [shape=box, prompt="approved"];
        reject [shape=box, prompt="rejected"];
        done [shape=Msquare];

        start -> gate;
        gate -> approve [label="[A] Approve"];
        gate -> reject [label="[R] Reject"];
        approve -> done;
        reject -> done;
      }
    `);

    let askedOptions: string[] = [];
    const result = await executeGraph({
      graph,
      callbacks: {
        codergen: async ({ node }) => `${node.id}-ok`,
        waitForHuman: async (question) => {
          askedOptions = question.options ?? [];
          return "A";
        }
      }
    });

    expect(result.exitNodeId).toBe("done");
    expect(askedOptions).toEqual(["[A] [A] Approve", "[R] [R] Reject"]);
    expect(result.state.nodeOutcomes.gate?.suggestedNextIds).toEqual(["approve"]);
    expect(result.state.nodeOutputs.approve).toBe("approve-ok");
  });

  it("executes custom handlers by explicit type", async () => {
    const graph = parseDotGraph(`
      digraph custom_handler {
        start [shape=Mdiamond];
        enrich [shape=box, type="my_custom"];
        done [shape=Msquare];
        start -> enrich -> done;
      }
    `);

    const result = await executeGraph({
      graph,
      callbacks: {
        codergen: async () => "unused",
        customHandlers: {
          my_custom: async () => ({
            status: "success",
            output: "custom-output",
            context_updates: { "context.enriched": "true" }
          })
        }
      }
    });

    expect(result.state.nodeOutputs.enrich).toBe("custom-output");
    expect(result.state.context["context.enriched"]).toBe("true");
  });
});
