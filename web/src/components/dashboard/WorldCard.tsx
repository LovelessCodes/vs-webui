import { Link } from "@tanstack/react-router";
import { Globe2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSaves } from "@/hooks/use-api";
import { formatBytes } from "@/lib/format";

/** The active world and its save file at a glance. */
export default function WorldCard() {
  const { t } = useTranslation();
  const saves = useSaves();
  const active = saves.data?.saves.find((entry) => entry.active);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe2 className="size-4 text-muted-foreground" />
          {t("dashboard.world")}
        </CardTitle>
        <CardDescription>{t("dashboard.worldDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 text-xs">
        {active ? (
          <>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t("dashboard.worldName")}</span>
              <span className="truncate font-mono">{active.name}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t("dashboard.worldSize")}</span>
              <span className="font-mono">{formatBytes(active.size)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t("dashboard.worldModified")}</span>
              <span className="font-mono">
                {new Date(active.modified * 1000).toLocaleString()}
              </span>
            </div>
          </>
        ) : (
          <p className="text-muted-foreground">{t("dashboard.worldNone")}</p>
        )}
        <div>
          <Link
            className="text-accent-primary text-xs underline-offset-4 hover:underline"
            to="/worlds"
          >
            {t("dashboard.worldManage")}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
