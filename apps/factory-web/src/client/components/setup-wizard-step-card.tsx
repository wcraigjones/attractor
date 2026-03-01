import type { ReactNode } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

export function SetupWizardStepCard(props: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        {props.description ? <CardDescription>{props.description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {props.children}
        {props.footer ? <div className="flex flex-wrap items-center gap-2">{props.footer}</div> : null}
      </CardContent>
    </Card>
  );
}
