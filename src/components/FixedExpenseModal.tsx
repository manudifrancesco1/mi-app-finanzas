// src/components/FixedExpenseModal.tsx
import React from 'react';

export type FixedExpenseModalProps = {
  onClose?: () => void;
  onSaved?: () => void;
  // Permissive props to avoid type errors while we iterate on the real modal:
  groupKey?: string;
  categoryName?: string;
  amount?: number | string;
  tx?: any;
};

/**
 * Placeholder component to keep the build green.
 * TODO: Implement the real Fixed Expense modal UI/logic and wire it to Expenses page.
 */
export default function FixedExpenseModal(_props: FixedExpenseModalProps) {
  return null;
}