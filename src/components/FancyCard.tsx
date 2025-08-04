// src/components/FancyCard.tsx
import { motion } from 'framer-motion'

export default function FancyCard({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      className="bg-white rounded-2xl shadow-ios p-6"
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.3 }}
    >
      {children}
    </motion.div>
  )
}
