const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function fmtBytes(n?: number | null): string {
  if (n == null || !isFinite(n) || n <= 0) return "-";
  let v = n;
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${UNITS[i]}`;
}

export function fmtSpeed(bytesPerSec?: number | null): string {
  if (bytesPerSec == null || bytesPerSec <= 0) return "-";
  return `${fmtBytes(bytesPerSec)}/s`;
}

export function fmtDuration(seconds?: number | null): string {
  if (seconds == null || !isFinite(seconds) || seconds < 0) return "-";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mmss = `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}

export function fmtEta(seconds?: number | null): string {
  if (seconds == null || !isFinite(seconds) || seconds < 0) return "-";
  return fmtDuration(seconds);
}
