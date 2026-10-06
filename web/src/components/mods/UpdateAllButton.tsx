import { ArrowUpCircle, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useUpdateAllMods } from "@/hooks/use-api";

/** Two-step "Update all": first click arms, second click runs every update. */
export default function UpdateAllButton({ updateCount }: { updateCount: number }) {
  const { t } = useTranslation();
  const updateAll = useUpdateAllMods();
  const [armed, setArmed] = useState(false);

  return (
    <Button
      disabled={updateCount === 0 || updateAll.isPending}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        updateAll.mutate(undefined, { onSettled: () => setArmed(false) });
      }}
      size="sm"
      variant={armed ? "destructive" : "outline"}
    >
      {updateAll.isPending ? <Loader2 className="animate-spin" /> : <ArrowUpCircle />}
      {armed ? t("mods.reallyUpdateAll") : `${t("mods.updateAll")} (${updateCount})`}
    </Button>
  );
}
