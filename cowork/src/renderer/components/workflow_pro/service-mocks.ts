export const useUpdateTimestamp = () => ({ updateTimestamp: Date.now() });
export const NotificationService = { success: () => {}, error: () => {}, info: () => {}, warning: () => {} };
export const notificationService = NotificationService;
export const SimpleLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
export const logger = SimpleLogger;
export const SubWorkflowService = { getSubWorkflows: async () => [], executeSubWorkflow: async () => {} };
export const WorkflowAPI = { fetchWorkflows: async () => [], saveWorkflow: async () => {} };
export const WorkflowDebuggerService = { start: () => {}, stop: () => {}, step: () => {}, breakpoints: [] };
export const WorkflowGenerator = { generateWorkflow: async () => ({ nodes: [], edges: [] }) };
