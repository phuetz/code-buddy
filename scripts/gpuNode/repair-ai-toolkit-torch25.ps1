$ErrorActionPreference = 'Stop'

# Krea2Trainer pins torch 2.5.1 but installs ai-toolkit HEAD. Torch 2.5's
# custom-op schema parser accepts typing.List[Tensor], not PEP 585 list[Tensor].
# Current ai-toolkit uses the latter in two ConvRot registrations, so importing
# its quantizer fails before training starts. Keep this isolated compatibility
# repair until the trainer updates its PyTorch pin.
$file = 'D:\DEV\Krea2TrainerRuntime\ai-toolkit\toolkit\util\convrot_quant.py'
$source = Get-Content -Path $file -Raw
$updated = $source.Replace(
  'from typing import Optional',
  'from typing import List, Optional'
).Replace(
  'def _nvfp4_act_quant_op(x: torch.Tensor) -> list[torch.Tensor]:',
  'def _nvfp4_act_quant_op(x: torch.Tensor) -> List[torch.Tensor]:'
).Replace(
  'def _int8_act_quant_op(x: torch.Tensor, qmax: int) -> list[torch.Tensor]:',
  'def _int8_act_quant_op(x: torch.Tensor, qmax: int) -> List[torch.Tensor]:'
)

if ($updated -eq $source -and $source -notmatch 'List\[torch\.Tensor\]') {
  throw 'Expected ConvRot annotations were not found; ai-toolkit may have changed'
}
Set-Content -Path $file -Value $updated -Encoding UTF8

$env:PYTHONPATH = 'D:\DEV\Krea2TrainerRuntime\ai-toolkit'
& 'D:\DEV\Krea2TrainerRuntime\venv\Scripts\python.exe' -c "from toolkit.util.convrot_quant import _nvfp4_act_quant_op, _int8_act_quant_op; print('ConvRot torch 2.5 compatibility: OK')"
if ($LASTEXITCODE -ne 0) { throw "ConvRot validation failed: $LASTEXITCODE" }
