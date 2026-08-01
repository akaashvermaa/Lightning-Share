import { useMemo } from 'react';
import { SpeedSample } from '../../shared/types';

interface SpeedGraphProps {
  data: SpeedSample[];
  width?: number;
  height?: number;
}

export default function SpeedGraph({ data, width = 120, height = 32 }: SpeedGraphProps) {
  const points = useMemo(() => {
    if (data.length < 2) return '';

    const maxSpeed = Math.max(...data.map(d => d.bytesPerSecond), 1);
    const minSpeed = 0;

    const graphWidth = width - 4;
    const graphHeight = height - 4;

    return data
      .map((sample, index) => {
        const x = 2 + (index / (data.length - 1)) * graphWidth;
        const y = 2 + graphHeight - ((sample.bytesPerSecond - minSpeed) / (maxSpeed - minSpeed)) * graphHeight;
        return `${x},${y}`;
      })
      .join(' ');
  }, [data, width, height]);

  const gradient = useMemo(() => {
    if (data.length < 2) return 'url(#speedGradient)';

    const maxSpeed = Math.max(...data.map(d => d.bytesPerSecond), 1);
    const avgSpeed = data.reduce((sum, d) => sum + d.bytesPerSecond, 0) / data.length;
    const ratio = avgSpeed / maxSpeed;

    if (ratio > 0.7) return '#22c55e';
    if (ratio > 0.4) return '#f59e0b';
    return '#ef4444';
  }, [data]);

  if (data.length < 2) {
    return (
      <svg width={width} height={height} className="opacity-30">
        <line x1="2" y1={height / 2} x2={width - 2} y2={height / 2} stroke="#94a3b8" strokeWidth="1" strokeDasharray="2,2" />
      </svg>
    );
  }

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id="speedGradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={gradient} stopOpacity="0.3" />
          <stop offset="100%" stopColor={gradient} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        points={points}
        fill="none"
        stroke={gradient}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond === 0) return '0 B/s';
  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
  return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
