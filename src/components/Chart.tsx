// src/components/Chart.tsx
import React from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,               // <— Importar Filler
  ChartOptions
} from 'chart.js'
import { Line } from 'react-chartjs-2'

// Registrar componentes y plugins
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler                // <— Registrar Filler
)

interface TrendsChartProps {
  labels: string[]
  incomeData: number[]
  expenseData: number[]
}

const options: ChartOptions<'line'> = {
  responsive: true,
  plugins: {
    legend: { position: 'bottom' },
    title: { display: false }
  },
  scales: {
    x: { display: true, title: { display: true, text: 'Mes' } },
    y: { display: true, title: { display: true, text: 'Monto' }, beginAtZero: true }
  }
}

export default function TrendsChart({ labels, incomeData, expenseData }: TrendsChartProps) {
  const data = {
    labels,
    datasets: [
      {
        label: 'Ingresos',
        data: incomeData,
        borderColor: '#10B981',
        backgroundColor: '#10B98120',
        tension: 0.4,
        fill: true       // ahora Filler podrá manejar el “fill”
      },
      {
        label: 'Gastos',
        data: expenseData,
        borderColor: '#EF4444',
        backgroundColor: '#EF444420',
        tension: 0.4,
        fill: true
      }
    ]
  }

  return <Line options={options} data={data} />
}
