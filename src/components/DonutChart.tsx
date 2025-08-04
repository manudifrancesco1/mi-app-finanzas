// src/components/DonutChart.tsx
import { Doughnut } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  type ChartData
} from 'chart.js'

// 1) Registrar el elemento que maneja los "arcs" del doughnut
ChartJS.register(ArcElement, Tooltip, Legend)

interface DonutChartProps {
  data: Array<{ label: string; value: number }>
}

export default function DonutChart({ data }: DonutChartProps) {
  // 2) Construir el objeto data con tipado
  const chartData: ChartData<'doughnut', number[], string> = {
    labels: data.map((d) => d.label),
    datasets: [
      {
        data: data.map((d) => d.value),
        // puedes dejar que Chart.js asigne colores o definir tu paleta
        backgroundColor: [
          '#3B82F6',
          '#10B981',
          '#F59E0B',
          '#EF4444',
          '#8B5CF6',
          '#F472B6'
        ]
      }
    ]
  }

  return (
    <Doughnut
      data={chartData}
      options={{
        responsive: true,
        plugins: {
          legend: { position: 'bottom' }
        }
      }}
    />
  )
}
