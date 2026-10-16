<template>
  <div class="chart"><Bar :data="chartData" :options="options" /></div>
</template>

<script setup lang="ts">
import { Bar } from 'vue-chartjs'
import { BarElement, CategoryScale, Chart, Legend, LinearScale, Tooltip, type ChartOptions } from 'chart.js'

Chart.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend)

export interface Series {
  label: string
  data: number[]
  /** CSS variable name, e.g. --series-1 */
  color: string
  /** Per-bar CSS variable names (overrides color) */
  colors?: string[]
}

const props = defineProps<{
  labels: string[]
  series: Series[]
  stacked?: boolean
  unit?: string
  format?: (v: number) => string
  legend?: boolean
}>()

const fmt = (v: number) => (props.format ? props.format(v) : `${v.toFixed(2)}${props.unit ? ' ' + props.unit : ''}`)

const chartData = computed(() => ({
  labels: props.labels,
  datasets: props.series.map((s) => ({
    label: s.label,
    data: s.data,
    backgroundColor: s.colors ? s.colors.map(cssVar) : cssVar(s.color),
    borderColor: cssVar('--surface'),
    borderWidth: props.stacked ? { top: 2 } : 0,
    borderRadius: 6,
    borderSkipped: 'start' as const,
    categoryPercentage: 0.86,
    barPercentage: 0.9,
  })),
}))

const options = computed<ChartOptions<'bar'>>(() => {
  const text2 = cssVar('--text-2')
  const muted = cssVar('--muted')
  const grid = cssVar('--grid')
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  return {
    responsive: true,
    maintainAspectRatio: false,
    // bars grow from the baseline one after another, then ease between datasets
    animation: reduced
      ? false
      : {
          duration: 700,
          easing: 'easeOutQuart',
          delay: (ctx) => (ctx.type === 'data' && ctx.mode === 'default' ? Math.min(ctx.dataIndex * 18, 500) : 0),
        },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: props.legend ?? props.series.length > 1, position: 'top', align: 'start', labels: { color: text2, boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3, font: { size: 12 } } },
      tooltip: {
        backgroundColor: cssVar('--surface-3'),
        titleColor: text2,
        bodyColor: cssVar('--text'),
        padding: 10,
        cornerRadius: 12,
        boxPadding: 4,
        usePointStyle: true,
        callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmt(ctx.parsed.y ?? 0)}` },
      },
    },
    scales: {
      x: { stacked: props.stacked, grid: { display: false }, ticks: { color: muted, maxRotation: 0, autoSkipPadding: 14, font: { size: 11 } }, border: { display: false } },
      y: { stacked: props.stacked, position: 'right', grid: { color: grid }, border: { display: false }, ticks: { color: muted, maxTicksLimit: 5, font: { size: 11 }, callback: (v) => fmt(Number(v)) } },
    },
  }
})
</script>
