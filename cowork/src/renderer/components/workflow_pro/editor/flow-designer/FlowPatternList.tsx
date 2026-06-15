import React from 'react';
import { useWorkflowStore } from '../../store';
import { FlowPattern } from './types';

interface FlowPatternListProps {
  patterns: FlowPattern[];
  selectedPattern: FlowPattern | null;
  onSelectPattern: (pattern: FlowPattern) => void;
}

export const FlowPatternList: React.FC<FlowPatternListProps> = ({
  patterns,
  selectedPattern,
  onSelectPattern
}) => {
  const darkMode = useWorkflowStore(state => state.darkMode);

  return (
    <div className="w-1/3 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
      <div className="p-4 space-y-3">
        {patterns.map((pattern) => (
          <button
            key={pattern.id}
            onClick={() => onSelectPattern(pattern)}
            className={`w-full p-4 rounded-lg text-left transition-all ${
              selectedPattern?.id === pattern.id
                ? 'bg-indigo-500 text-white shadow-lg'
                : darkMode
                  ? 'bg-gray-800 hover:bg-gray-700 border border-gray-700'
                  : 'bg-white hover:bg-gray-50 border border-gray-200'
            }`}
          >
            <div className="flex items-start space-x-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                selectedPattern?.id === pattern.id
                  ? 'bg-white bg-opacity-20'
                  : darkMode
                    ? 'bg-gray-700'
                    : 'bg-gray-100'
              }`}>
                <pattern.icon size={20} />
              </div>
              <div className="flex-1">
                <h3 className="font-medium">{pattern.name}</h3>
                <p className={`text-sm mt-1 ${
                  selectedPattern?.id === pattern.id
                    ? 'text-white text-opacity-80'
                    : 'text-gray-500'
                }`}>
                  {pattern.description}
                </p>
                <div className="mt-2">
                  <span className={`inline-block px-2 py-1 rounded-full text-xs ${
                    selectedPattern?.id === pattern.id
                      ? 'bg-white bg-opacity-20 text-white'
                      : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                  }`}>
                    {pattern.category}
                  </span>
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
