import { useMemo } from 'react';
import { SpeedSample } from '../../shared/types';

// ──────────────────────────────────────────────────────────────────────────────
// Tiny inline sparkline used inside TransferCard rows
// ──────────────────────────────────────────────────────────────────────────────

interface SpeedGraphProps {
  data: SpeedSample[];
  width?: number;
  height?: number;
}

export default function SpeedGraph({ data, width = 120, height = 32 }: SpeedGraphProps) {
  const { line, fill, color } = useMemo(() => {
    if (data.length < 2) return { line: '', fill: '', color: '#94a3b8' };

    const maxSpeed = Math.max(...data.map(d => d.bytesPerSecond), 1);
    const gw = width - 4;
    const gh = height - 4;

    const pts = data.map((s, i) => {
      const x = 2 + (i / (data.length - 1)) * gw;
      const y = 2 + gh - (s.bytesPerSecond / maxSpeed) * gh;
      return [x, y] as [number, number];
    });

    const line = pts.map(([x, y]) => `${x},${y}`).join(' ');
    const first = pts[0], last = pts[pts.length - 1];
    const fill = `${line} ${last[0]},${height - 2} ${first[0]},${height - 2}`;

    const avg = data.reduce((s, d) => s + d.bytesPerSecond, 0) / data.length;
    const ratio = avg / maxSpeed;
    const color = ratio > 0.7 ? '#22c55e' : ratio > 0.4 ? '#f59e0b' : '#3b82f6';

    return { line, fill, color };
  }, [data, width, height]);

  if (data.length < 2) {
    return (
      <svg width={width} height={height} className="opacity-30">
        <line x1="2" y1={height / 2} x2={width - 2} y2={height / 2} stroke="#94a3b8" strokeWidth="1" strokeDasharray="2,2" />
      </svg>
    );
  }

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polygon points={fill} fill={color} opacity={0.15} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Large live speed graph for the Diagnostics window
// ──────────────────────────────────────────────────────────────────────────────

interface LiveSpeedGraphProps {
  data: SpeedSample[];
  /** Width in pixels. Defaults to 100% via viewBox. */
  height?: number;
  label?: string;
  color?: string;
}

export function LiveSpeedGraph({ data, height = 96, label, color = '#3b82f6' }: LiveSpeedGraphProps) {
  const W = 600;
  const H = height;
  const PAD = { top: 12, right: 8, bottom: 28, left: 56 };
  const gw = W - PAD.left - PAD.right;
  const gh = H - PAD.top - PAD.bottom;

  const { line, fill, peak, avg, yTicks, xLabels } = useMemo(() => {
    const samples = data.length > 0 ? data : [{ timestamp: Date.now(), bytesPerSecond: 0 }];
    const maxSpeed = Math.max(...samples.map(d => d.bytesPerSecond), 1024);
    const minT = samples[0].timestamp;
    const maxT = samples[samples.length - 1].timestamp || minT + 1;

    const toX = (t: number) => PAD.left + ((t - minT) / (maxT - minT || 1)) * gw;
    const toY = (v: number) => PAD.top + gh - (v / maxSpeed) * gh;

    const pts = samples.map(s => [toX(s.timestamp), toY(s.bytesPerSecond)] as [number, number]);
    const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const first = pts[0], last = pts[pts.length - 1];
    const baseY = PAD.top + gh;
    const fill = `${line} ${last[0].toFixed(1)},${baseY} ${first[0].toFixed(1)},${baseY}`;

    const peak = Math.max(...samples.map(d => d.bytesPerSecond));
    const avg = samples.reduce((s, d) => s + d.bytesPerSecond, 0) / samples.length;

    // Y axis ticks (5 steps)
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map(r => ({
      y: toY(maxSpeed * r),
      label: formatSpeed(maxSpeed * r),
    }));

    // X axis labels (up to 5)
    const xCount = Math.min(samples.length, 5);
    const xLabels = Array.from({ length: xCount }, (_, i) => {
      const idx = Math.round(i * (samples.length - 1) / (xCount - 1 || 1));
      const s = samples[idx];
      return { x: toX(s.timestamp), label: new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) };
    });

    return { line, fill, peak, avg, yTicks, xLabels };
  }, [data, gw, gh]);

  return (
    <div className="w-full">
      {label && (
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span>Peak <span className="font-mono font-semibold text-slate-700">{formatSpeed(peak)}</span></span>
            <span>Avg <span className="font-mono font-semibold text-slate-700">{formatSpeed(avg)}</span></span>
          </div>
        </div>
      )}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        aria-label={label || 'Speed graph'}
      >
        <defs>
          <linearGradient id={`lg-${color.slice(1)}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Y grid lines + labels */}
        {yTicks.map(({ y, label }, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="#e2e8f0" strokeWidth="1" strokeDasharray={i === 0 ? '0' : '4,4'} />
            <text x={PAD.left - 4} y={y + 4} textAnchor="end" fontSize="10" fill="#94a3b8">{label}</text>
          </g>
        ))}

        {/* X axis labels */}
        {xLabels.map(({ x, label }, i) => (
          <text key={i} x={x} y={H - 4} textAnchor="middle" fontSize="9" fill="#94a3b8">{label}</text>
        ))}

        {/* Area fill */}
        <polygon points={fill} fill={`url(#lg-${color.slice(1)})`} />

        {/* Line */}
        {data.length >= 2 && (
          <polyline
            points={line}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Latest value dot */}
        {data.length >= 1 && (() => {
          const last = data[data.length - 1];
          const maxSpeed = Math.max(...data.map(d => d.bytesPerSecond), 1);
          const minT = data[0].timestamp;
          const maxT = data[data.length - 1].timestamp || minT + 1;
          const x = PAD.left + ((last.timestamp - minT) / (maxT - minT || 1)) * gw;
          const y = PAD.top + gh - (last.bytesPerSecond / maxSpeed) * gh;
          return (
            <circle cx={x} cy={y} r={3} fill={color}>
              <animate attributeName="r" values="3;5;3" dur="1.5s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="1;0.6;1" dur="1.5s" repeatCount="indefinite" />
            </circle>
          );
        })()}
      </svg>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Tiny single-value bar gauge (CPU / Memory %)
// ──────────────────────────────────────────────────────────────────────────────

export function GaugeBar({ value, max, color = '#3b82f6', label }: { value: number; max: number; color?: string; label?: string }) {
  const pct = Math.min(100, (value / Math.max(max, 1)) * 100);
  return (
    <div>
      {label && <div className="text-xs text-slate-400 mb-1">{label}</div>}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${pct}%`, background: color }}
          />
        </div>
        <span className="text-xs font-mono text-slate-600 w-12 text-right">{pct.toFixed(1)}%</span>
      </div>
    </div>
  );
}

export function formatSpeed(bytesPerSecond: number): string {
  if (!bytesPerSecond || bytesPerSecond < 0) return '0 B/s';
  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.min(Math.floor(Math.log(bytesPerSecond) / Math.log(k)), sizes.length - 1);
  return `${(bytesPerSecond / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0)} ${sizes[i]}`;
}
