import { describe, expect, it } from "vitest";

import { attractorUsesDotImplementation } from "../packages/shared-types/src/index.js";

describe("attractor DOT implementation detection", () => {
  it("detects explicit implementation_mode=dot", () => {
    const source = `
      digraph impl {
        graph [implementation_mode="dot"];
        start [shape=Mdiamond];
        done [shape=Msquare];
        start -> done;
      }
    `;
    expect(attractorUsesDotImplementation(source)).toBe(true);
  });

  it("detects implementation patch node hint", () => {
    const source = `
      digraph impl {
        implementation_patch_node="implement";
        start [shape=Mdiamond];
        implement [shape=box];
        done [shape=Msquare];
        start -> implement -> done;
      }
    `;
    expect(attractorUsesDotImplementation(source)).toBe(true);
  });

  it("ignores commented-out hints", () => {
    const source = `
      digraph impl {
        // implementation_mode="dot";
        /* implementation_patch_node="implement"; */
        start [shape=Mdiamond];
        done [shape=Msquare];
        start -> done;
      }
    `;
    expect(attractorUsesDotImplementation(source)).toBe(false);
  });

  it("returns false when no hint is present", () => {
    const source = `
      digraph impl {
        start [shape=Mdiamond];
        done [shape=Msquare];
        start -> done;
      }
    `;
    expect(attractorUsesDotImplementation(source)).toBe(false);
  });
});
