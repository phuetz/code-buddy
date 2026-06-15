import React from 'react';
import { Search } from 'lucide-react';
import { useWorkflowStore } from '../../store';
import { CATEGORY_OPTIONS } from './flowPatterns';

interface FlowDesignerFiltersProps {
  searchTerm: string;
  filterCategory: string;
  onSearchChange: (term: string) => void;
  onCategoryChange: (category: string) => void;
}

export const FlowDesignerFilters: React.FC<FlowDesignerFiltersProps> = ({
  searchTerm,
  filterCategory,
  onSearchChange,
  onCategoryChange
}) => {
  const darkMode = useWorkflowStore(state => state.darkMode);

  return (
    <div className={`px-6 py-4 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
      <div className="flex items-center space-x-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="Search patterns..."
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              className={`w-full pl-10 pr-4 py-2 rounded-lg ${
                darkMode
                  ? 'bg-gray-800 border-gray-700 text-white'
                  : 'bg-white border-gray-200 text-gray-900'
              } border focus:outline-none focus:ring-2 focus:ring-indigo-500`}
            />
          </div>
        </div>
        <select
          value={filterCategory}
          onChange={(e) => onCategoryChange(e.target.value)}
          className={`px-3 py-2 rounded-lg ${
            darkMode
              ? 'bg-gray-800 border-gray-700 text-white'
              : 'bg-white border-gray-200 text-gray-900'
          } border focus:outline-none focus:ring-2 focus:ring-indigo-500`}
        >
          {CATEGORY_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
