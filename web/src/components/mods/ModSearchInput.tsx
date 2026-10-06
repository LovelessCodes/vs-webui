import { formatForDisplay, useHotkey } from "@tanstack/react-hotkeys";
import { Search } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";

interface ModSearchInputProps {
  className?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}

export default function ModSearchInput({
  className,
  onChange,
  placeholder,
  value,
}: ModSearchInputProps) {
  const { t } = useTranslation();
  const searchRef = useRef<HTMLInputElement>(null);
  const resolvedPlaceholder = placeholder ?? t("mods.searchPlaceholder");

  // Mod+K belongs to the global command palette, so the mods browser uses
  // the conventional Mod+F to focus its search field instead.
  useHotkey(
    "Mod+F",
    () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    },
    { conflictBehavior: "allow" },
  );

  return (
    <InputGroup className={className}>
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput
        aria-label={resolvedPlaceholder}
        onChange={(event) => onChange(event.target.value)}
        placeholder={resolvedPlaceholder}
        ref={searchRef}
        value={value}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupText className="gap-0.5">
          <kbd className="font-sans">{formatForDisplay("Mod")}</kbd>
          <kbd className="font-sans">{formatForDisplay("F")}</kbd>
        </InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  );
}
