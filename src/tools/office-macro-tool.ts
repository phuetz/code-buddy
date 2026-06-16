import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import type { ToolResult } from '../types/index.js';

const execAsync = promisify(exec);

export interface OfficeMacroToolInput {
  application: 'Excel' | 'Word' | 'PowerPoint';
  macroCode: string;
  type: 'vba' | 'powershell';
  runHeadless?: boolean;
}

export class OfficeMacroTool {
  public async execute(input: OfficeMacroToolInput): Promise<ToolResult> {
    if (process.platform !== 'win32') {
      return {
        success: false,
        error: 'Office Macro Tool is only supported on Windows (win32 platform).',
      };
    }

    try {
      const { application, macroCode, type, runHeadless = false } = input;
      const appName = `"${application}.Application"`;

      let psScript = '';

      if (type === 'powershell') {
        psScript = `
$ErrorActionPreference = "Stop"
$app = New-Object -ComObject ${appName}
$app.Visible = $${!runHeadless}
try {
${macroCode.split(/\r?\n/).map((l) => '    ' + l).join('\n')}
} finally {
    # We do not automatically quit here to allow user interaction unless specified in the script
}
        `.trim();
      } else if (type === 'vba') {
        // Wrapper to inject VBA code into the application and run it
        // This usually requires 'Trust access to the VBA project object model' in Office settings.
        psScript = `
$ErrorActionPreference = "Stop"
$app = New-Object -ComObject ${appName}
$app.Visible = $${!runHeadless}
try {
    $workbook = $null
    if ("${application}" -eq "Excel") {
        $workbook = $app.Workbooks.Add()
    } elseif ("${application}" -eq "Word") {
        $workbook = $app.Documents.Add()
    } elseif ("${application}" -eq "PowerPoint") {
        $workbook = $app.Presentations.Add()
    }
    
    if ($workbook -ne $null) {
        $vbext_ct_StdModule = 1
        $module = $workbook.VBProject.VBComponents.Add($vbext_ct_StdModule)
        $module.CodeModule.AddFromString(@"
${macroCode}
"@)
        
        # We try to run the first parameterless macro found or a specific name if we can infer it.
        # But commonly, for VBA injection, the user script should define a 'Sub Main()' and we run it.
        $app.Run("Main")
    }
} catch {
    Write-Error $_.Exception.Message
} finally {
    # If headless, we quit
    if (${runHeadless ? '$true' : '$false'}) {
        $app.Quit()
        [System.Runtime.Interopservices.Marshal]::ReleaseComObject($app) | Out-Null
    }
}
        `.trim();
      } else {
        return { success: false, error: `Unsupported macro type: ${type}` };
      }

      // Save to a temporary file
      const tempDir = os.tmpdir();
      const psFilePath = path.join(tempDir, `office_macro_${Date.now()}.ps1`);
      await fs.writeFile(psFilePath, psScript, 'utf8');

      // Execute via Powershell
      const { stdout, stderr } = await execAsync(`powershell.exe -ExecutionPolicy Bypass -File "${psFilePath}"`, {
        timeout: 60000, // 60 seconds max
      });

      // Cleanup
      await fs.unlink(psFilePath).catch(() => {});

      if (stderr) {
        return { success: false, error: stderr.trim() };
      }

      return { success: true, output: stdout.trim() || 'Macro executed successfully.' };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
