/**
 * Art style switch.
 * Change DEFAULT_ART_STYLE to "pixel" to ship the pixel-art look again.
 * A saved choice in localStorage (key `tank-builder-art-style`) overrides this
 * until it is cleared. The garage toggle writes that key.
 */
export type ArtStyle = "smooth" | "pixel";

export const DEFAULT_ART_STYLE: ArtStyle = "smooth";

export const ART_STYLE_KEY = "tank-builder-art-style";

export function readArtStyle(): ArtStyle {
  try {
    const stored = localStorage.getItem(ART_STYLE_KEY);
    if (stored === "smooth" || stored === "pixel") return stored;
  } catch {
    /* private mode */
  }
  return DEFAULT_ART_STYLE;
}

export function writeArtStyle(style: ArtStyle): void {
  localStorage.setItem(ART_STYLE_KEY, style);
}

export function applyArtStyle(): void {
  document.documentElement.dataset.art = readArtStyle();
}
