# Train Lisa LoRA on Darkstar GPU (default GPU1) then print install path.
param(
  [int]$Gpu = 1,
  [int]$Steps = 1000,
  [string]$Trigger = "ohwx lisa",
  [string]$Images = "D:\DEV\lisa-lora\images",
  [string]$Checkpoint = "D:\DEV\ComfyUI\models\checkpoints\RealVisXL_V4.0_Lightning.safetensors",
  [string]$Out = "D:\DEV\ComfyUI\models\loras\lisa.safetensors",
  [string]$ComfyPython = "D:\DEV\ComfyUI\venv\Scripts\python.exe",
  [string]$TrainScript = "D:\DEV\lisa-lora\train-lisa-lora.py"
)

$ErrorActionPreference = "Stop"
$env:CUDA_VISIBLE_DEVICES = "$Gpu"
$env:PYTORCH_CUDA_ALLOC_CONF = "expandable_segments:True"

if (-not (Test-Path $Images)) { throw "Images dir missing: $Images" }
if (-not (Test-Path $Checkpoint)) { throw "Checkpoint missing: $Checkpoint" }
if (-not (Test-Path $TrainScript)) { throw "Train script missing: $TrainScript" }

Write-Host "=== Lisa LoRA train on GPU$Gpu ==="
Write-Host "images=$Images"
Write-Host "checkpoint=$Checkpoint"
Write-Host "out=$Out steps=$Steps"

& $ComfyPython $TrainScript `
  --images $Images `
  --checkpoint $Checkpoint `
  --out $Out `
  --steps $Steps `
  --trigger $Trigger `
  --device "cuda:0" `
  --rank 16 `
  --batch 1

if ($LASTEXITCODE -ne 0) { throw "train failed exit=$LASTEXITCODE" }
Write-Host "DONE: $Out"
Get-Item $Out | Format-List FullName, Length, LastWriteTime
