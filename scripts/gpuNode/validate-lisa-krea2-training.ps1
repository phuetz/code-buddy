$ErrorActionPreference = 'Stop'
$runtime = 'D:\DEV\Krea2TrainerRuntime'
$toolkit = Join-Path $runtime 'ai-toolkit'
$python = Join-Path $runtime 'venv\Scripts\python.exe'
$config = Join-Path $runtime 'configs\lisa-krea2.yaml'
$dataset = Join-Path $runtime 'workspace\lisa-krea2'

$env:HF_HOME = Join-Path $runtime 'hf_cache'
$env:PYTHONPATH = $toolkit
$env:PYTHONUTF8 = '0'
$env:PYTHONIOENCODING = 'utf-8'
$env:NO_ALBUMENTATIONS_UPDATE = '1'

if ((Get-ChildItem $dataset -File -Filter '*.png').Count -ne 24) {
  throw 'Expected 24 Krea 2 training images'
}
if ((Get-ChildItem $dataset -File -Filter '*.txt').Count -ne 24) {
  throw 'Expected 24 Krea 2 captions'
}

Set-Location $toolkit
& $python -c "from toolkit.job import get_job; job=get_job(r'$config', None); print('config=' + type(job).__name__); print('processes=' + str(len(job.process)))"
if ($LASTEXITCODE -ne 0) { throw "ai-toolkit config validation failed: $LASTEXITCODE" }

& nvidia-smi.exe --query-gpu=index,name,memory.total,memory.used --format=csv,noheader
