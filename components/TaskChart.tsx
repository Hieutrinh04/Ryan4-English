"use client";

// Vẽ biểu đồ cho đề Task 1 từ số liệu trong lib/writing-tasks.mjs.
//
// Vẽ bằng SVG thay vì kèm ảnh: số liệu là của dự án, ảnh không phải tải về, và
// biểu đồ ăn theo màu giao diện nên đổi tông màu thì nó đổi theo.

export type Chart = {
  type: "line" | "bar";
  unit: string;
  xLabels: string[];
  series: { name: string; values: number[] }[];
};

// Màu vẽ dùng thang riêng, KHÔNG dùng màu nhấn của giao diện: các đường phải phân
// biệt được với nhau, mà màu nhấn thì chỉ có một tông.
const COLOURS = ["#6ea8fe", "#f4a261", "#5fc98f", "#e07a9c", "#c4a5f0", "#4bd0d0"];

const WIDTH = 620;
const HEIGHT = 300;
const PAD = { top: 16, right: 14, bottom: 46, left: 44 };

export default function TaskChart({ chart, title }: { chart: Chart; title: string }) {
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const all = chart.series.flatMap((series) => series.values);
  // Trần luôn cao hơn giá trị lớn nhất một chút để đỉnh không chạm mép khung.
  const max = Math.max(1, ...all) * 1.12;
  const y = (value: number) => PAD.top + plotHeight - (value / max) * plotHeight;
  const ticks = Array.from({ length: 5 }, (_, index) => (max / 4) * index);

  return (
    <figure className="task-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`Biểu đồ: ${title}. Đơn vị ${chart.unit}.`}>
        {/* Lưới ngang và nhãn trục dọc */}
        {ticks.map((value) => (
          <g key={value}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(value)} y2={y(value)} className="grid" />
            <text x={PAD.left - 8} y={y(value) + 4} className="axis" textAnchor="end">
              {Math.round(value * 10) / 10}
            </text>
          </g>
        ))}

        {chart.type === "line"
          ? chart.series.map((series, index) => (
              <polyline
                key={series.name}
                fill="none"
                stroke={COLOURS[index % COLOURS.length]}
                strokeWidth="2.2"
                strokeLinejoin="round"
                points={series.values
                  .map((value, at) => `${PAD.left + (plotWidth / Math.max(1, chart.xLabels.length - 1)) * at},${y(value)}`)
                  .join(" ")}
              />
            ))
          : chart.xLabels.map((label, at) => {
              // Mỗi nhóm cột chiếm một ô, các chuỗi chia đều bề ngang trong ô đó.
              const slot = plotWidth / chart.xLabels.length;
              const barWidth = Math.min(26, (slot * 0.68) / chart.series.length);
              const groupLeft = PAD.left + slot * at + (slot - barWidth * chart.series.length) / 2;
              return (
                <g key={label}>
                  {chart.series.map((series, index) => (
                    <rect
                      key={series.name}
                      x={groupLeft + barWidth * index}
                      y={y(series.values[at] ?? 0)}
                      width={Math.max(2, barWidth - 2)}
                      height={Math.max(0, PAD.top + plotHeight - y(series.values[at] ?? 0))}
                      fill={COLOURS[index % COLOURS.length]}
                      rx="2"
                    />
                  ))}
                </g>
              );
            })}

        {/* Nhãn trục ngang */}
        {chart.xLabels.map((label, at) => {
          const x =
            chart.type === "line"
              ? PAD.left + (plotWidth / Math.max(1, chart.xLabels.length - 1)) * at
              : PAD.left + (plotWidth / chart.xLabels.length) * (at + 0.5);
          return (
            <text key={label} x={x} y={HEIGHT - PAD.bottom + 18} className="axis" textAnchor="middle">
              {label}
            </text>
          );
        })}

        <line x1={PAD.left} x2={WIDTH - PAD.right} y1={PAD.top + plotHeight} y2={PAD.top + plotHeight} className="axis-line" />
      </svg>

      <figcaption>
        <span className="task-chart-unit">Đơn vị: {chart.unit}</span>
        <span className="task-chart-legend">
          {chart.series.map((series, index) => (
            <i key={series.name}>
              <b style={{ background: COLOURS[index % COLOURS.length] }} />
              {series.name}
            </i>
          ))}
        </span>
      </figcaption>
    </figure>
  );
}
