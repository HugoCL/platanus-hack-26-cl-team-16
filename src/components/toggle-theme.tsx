"use client";

import { Button } from "@ui-sdk/react/button";
import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

type ThemeToggleProps = {
  id?: string;
  variant?: "default" | "icon";
  className?: string;
};

export function ThemeToggle({
  id,
  variant = "default",
  className = "",
}: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const isIcon = variant === "icon";
  const handleThemeChange = () =>
    setTheme(resolvedTheme === "dark" ? "light" : "dark");

  return (
    <Button
      aria-label="Cambiar tema"
      id={id}
      className={`press-blur ${isIcon ? "" : "min-w-28"} ${className}`}
      onClick={handleThemeChange}
      data-size={isIcon ? "icon" : undefined}
      data-variant={isIcon ? "ghost" : undefined}
    >
      <SunIcon size={16} className="block dark:hidden" />
      <MoonIcon size={16} className="hidden dark:block" />
      {!isIcon && (
        <span>
          <span className="inline dark:hidden">Claro</span>
          <span className="hidden dark:inline">Oscuro</span>
        </span>
      )}
    </Button>
  );
}
