$ErrorActionPreference = 'Stop'

$comfyRoot = 'D:\DEV\ComfyUI'
$python = Join-Path $comfyRoot 'venv\Scripts\python.exe'

if (-not (Test-Path $python)) { throw "Missing ComfyUI Python: $python" }

Stop-ScheduledTask -TaskName 'CodeBuddy-ComfyUI' -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
$env:PYTHONUTF8 = '0'
$env:PYTHONIOENCODING = 'utf-8'

# ComfyUI 0.28 warns that DynamicVRAM requires torch >=2.8. Krea 2 reaches
# the 24 GB ceiling under torch 2.6's legacy ModelPatcher, so upgrade only this
# dedicated venv to the stable CUDA 12.8 wheels supported by the RTX 3090.
& $python -m pip install --disable-pip-version-check --upgrade `
  'torch==2.8.0' `
  'torchvision==0.23.0' `
  'torchaudio==2.8.0' `
  --index-url 'https://download.pytorch.org/whl/cu128'
if ($LASTEXITCODE -ne 0) { throw "PyTorch upgrade failed: $LASTEXITCODE" }

& $python -c "import torch; assert torch.cuda.is_available(); print('torch=' + torch.__version__); print('cuda=' + str(torch.version.cuda)); print('gpu=' + torch.cuda.get_device_name(0))"
if ($LASTEXITCODE -ne 0) { throw "CUDA validation failed: $LASTEXITCODE" }

Start-ScheduledTask -TaskName 'CodeBuddy-ComfyUI'
$ready = $false
for ($attempt = 1; $attempt -le 120; $attempt++) {
  Start-Sleep -Seconds 1
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8188/' -TimeoutSec 2
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
      $ready = $true
      break
    }
  } catch {
    # Continue while ComfyUI starts.
  }
}
if (-not $ready) { throw 'ComfyUI did not become ready within 120 seconds' }
Write-Output 'ComfyUI torch upgrade complete and service ready'
