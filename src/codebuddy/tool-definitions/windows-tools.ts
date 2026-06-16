import { CodeBuddyTool } from "./types.js";

export const WINDOWS_TOOLS: CodeBuddyTool[] = [
  {
    type: "function",
    function: {
      name: "office_macro_execute",
      description: "Executes VBA or PowerShell macros directly in Windows Microsoft Office applications (Excel, Word, PowerPoint). This tool is only available on Windows.",
      parameters: {
        type: "object",
        properties: {
          application: {
            type: "string",
            description: "The Microsoft Office application to target",
            enum: ["Excel", "Word", "PowerPoint"],
          },
          macroCode: {
            type: "string",
            description: "The VBA code or PowerShell code to execute",
          },
          type: {
            type: "string",
            description: "The type of macro code being provided",
            enum: ["vba", "powershell"],
          },
          runHeadless: {
            type: "boolean",
            description: "If true, the application will run invisibly in the background and will be closed after execution.",
          },
        },
        required: ["application", "macroCode", "type"],
      },
    },
  },
];
