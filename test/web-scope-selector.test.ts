import { describe, expect, it } from "vitest";

import {
  buildScopeOptions,
  GLOBAL_SCOPE_VALUE,
  isGlobalAttractorsPath,
  isGlobalChatPath,
  isGlobalEnvironmentsPath,
  isGlobalScopePath,
  isGlobalSecretsPath,
  isGlobalTaskTemplatesPath,
  resolveSelectedScope,
  scopeToPath
} from "../apps/factory-web/src/client/lib/scope-selector";

describe("scope selector helpers", () => {
  it("resolves /secrets/global path to global scope sentinel", () => {
    expect(resolveSelectedScope({ pathname: "/secrets/global", fallbackProjectId: "proj-1" })).toBe(
      GLOBAL_SCOPE_VALUE
    );
  });

  it("resolves project path params to project scope", () => {
    expect(resolveSelectedScope({ pathname: "/projects/proj-2/secrets", projectIdFromPath: "proj-2" })).toBe(
      "proj-2"
    );
  });

  it("resolves /attractors/global path to global scope sentinel", () => {
    expect(resolveSelectedScope({ pathname: "/attractors/global", fallbackProjectId: "proj-1" })).toBe(
      GLOBAL_SCOPE_VALUE
    );
    expect(isGlobalAttractorsPath("/attractors/global")).toBe(true);
  });

  it("resolves /environments/global path to global scope sentinel", () => {
    expect(resolveSelectedScope({ pathname: "/environments/global", fallbackProjectId: "proj-1" })).toBe(
      GLOBAL_SCOPE_VALUE
    );
    expect(isGlobalEnvironmentsPath("/environments/global")).toBe(true);
  });

  it("resolves /task-templates/global path to global scope sentinel", () => {
    expect(resolveSelectedScope({ pathname: "/task-templates/global", fallbackProjectId: "proj-1" })).toBe(
      GLOBAL_SCOPE_VALUE
    );
    expect(isGlobalTaskTemplatesPath("/task-templates/global")).toBe(true);
  });

  it("resolves /chat path to global scope sentinel", () => {
    expect(resolveSelectedScope({ pathname: "/chat", fallbackProjectId: "proj-1" })).toBe(
      GLOBAL_SCOPE_VALUE
    );
    expect(isGlobalChatPath("/chat")).toBe(true);
  });

  it("keeps global scope fallback on non-project routes", () => {
    expect(resolveSelectedScope({ pathname: "/", fallbackProjectId: GLOBAL_SCOPE_VALUE })).toBe(GLOBAL_SCOPE_VALUE);
    expect(resolveSelectedScope({ pathname: "/projects", fallbackProjectId: GLOBAL_SCOPE_VALUE })).toBe(
      GLOBAL_SCOPE_VALUE
    );
    expect(resolveSelectedScope({ pathname: "/setup", fallbackProjectId: GLOBAL_SCOPE_VALUE })).toBe(
      GLOBAL_SCOPE_VALUE
    );
  });

  it("builds options with Global as first row", () => {
    const options = buildScopeOptions([
      { id: "proj-1", name: "Project One" },
      { id: "proj-2", name: "Project Two" }
    ]);

    expect(options[0]).toEqual({ value: GLOBAL_SCOPE_VALUE, label: "Global" });
    expect(options.slice(1).map((option) => option.value)).toEqual(["proj-1", "proj-2"]);
  });

  it("maps selected global scope to /environments/global", () => {
    expect(scopeToPath(GLOBAL_SCOPE_VALUE)).toBe("/environments/global");
    expect(scopeToPath("proj-1")).toBe("/projects/proj-1");
  });

  it("maps global scope to matching global resource when pathname is a project sub-route", () => {
    expect(scopeToPath(GLOBAL_SCOPE_VALUE, "/projects/proj-1/secrets")).toBe("/secrets/global");
    expect(scopeToPath(GLOBAL_SCOPE_VALUE, "/projects/proj-1/attractors")).toBe("/attractors/global");
    expect(scopeToPath(GLOBAL_SCOPE_VALUE, "/projects/proj-1/environments")).toBe("/environments/global");
    expect(scopeToPath(GLOBAL_SCOPE_VALUE, "/projects/proj-1/task-templates")).toBe("/task-templates/global");
    expect(scopeToPath(GLOBAL_SCOPE_VALUE, "/projects/proj-1/chat")).toBe("/chat");
  });

  it("falls back to /environments/global when project sub-route has no global equivalent", () => {
    expect(scopeToPath(GLOBAL_SCOPE_VALUE, "/projects/proj-1")).toBe("/environments/global");
    expect(scopeToPath(GLOBAL_SCOPE_VALUE, "/projects/proj-1/runs")).toBe("/environments/global");
  });

  it("maps global scope with nested project sub-routes", () => {
    expect(scopeToPath(GLOBAL_SCOPE_VALUE, "/projects/proj-1/secrets/some-secret")).toBe("/secrets/global");
    expect(scopeToPath(GLOBAL_SCOPE_VALUE, "/projects/proj-1/attractors/attr-1")).toBe("/attractors/global");
  });

  it("returns empty options list with Global when no projects exist", () => {
    const options = buildScopeOptions([]);
    expect(options).toEqual([{ value: GLOBAL_SCOPE_VALUE, label: "Global" }]);
  });
});

describe("isGlobal*Path helpers", () => {
  it("detects global secrets paths including sub-paths", () => {
    expect(isGlobalSecretsPath("/secrets/global")).toBe(true);
    expect(isGlobalSecretsPath("/secrets/global/some-id")).toBe(true);
    expect(isGlobalSecretsPath("/secrets/other")).toBe(false);
    expect(isGlobalSecretsPath("/projects/proj-1/secrets")).toBe(false);
  });

  it("detects global attractors paths including sub-paths", () => {
    expect(isGlobalAttractorsPath("/attractors/global")).toBe(true);
    expect(isGlobalAttractorsPath("/attractors/global/attr-1")).toBe(true);
    expect(isGlobalAttractorsPath("/attractors/proj-1")).toBe(false);
  });

  it("detects global environments paths including sub-paths", () => {
    expect(isGlobalEnvironmentsPath("/environments/global")).toBe(true);
    expect(isGlobalEnvironmentsPath("/environments/global/env-1")).toBe(true);
    expect(isGlobalEnvironmentsPath("/environments/other")).toBe(false);
  });

  it("detects global task-templates paths including sub-paths", () => {
    expect(isGlobalTaskTemplatesPath("/task-templates/global")).toBe(true);
    expect(isGlobalTaskTemplatesPath("/task-templates/global/tt-1")).toBe(true);
    expect(isGlobalTaskTemplatesPath("/task-templates/other")).toBe(false);
  });

  it("detects global chat paths including sub-paths", () => {
    expect(isGlobalChatPath("/chat")).toBe(true);
    expect(isGlobalChatPath("/chat/session-1")).toBe(true);
    expect(isGlobalChatPath("/chats")).toBe(false);
  });

  it("isGlobalScopePath returns true for any global path and false for non-global", () => {
    expect(isGlobalScopePath("/secrets/global")).toBe(true);
    expect(isGlobalScopePath("/attractors/global")).toBe(true);
    expect(isGlobalScopePath("/environments/global")).toBe(true);
    expect(isGlobalScopePath("/task-templates/global")).toBe(true);
    expect(isGlobalScopePath("/chat")).toBe(true);
    expect(isGlobalScopePath("/projects/proj-1/secrets")).toBe(false);
    expect(isGlobalScopePath("/")).toBe(false);
    expect(isGlobalScopePath("/projects")).toBe(false);
  });
});

describe("resolveSelectedScope edge cases", () => {
  it("global path takes priority over projectIdFromPath", () => {
    expect(
      resolveSelectedScope({
        pathname: "/secrets/global",
        projectIdFromPath: "proj-1",
        fallbackProjectId: "proj-2"
      })
    ).toBe(GLOBAL_SCOPE_VALUE);
  });

  it("returns undefined when no scope can be resolved", () => {
    expect(resolveSelectedScope({ pathname: "/" })).toBeUndefined();
  });

  it("resolves sub-paths of global resources to global scope", () => {
    expect(resolveSelectedScope({ pathname: "/attractors/global/attr-1" })).toBe(GLOBAL_SCOPE_VALUE);
    expect(resolveSelectedScope({ pathname: "/task-templates/global/tt-1" })).toBe(GLOBAL_SCOPE_VALUE);
  });
});
