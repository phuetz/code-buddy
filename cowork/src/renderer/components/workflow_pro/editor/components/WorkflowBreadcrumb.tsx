/**
 * WorkflowBreadcrumb
 *
 * Breadcrumb navigation for sub-workflow hierarchy.
 * Shows: Main Workflow > Sub-Workflow A > Sub-Workflow B
 * Clicking a breadcrumb navigates back to that workflow level.
 */

import React from 'react';
import { ChevronRight, Home } from 'lucide-react';
import { useWorkflowStore } from '../../store';

interface BreadcrumbItem {
  id: string;
  name: string;
}

interface WorkflowBreadcrumbProps {
  items: BreadcrumbItem[];
  onNavigate: (item: BreadcrumbItem, index: number) => void;
}

const WorkflowBreadcrumb: React.FC<WorkflowBreadcrumbProps> = ({ items, onNavigate }) => {
  const darkMode = useWorkflowStore((s) => s.darkMode);

  if (items.length <= 1) return null;

  const text = darkMode ? 'text-gray-300' : 'text-gray-600';
  const textMuted = darkMode ? 'text-gray-500' : 'text-gray-400';
  const hoverBg = darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100';
  const bg = darkMode ? 'bg-gray-900/80' : 'bg-white/80';

  return (
    <nav
      aria-label="Workflow navigation"
      className={`flex items-center gap-1 px-3 py-1.5 ${bg} backdrop-blur-sm rounded-lg border ${darkMode ? 'border-gray-700' : 'border-gray-200'} text-xs`}
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <React.Fragment key={item.id}>
            {index === 0 && <Home className={`w-3 h-3 ${textMuted} mr-0.5`} />}
            <button
              onClick={() => !isLast && onNavigate(item, index)}
              className={`px-1.5 py-0.5 rounded ${
                isLast
                  ? `font-semibold ${text} cursor-default`
                  : `${textMuted} ${hoverBg} cursor-pointer transition-colors`
              } max-w-[120px] truncate`}
              disabled={isLast}
            >
              {item.name}
            </button>
            {!isLast && <ChevronRight className={`w-3 h-3 ${textMuted} flex-shrink-0`} />}
          </React.Fragment>
        );
      })}
    </nav>
  );
};

export default WorkflowBreadcrumb;
