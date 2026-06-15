// @ts-nocheck
import React from 'react';
import { Check, X, Clock, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import type { SubWorkflowExecutionsProps, ExecutionStatus } from './types';

function getStatusIcon(status: ExecutionStatus) {
  switch (status) {
    case 'running': return <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />;
    case 'success': return <Check className="w-4 h-4 text-green-500" />;
    case 'failed': return <X className="w-4 h-4 text-red-500" />;
    case 'cancelled': return <X className="w-4 h-4 text-gray-500" />;
    case 'timeout': return <Clock className="w-4 h-4 text-orange-500" />;
    default: return <Clock className="w-4 h-4 text-gray-400" />;
  }
}

export const SubWorkflowExecutions: React.FC<SubWorkflowExecutionsProps> = ({
  executions,
  subWorkflows
}) => {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Recent Executions</h3>

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Sub-workflow</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Status</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Started</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Duration</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Inputs</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Outputs</th>
            </tr>
          </thead>
          <tbody>
            {executions.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  No executions yet
                </td>
              </tr>
            ) : (
              executions.map((execution, index) => (
                <tr key={execution.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-sm">
                      {subWorkflows.find(sw => sw.id === execution.subWorkflowId)?.name || execution.subWorkflowId}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(execution.status)}
                      <span className="text-sm">{execution.status}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {format(execution.startTime, 'PPp')}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {execution.duration ? `${(execution.duration / 1000).toFixed(2)}s` : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <button className="text-sm text-blue-600 hover:underline">
                      View
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    {execution.outputs ? (
                      <button className="text-sm text-blue-600 hover:underline">
                        View
                      </button>
                    ) : (
                      <span className="text-sm text-gray-500">-</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SubWorkflowExecutions;
