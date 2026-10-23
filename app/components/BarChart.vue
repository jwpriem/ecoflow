<template>
  <div class="chart"><Bar :data="chartData" :options="options" /></div>
</template>

<script setup lang="ts">
import { Bar } from 'vue-chartjs'
import { BarElement, CategoryScale, Chart, Legend, LinearScale, Tooltip, type ChartOptions } from 'chart.js'

Chart.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend)
Chart.defaults.font.family = "'Archivo', system-ui, sans-serif"


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

const fmt = (v: number) => (props.format ? props.format(v) : `${num(v)}${props.unit ? ' ' + props.unit : ''}`)

// Re-read the palette when the sky turns
const sky = useState('sky')

const chartData = computed(() => {
  void sky.value
  return {
    labels: props.labels,
    datasets: props.series.map((s) => ({
      label: s.label,
      data: s.data,
      backgroundColor: s.colors ? s.colors.map(cssVar) : cssVar(s.color),
      borderColor: cssVar('--bg'),
      borderWidth: props.stacked ? { top: 1 } : 0,
      borderRadius: 2,
      borderSkipped: 'start' as const,
      categoryPercentage: 0.86,
      barPercentage: 0.9,
    })),
  }
})

const options = computed<ChartOptions<'bar'>>(() => {
  void sky.value
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
          duration: 500,
          easing: 'easeOutQuart',
        },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: props.legend ?? props.series.length > 1, position: 'bottom', align: 'start', labels: { color: text2, boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 2, padding: 14, font: { size: 13 } } },
      tooltip: {
        backgroundColor: cssVar('--text'),
        titleColor: cssVar('--bg'),
        bodyColor: cssVar('--bg'),
        titleFont: { weight: 600, size: 13 },
        bodyFont: { size: 13 },
        padding: 10,
        cornerRadius: 6,
        boxPadding: 4,
        usePointStyle: true,
        callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmt(ctx.parsed.y ?? 0)}` },
      },
    },
    scales: {
      x: { stacked: props.stacked, grid: { display: false }, ticks: { color: muted, maxRotation: 0, autoSkipPadding: 14, font: { size: 12 } }, border: { display: true, color: cssVar('--rule') } },
      y: { stacked: props.stacked, position: 'right', grid: { color: grid }, border: { display: false }, ticks: { color: muted, maxTicksLimit: 5, font: { size: 12 }, callback: (v) => fmt(Number(v)) } },
    },
  }
})
</script>
