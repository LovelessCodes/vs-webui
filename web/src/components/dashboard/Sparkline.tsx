import { defineChart, lineY } from "@tanstack/charts";
import { Chart } from "@tanstack/charts/react";
import { tooltip } from "@tanstack/charts/tooltip";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { useMemo } from "react";

interface MetricPoint {
  ts: number;
  value: number;
}

interface SparklineProps {
  ariaLabel: string;
  color: string;
  height?: number;
  points: MetricPoint[];
  /** Formats a raw value for the current-value line and the hover tooltip. */
  formatValue: (value: number) => string;
  /** Row label shown inside the hover tooltip. */
  valueLabel: string;
}

/** Minimal line chart used for the dashboard metric tiles. */
export default function Sparkline({
  ariaLabel,
  color,
  height = 56,
  points,
  formatValue,
  valueLabel,
}: SparklineProps) {
  const data = useMemo(
    () => points.map((point, index) => ({ index, ts: point.ts, value: point.value })),
    [points],
  );
  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          lineY(data, {
            x: "index",
            y: "value",
            stroke: color,
            strokeWidth: 1.5,
          }),
        ],
        scales: {
          x: { scale: scaleLinear, axis: false },
          y: { scale: scaleLinear, axis: false, nice: true },
        },
        tooltip: {
          use: tooltip,
          placement: ["top", "bottom"],
          offset: 10,
          content: (tooltipPoints) => {
            const point = tooltipPoints[0];
            if (!point) return { rows: [] };
            const datum = point.datum as { ts: number; value: number };
            return {
              title: new Date(datum.ts * 1000).toLocaleTimeString(),
              rows: [
                {
                  label: valueLabel,
                  value: formatValue(datum.value),
                  color,
                },
              ],
            };
          },
        },
      }),
    [data, color, formatValue, valueLabel],
  );

  if (points.length < 2) return null;
  return <Chart ariaLabel={ariaLabel} definition={definition} height={height} />;
}
