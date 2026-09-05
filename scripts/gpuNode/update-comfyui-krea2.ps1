$ErrorActionPreference = 'Stop'
$env:PYTHONUTF8 = '1'

Set-Location 'D:\DEV\ComfyUI'
git status --short
git pull --ff-only
& 'D:\DEV\ComfyUI\venv\Scripts\python.exe' -m pip install --disable-pip-version-check -r requirements.txt
& 'D:\DEV\ComfyUI\venv\Scripts\python.exe' -c "import torch; print('torch=' + torch.__version__); print('cuda=' + str(torch.cuda.is_available()))"
