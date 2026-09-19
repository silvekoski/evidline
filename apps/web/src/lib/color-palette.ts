export const colorPalettes = [
  { id: "mono", label: "Mono" },
  { id: "ocean-breeze", label: "Ocean breeze" },
  { id: "caffeine", label: "Caffeine" },
  { id: "claude", label: "Claude" },
  { id: "supabase", label: "Supabase" },
  { id: "northern-lights", label: "Northern lights" },
  { id: "catppuccin", label: "Catppuccin" },
  { id: "cyberpunk", label: "Cyberpunk" },
  { id: "twitter", label: "Twitter" },
  { id: "nature", label: "Nature" },
  { id: "sunset-horizon", label: "Sunset horizon" },
  { id: "cosmic-night", label: "Cosmic night" },
  { id: "retro-arcade", label: "Retro arcade" },
  { id: "quantum-rose", label: "Quantum rose" },
  { id: "mocha-mousse", label: "Mocha mousse" },
  { id: "amber-minimal", label: "Amber minimal" },
  { id: "perpetuity", label: "Perpetuity" },
  { id: "doom-64", label: "Doom 64" },
] as const;
export type ColorPaletteId = (typeof colorPalettes)[number]["id"];

const storageKey = "tpm.color-palette";
const isId = (value: string | null): value is ColorPaletteId => colorPalettes.some((p) => p.id === value);

export function readColorPalette(): ColorPaletteId {
  try {
    const stored = localStorage.getItem(storageKey);
    return isId(stored) ? stored : "mono";
  } catch {
    return "mono";
  }
}

export function applyColorPalette(id: ColorPaletteId): void {
  document.documentElement.dataset.palette = id;
  try {
    localStorage.setItem(storageKey, id);
  } catch {
    return;
  }
}
