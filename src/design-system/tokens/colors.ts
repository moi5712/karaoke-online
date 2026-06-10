/** 預設頻譜色（深色模式 fallback） */
export type SpectrumColors = {
  bar: string;
  grid: string;
  stroke: string;
  background: string;
};

const spectrumColors: SpectrumColors = {
  bar: "#f43f5e",
  grid: "rgba(244, 63, 94, 0.06)",
  stroke: "rgba(244, 63, 94, 0.25)",
  background: "#0e1322",
};

/** 從 CSS 變數讀取目前主題的頻譜色（Canvas 用） */
export function getSpectrumColors(): SpectrumColors {
  if (typeof window === "undefined") return spectrumColors;

  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;

  return {
    bar: read("--ds-spectrum-bar", spectrumColors.bar),
    grid: read("--ds-spectrum-grid", spectrumColors.grid),
    stroke: read("--ds-spectrum-stroke", spectrumColors.stroke),
    background: read("--ds-surface-inset", spectrumColors.background),
  };
}
