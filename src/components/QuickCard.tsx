// src/components/QuickCard.tsx

interface QuickCardProps {
    title: string
    value: number
    prefix?: string
  }
  
  export default function QuickCard({
    title,
    value,
    prefix = ''
  }: QuickCardProps) {
    return (
      <div className="bg-white rounded-2xl shadow-ios p-4 text-center">
        <div className="text-sm text-gray-500">{title}</div>
        <div className="text-2xl font-semibold">
          {prefix}
          {value.toLocaleString()}
        </div>
      </div>
    )
  }
  