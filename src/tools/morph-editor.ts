import * as path from "path";
import axios from "axios";
import { ToolResult, getErrorMessage } from "../types/index.js";
import { ConfirmationService } from "../utils/confirmation-service.js";
import { logger } from "../utils/logger.js";
import { UnifiedVfsRouter } from "../services/vfs/unified-vfs-router.js";
import { generateDiff as sharedGenerateDiff } from "../utils/diff-generator.js";

export class MorphEditorTool {
  private confirmationService = ConfirmationService.getInstance();
  private morphApiKey: string;
  private morphBaseUrl: string = "https://api.morphllm.com/v1";
  private vfs = UnifiedVfsRouter.Instance;

  constructor(apiKey?: string) {
    this.morphApiKey = apiKey || process.env.MORPH_API_KEY || "";
    if (!this.morphApiKey) {
      logger.warn("MORPH_API_KEY not found. Morph editor functionality will be limited.");
    }
  }

  /**
   * Use this tool to make an edit to an existing file.
   * 
   * This will be read by a less intelligent model, which will quickly apply the edit. You should make it clear what the edit is, while also minimizing the unchanged code you write.
   * When writing the edit, you should specify each edit in sequence, with the special comment // ... existing code ... to represent unchanged code in between edited lines.
   * 
   * For example:
   * 
   * // ... existing code ...
   * FIRST_EDIT
   * // ... existing code ...
   * SECOND_EDIT
   * // ... existing code ...
   * THIRD_EDIT
   * // ... existing code ...
   * 
   * You should still bias towards repeating as few lines of the original file as possible to convey the change.
   * But, each edit should contain sufficient context of unchanged lines around the code you're editing to resolve ambiguity.
   * DO NOT omit spans of pre-existing code (or comments) without using the // ... existing code ... comment to indicate its absence. If you omit the existing code comment, the model may inadvertently delete these lines.
   * If you plan on deleting a section, you must provide context before and after to delete it. If the initial code is ```code \n Block 1 \n Block 2 \n Block 3 \n code```, and you want to remove Block 2, you would output ```// ... existing code ... \n Block 1 \n  Block 3 \n // ... existing code ...```.
   * Make sure it is clear what the edit should be, and where it should be applied.
   * Make edits to a file in a single edit_file call instead of multiple edit_file calls to the same file. The apply model can handle many distinct edits at once.
   */
  async editFile(
    targetFile: string,
    instructions: string,
    codeEdit: string
  ): Promise<ToolResult> {
    try {
      const resolvedPath = path.resolve(targetFile);

      if (!(await this.vfs.exists(resolvedPath))) {
        return {
          success: false,
          error: `File not found: ${targetFile}`,
        };
      }

      if (!this.morphApiKey) {
        return {
          success: false,
          error: "MORPH_API_KEY not configured. Please set your Morph API key.",
        };
      }

      // Read the initial code
      const initialCode = await this.vfs.readFile(resolvedPath, "utf-8");

      // Check user confirmation before proceeding
      const sessionFlags = this.confirmationService.getSessionFlags();
      if (!sessionFlags.fileOperations && !sessionFlags.allOperations) {
        const confirmationResult = await this.confirmationService.requestConfirmation(
          {
            operation: "Edit file with Morph Fast Apply",
            filename: targetFile,
            showVSCodeOpen: false,
            content: `Instructions: ${instructions}\n\nEdit:\n${codeEdit}`,
          },
          "file"
        );

        if (!confirmationResult.confirmed) {
          return {
            success: false,
            error: confirmationResult.feedback || "File edit cancelled by user",
          };
        }
      }

      // Call Morph Fast Apply API
      const mergedCode = await this.callMorphApply(instructions, initialCode, codeEdit);

      // Write the merged code back to file
      await this.vfs.writeFile(resolvedPath, mergedCode, "utf-8");

      // Generate diff for display
      const oldLines = initialCode.split("\n");
      const newLines = mergedCode.split("\n");
      const diff = this.generateDiff(oldLines, newLines, targetFile);

      return {
        success: true,
        output: diff,
      };
    } catch (error) {
      return {
        success: false,
        error: `Error editing ${targetFile} with Morph: ${getErrorMessage(error)}`,
      };
    }
  }

  private async callMorphApply(
    instructions: string,
    initialCode: string,
    editSnippet: string
  ): Promise<string> {
    try {
      const response = await axios.post(`${this.morphBaseUrl}/chat/completions`, {
        model: "morph-v3-large",
        messages: [
          {
            role: "user",
            content: `<instruction>${instructions}</instruction>\n<code>${initialCode}</code>\n<update>${editSnippet}</update>`,
          },
        ],
      }, {
        headers: {
          "Authorization": `Bearer ${this.morphApiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.data.choices || !response.data.choices[0] || !response.data.choices[0].message) {
        throw new Error("Invalid response from Morph API: expected 'choices' array with message content. The API may have changed or be unavailable.");
      }

      return response.data.choices[0].message.content;
    } catch (error) {
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as { response: { status: number; data: unknown } };
        throw new Error(`Morph API request failed with status ${axiosError.response.status}. ${axiosError.response.status === 401 ? 'Check your MORPH_API_KEY.' : axiosError.response.status === 429 ? 'Rate limit exceeded, please try again later.' : `Response: ${JSON.stringify(axiosError.response.data).slice(0, 200)}` }`);
      }
      throw error;
    }
  }

  /**
   * Generate unified diff between old and new content
   * Uses shared diff-generator utility for consistent diff output across tools
   */
  private generateDiff(
    oldLines: string[],
    newLines: string[],
    filePath: string
  ): string {
    return sharedGenerateDiff(oldLines, newLines, filePath, {
      summaryPrefix: 'Updated',
    }).diff.replace(
      `Updated ${filePath}`,
      `Updated ${filePath} with Morph Fast Apply`
    );
  }

  async view(
    filePath: string,
    viewRange?: [number, number]
  ): Promise<ToolResult> {
    try {
      const resolvedPath = path.resolve(filePath);

      if (await this.vfs.exists(resolvedPath)) {
        const stats = await this.vfs.stat(resolvedPath);

        if (stats.isDirectory()) {
          const files = await this.vfs.readdir(resolvedPath);
          return {
            success: true,
            output: `Directory contents of ${filePath}:\n${files.join("\n")}`,
          };
        }

        const content = await this.vfs.readFile(resolvedPath, "utf-8");
        const lines = content.split("\n");

        if (viewRange) {
          const [start, end] = viewRange;
          const selectedLines = lines.slice(start - 1, end);
          const numberedLines = selectedLines
            .map((line, idx) => `${start + idx}: ${line}`)
            .join("\n");

          return {
            success: true,
            output: `Lines ${start}-${end} of ${filePath}:\n${numberedLines}`,
          };
        }

        const totalLines = lines.length;
        const displayLines = totalLines > 10 ? lines.slice(0, 10) : lines;
        const numberedLines = displayLines
          .map((line, idx) => `${idx + 1}: ${line}`)
          .join("\n");
        const additionalLinesMessage =
          totalLines > 10 ? `\n... +${totalLines - 10} lines` : "";

        return {
          success: true,
          output: `Contents of ${filePath}:\n${numberedLines}${additionalLinesMessage}`,
        };
      } else {
        return {
          success: false,
          error: `File or directory not found: ${filePath}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: `Error viewing ${filePath}: ${getErrorMessage(error)}`,
      };
    }
  }

  setApiKey(apiKey: string): void {
    this.morphApiKey = apiKey;
  }

  getApiKey(): string {
    return this.morphApiKey;
  }
}