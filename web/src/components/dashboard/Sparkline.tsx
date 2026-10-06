import { defineChart, lineY } from "@tanstack/charts";
import { Chart } from "@tanstack/charts/react";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { useMemo } from "react";

interface SparklineProps {
  ariaLabel: string;
  color: string;
  height?: number;
  values: number[];
}

/** Minimal line chart used for the dashboard metric tiles. */
export default function Sparkline({ ariaLabel, color, height = 56, values }: SparklineProps) {
  const data = useMemo(
    () => values.map((value, index) => ({ index, value })),
    [values],
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
      }),
    [data, color],
  );

  if (values.length < 2) return null;
  return <Chart ariaLabel={ariaLabel} definition={definition} height={height} />;
}
