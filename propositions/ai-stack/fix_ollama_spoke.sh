#!/bin/bash
set -e

echo "🔧 Fixing Ollama A2A Spoke installation"

# Create venv for spoke
VENV_DIR="/home/patrice/DEV/world-model/scripts/.venv"
echo "📦 Creating Python venv..."
python3 -m venv "$VENV_DIR" --upgrade-deps

# Install dependencies in venv
echo "📦 Installing Python dependencies in venv..."
"$VENV_DIR/bin/pip" install -q fastapi uvicorn requests

# Update systemd service to use venv
echo "⚙️  Updating systemd service to use venv..."
sudo tee /etc/systemd/system/ollama-a2a-spoke.service > /dev/null <<UNIT
[Unit]
Description=Ollama A2A Spoke
After=ollama.service network-online.target
Wants=network-online.target

[Service]
Type=simple
User=patrice
WorkingDirectory=/home/patrice/DEV/world-model/scripts
ExecStart=$VENV_DIR/bin/python ollama_a2a_spoke.py --port 3002
Restart=on-failure
RestartSec=10
StandardOutput=append:/var/log/ollama-a2a-spoke.log
StandardError=append:/var/log/ollama-a2a-spoke.log

[Install]
WantedBy=multi-user.target
UNIT

# Reload and restart
echo "🔄 Reloading systemd..."
sudo systemctl daemon-reload

echo "▶️  Restarting service..."
sudo systemctl restart ollama-a2a-spoke.service

# Wait for startup
sleep 3

# Test endpoint
echo "🧪 Testing endpoint..."
RESULT=$(curl -s http://127.0.0.1:3002/api/a2a/.well-known/agent.json 2>/dev/null | jq '.name' 2>/dev/null)

if [ -n "$RESULT" ]; then
  echo "✅ Spoke is responding!"
  echo ""
  echo "Agent: $RESULT"
  echo ""
  curl -s http://127.0.0.1:3002/api/a2a/.well-known/agent.json 2>/dev/null | jq '.skills | length' | xargs -I {} echo "Skills: {} models exposed"
else
  echo "⚠️  Spoke not responding yet. Check logs:"
  echo "  sudo tail -20 /var/log/ollama-a2a-spoke.log"
  exit 1
fi

echo ""
echo "✅ All good!"
echo ""
echo "Endpoints:"
echo "  Localhost: http://127.0.0.1:3002/api/a2a/.well-known/agent.json"
echo "  Network: http://100.98.18.76:3002/api/a2a/.well-known/agent.json"
echo "  Health: http://127.0.0.1:3002/health"
echo ""
echo "Status:"
sudo systemctl status ollama-a2a-spoke.service --no-pager
