import { describe, expect, it } from "vitest";

import {
  lintDotGraph,
  parseDotGraph,
  serializeDotGraphCanonical
} from "../packages/dot-engine/src/index";

describe("dot engine canonical serialization", () => {
  it("is idempotent across parse/serialize cycles", () => {
    const source = `
      digraph sample {
        edge [weight=10]
        node [timeout="900s"]
        start [shape=Mdiamond]
        plan [shape=box, prompt="Plan", class="fast"]
        done [shape=Msquare]
        start -> plan [label="next"]
        plan -> done
      }
    `;

    const parsed = parseDotGraph(source);
    const canonical = serializeDotGraphCanonical(parsed);
    const reparsed = parseDotGraph(canonical);
    const canonicalAgain = serializeDotGraphCanonical(reparsed);

    expect(canonicalAgain).toBe(canonical);
  });

  it("round-trips unknown attributes through canonical output", () => {
    const source = `
      digraph custom_attrs {
        start [shape=Mdiamond]
        tool_a [shape=parallelogram, type="custom.tool", custom_timeout="15s", x_meta="abc"]
        done [shape=Msquare]
        start -> tool_a [x_edge_hint="alpha", label="run"]
        tool_a -> done
      }
    `;

    const parsed = parseDotGraph(source);
    const canonical = serializeDotGraphCanonical(parsed);
    const reparsed = parseDotGraph(canonical);

    expect(reparsed.nodes.tool_a?.attrs.custom_timeout).toBe("15s");
    expect(reparsed.nodes.tool_a?.attrs.x_meta).toBe("abc");
    const edge = reparsed.edges.find((item) => item.from === "start" && item.to === "tool_a");
    expect(edge?.attrs.x_edge_hint).toBe("alpha");
  });

  it("keeps lint behavior on canonical output", () => {
    const invalid = parseDotGraph(`
      digraph bad {
        start [shape=Mdiamond]
        done [shape=Msquare]
        done -> start
      }
    `);

    const diagnostics = lintDotGraph(invalid);
    expect(diagnostics.some((item) => item.rule === "exit_no_outgoing")).toBe(true);

    const canonical = serializeDotGraphCanonical(invalid);
    const diagnosticsAfter = lintDotGraph(parseDotGraph(canonical));
    expect(diagnosticsAfter.some((item) => item.rule === "exit_no_outgoing")).toBe(true);
  });
});
