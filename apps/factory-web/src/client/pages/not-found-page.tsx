import { Link } from "react-router-dom";

import { Button } from "../components/ui/button";

export function NotFoundPage() {
  return (
    <div className="rounded-xl border border-border bg-card p-8">
      <h2 className="text-2xl font-semibold">Page Not Found</h2>
      <p className="mt-2 text-sm text-muted-foreground">The route does not exist in this factory-web build.</p>
      <Button asChild className="mt-4">
        <Link to="/">Back To Dashboard</Link>
      </Button>
    </div>
  );
}
