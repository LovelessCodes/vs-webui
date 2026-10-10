import { Link } from "@tanstack/react-router";
import { Check, Rocket } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSaves, useStatus } from "@/hooks/use-api";
import { cn } from "cn";

/** First-run checklist shown until the server has a build, world and start. */
export default function OnboardingCard() {
  const { t } = useTranslation();
  const status = useStatus();
  const saves = useSaves();
  const data = status.data;
  if (!data) return null;

  const hasBuild = Boolean(data.settings.version || data.settings.stratum_tag);
  const hasConfig = Boolean(data.config);
  const hasWorld = (saves.data?.saves.length ?? 0) > 0;
  const hasStarted =
    data.status.started_at !== null ||
    data.status.status === "running" ||
    data.status.status === "starting";

  const steps: Array<{
    key: string;
    done: boolean;
    to?: "/versions" | "/settings" | "/worlds";
    label: string;
  }> = [
    { key: "install", done: hasBuild, to: "/versions", label: t("dashboard.onboardingInstall") },
    { key: "settings", done: hasConfig, to: "/settings", label: t("dashboard.onboardingSettings") },
    { key: "world", done: hasWorld, to: "/worlds", label: t("dashboard.onboardingWorld") },
    { key: "start", done: hasStarted, label: t("dashboard.onboardingStart") },
  ];
  if (steps.every((step) => step.done)) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Rocket className="size-4 text-muted-foreground" />
          {t("dashboard.onboardingTitle")}
        </CardTitle>
        <CardDescription>{t("dashboard.onboardingDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        <ol className="grid gap-2 text-xs">
          {steps.map((step, index) => (
            <li className="flex items-center gap-2" key={step.key}>
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center border text-[9px]",
                  step.done
                    ? "border-success/50 text-success"
                    : "border-border text-muted-foreground",
                )}
              >
                {step.done ? <Check className="size-3" /> : index + 1}
              </span>
              {step.to ? (
                <Link className="underline-offset-4 hover:underline" to={step.to}>
                  {step.label}
                </Link>
              ) : (
                <span>{step.label}</span>
              )}
            </li>
          ))}
        </ol>
        <p className="text-[11px] text-muted-foreground">{t("dashboard.onboardingHint")}</p>
      </CardContent>
    </Card>
  );
}
