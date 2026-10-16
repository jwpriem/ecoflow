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
    borderRadius: 4,
    borderSkipped: 'start' as const,
    categoryPercentage: 0.9,
    barPercentage: 0.92,
  })),
}))

const options = computed<ChartOptions<'bar'>>(() => {
  const text2 = cssVar('--text-2')
  const grid = cssVar('--grid')
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: props.legend ?? props.series.length > 1, position: 'top', align: 'start', labels: { color: text2, boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 2 } },
      tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmt(ctx.parsed.y ?? 0)}` } },
    },
    scales: {
      x: { stacked: props.stacked, grid: { display: false }, ticks: { color: text2, maxRotation: 0, autoSkipPadding: 12 }, border: { color: grid } },
      y: { stacked: props.stacked, grid: { color: grid }, border: { display: false }, ticks: { color: text2, callback: (v) => fmt(Number(v)) } },
    },
  }
})
</script>
