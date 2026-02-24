import { useMemo } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { listProjects } from "../../lib/api";
import { cn } from "../../lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

const primaryNav = [
  { to: "/", label: "Dashboard" },
  { to: "/projects", label: "Projects" }
];

function toTitleCase(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const projectIdFromPath = params.projectId;

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects
  });

  const breadcrumbs = useMemo(() => {
    const parts = location.pathname.split("/").filter(Boolean);
    const items: Array<{ href: string; label: string }> = [{ href: "/", label: "Dashboard" }];

    if (parts.length === 0) {
      return items;
    }

    let cursor = "";
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index] ?? "";
      cursor += `/${part}`;

      if (part === "projects" && index + 1 < parts.length) {
        const projectId = parts[index + 1] ?? "";
        const project = projectsQuery.data?.find((candidate) => candidate.id === projectId);
        items.push({ href: "/projects", label: "Projects" });
        items.push({ href: `/projects/${projectId}`, label: project?.name ?? "Project" });
        index += 1;
        cursor += `/${projectId}`;
        continue;
      }

      if (part === "runs" && index + 1 < parts.length) {
        const runId = parts[index + 1] ?? "";
        items.push({ href: "/projects", label: "Runs" });
        items.push({ href: `/runs/${runId}`, label: runId.slice(0, 8) });
        index += 1;
        cursor += `/${runId}`;
        continue;
      }

      items.push({ href: cursor, label: toTitleCase(part) });
    }

    return items;
  }, [location.pathname, projectsQuery.data]);

  const selectedProjectId = projectIdFromPath ?? projectsQuery.data?.[0]?.id;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-border bg-card/90 p-4 backdrop-blur md:min-h-screen md:w-64 md:border-b-0 md:border-r">
        <div className="mb-6">
          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Attractor</p>
          <h1 className="text-xl font-semibold">Factory</h1>
        </div>
        <nav className="space-y-1">
          {primaryNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "block rounded-md px-3 py-2 text-sm",
                  isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                )
              }
              end={item.to === "/"}
            >
              {item.label}
            </NavLink>
          ))}
          {selectedProjectId ? (
            <div className="mt-4 space-y-1 border-t border-border pt-4">
              {[
                { to: `/projects/${selectedProjectId}`, label: "Overview" },
                { to: `/projects/${selectedProjectId}/secrets`, label: "Secrets" },
                { to: `/projects/${selectedProjectId}/attractors`, label: "Attractors" },
                { to: `/projects/${selectedProjectId}/runs`, label: "Runs" }
              ].map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      "block rounded-md px-3 py-2 text-sm",
                      isActive ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted"
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          ) : null}
        </nav>
      </aside>

      <div className="flex-1">
        <header className="flex flex-col gap-3 border-b border-border bg-card/75 px-5 py-4 backdrop-blur md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <div key={crumb.href} className="flex items-center gap-2">
                  {index > 0 ? <span>/</span> : null}
                  {isLast ? (
                    <span className="font-medium text-foreground">{crumb.label}</span>
                  ) : (
                    <Link to={crumb.href} className="hover:text-foreground">
                      {crumb.label}
                    </Link>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex w-full items-center gap-2 md:w-auto">
            <Select
              value={selectedProjectId}
              onValueChange={(value) => {
                navigate(`/projects/${value}`);
              }}
            >
              <SelectTrigger className="md:w-72">
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {(projectsQuery.data ?? []).map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </header>

        <main className="p-5 md:p-7">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
