#!/bin/bash
set -e

echo "🚀 Installing Ollama A2A Spoke systemd service"

# Check if spoke script exists
if [ ! -f "$HOME/DEV/world-model/scripts/ollama_a2a_spoke.py" ]; then
  echo "❌ Spoke script not found at ~/DEV/world-model/scripts/ollama_a2a_spoke.py"
  exit 1
fi

# Install Python dependencies
echo "📦 Installing Python dependencies..."
pip install fastapi uvicorn requests -q

# Create systemd service
echo "⚙️  Creating systemd service..."
sudo tee /etc/systemd/system/ollama-a2a-spoke.service > /dev/null <<'UNIT'
[Unit]
Description=Ollama A2A Spoke
After=ollama.service network-online.target
Wants=network-online.target

[Service]
Type=simple
User=patrice
WorkingDirectory=/home/patrice/DEV/world-model/scripts
ExecStart=/usr/bin/python3 ollama_a2a_spoke.py --port 3002
Restart=on-failure
RestartSec=10
StandardOutput=append:/var/log/ollama-a2a-spoke.log
StandardError=append:/var/log/ollama-a2a-spoke.log

[Install]
WantedBy=multi-user.target
UNIT

# Reload and enable
echo "🔄 Reloading systemd..."
sudo systemctl daemon-reload

echo "▶️  Starting service..."
sudo systemctl enable --now ollama-a2a-spoke.service

echo ""
echo "✅ Service installed!"
echo ""
echo "Status:"
sudo systemctl status ollama-a2a-spoke.service

echo ""
echo "Logs:"
echo "  sudo tail -f /var/log/ollama-a2a-spoke.log"
echo ""
echo "Endpoints:"
echo "  Discovery: http://127.0.0.1:3002/api/a2a/.well-known/agent.json"
echo "  Health: http://127.0.0.1:3002/health"
echo "  Cross-host: http://100.98.18.76:3002/api/a2a/.well-known/agent.json"
