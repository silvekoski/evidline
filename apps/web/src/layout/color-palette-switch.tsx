import { useState } from "react";
import { PaletteIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { applyColorPalette, colorPalettes, readColorPalette, type ColorPaletteId } from "@/lib/color-palette";

export function ColorPaletteSwitch() {
  const [id, setId] = useState<ColorPaletteId>(readColorPalette);
  const select = (next: string) => {
    const palette = colorPalettes.find((p) => p.id === next);
    if (!palette) return;
    applyColorPalette(palette.id);
    setId(palette.id);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="text-muted-foreground" aria-label="Color palette">
          <PaletteIcon aria-hidden="true" />
          <span>{colorPalettes.find((p) => p.id === id)?.label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={id} onValueChange={select}>
          {colorPalettes.map((p) => (
            <DropdownMenuRadioItem key={p.id} value={p.id}>
              {p.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
