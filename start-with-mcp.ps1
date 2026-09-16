# Set this to the absolute path of the Code Explorer executable, or leave default PATH lookup.
$CODE_EXPLORER_BIN = if ($env:CODE_EXPLORER_BIN) { $env:CODE_EXPLORER_BIN } else { "code-explorer" }

if (-Not (Get-Command $CODE_EXPLORER_BIN -ErrorAction SilentlyContinue) -and -Not (Test-Path $CODE_EXPLORER_BIN)) {
    Write-Host "Code Explorer binary not found ($CODE_EXPLORER_BIN). Install it or set CODE_EXPLORER_BIN." -ForegroundColor Red
    exit 1
}

# Set MCP Environment Variables for Code Buddy
$env:CODEBUDDY_MCP_COMMAND = $CODE_EXPLORER_BIN
$env:CODEBUDDY_MCP_ARGS = "mcp"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "   Code Buddy V2 + Code Explorer MCP Integration  " -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "MCP Command: $env:CODEBUDDY_MCP_COMMAND" -ForegroundColor Yellow
Write-Host "MCP Args: $env:CODEBUDDY_MCP_ARGS" -ForegroundColor Yellow
Write-Host "Starting Code Buddy...`n" -ForegroundColor Green

# Launch Code Buddy (Assumes we are in the grok-cli directory)
npm start
