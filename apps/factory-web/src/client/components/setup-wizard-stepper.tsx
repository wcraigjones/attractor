import { Check } from "lucide-react";

import type { SetupWizardStep } from "../lib/setup-wizard";
import { cn } from "../lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

export interface SetupWizardStepperItem {
  step: SetupWizardStep;
  label: string;
  required: boolean;
  complete: boolean;
  disabled?: boolean;
}

export function SetupWizardStepper(props: {
  currentStep: SetupWizardStep;
  items: SetupWizardStepperItem[];
  onSelectStep: (step: SetupWizardStep) => void;
}) {
  return (
    <div className="space-y-2">
      {props.items.map((item, index) => {
        const active = item.step === props.currentStep;
        return (
          <Button
            key={item.step}
            type="button"
            variant={active ? "secondary" : "ghost"}
            className={cn("w-full justify-start", active ? "border border-border" : "")}
            onClick={() => props.onSelectStep(item.step)}
            disabled={item.disabled}
          >
            <span className="mono w-6 text-xs">{String(index + 1).padStart(2, "0")}</span>
            <span className="flex-1 text-left">{item.label}</span>
            {item.required ? <Badge variant="outline">Required</Badge> : <Badge variant="secondary">Optional</Badge>}
            {item.complete ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
          </Button>
        );
      })}
    </div>
  );
}
