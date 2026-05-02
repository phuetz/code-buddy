#!/usr/bin/env python3
"""
Ollama A2A Spoke — Transform Ollama into a fleet participant

Exposes Ollama models as A2A-compatible skills to the Code Buddy hub.
Registers as a spoke at hub (100.98.18.76:3000) and routes task requests to Ollama.

Usage:
  python ollama_a2a_spoke.py
  or: python ollama_a2a_spoke.py --hub http://100.98.18.76:3000 --port 3002
"""

import os
import sys
import json
import socket
import requests
import argparse
import subprocess
from typing import Optional
from datetime import datetime
from pathlib import Path


def detect_hostname() -> str:
    """Cross-platform short hostname (lowercase). On Linux/macOS use
    `hostname -s`; on Windows fall back to socket.gethostname() because
    `hostname -s` is not a valid option there (was failing the wrapper
    on MINISTAR/DARKSTAR Windows hosts)."""
    try:
        return subprocess.check_output(['hostname', '-s'], stderr=subprocess.DEVNULL).decode().strip().lower()
    except Exception:
        return socket.gethostname().split('.')[0].lower()

try:
    from fastapi import FastAPI, HTTPException
    from fastapi.responses import JSONResponse
    import uvicorn
except ImportError:
    print("FastAPI required. Install with: pip install fastapi uvicorn requests")
    sys.exit(1)


class OllamaSpoke:
    def __init__(self, ollama_url: str = "http://127.0.0.1:11434",
                 hub_url: str = "http://100.98.18.76:3000",
                 port: int = 3002,
                 host: str = "0.0.0.0",
                 name: Optional[str] = None,
                 announce_url: Optional[str] = None):
        self.ollama_url = ollama_url
        self.hub_url = hub_url
        self.port = port
        self.host = host
        self.app = FastAPI(title="Ollama A2A Spoke")
        self.models = {}
        self.hostname = detect_hostname()
        # Override-friendly identity for hub registration. Without these,
        # the spoke uses {hostname} which may not resolve cross-host
        # (Windows hostnames don't always map to tailnet IPs).
        self.spoke_name = name or f"ollama-{self.hostname}"
        self.announce_url = announce_url or f"http://{self.hostname}:{self.port}"

        # Setup routes
        self._setup_routes()

    def _setup_routes(self):
        @self.app.get("/api/a2a/.well-known/agent.json")
        async def discovery():
            """A2A discovery endpoint — return AgentCard for this Ollama spoke"""
            return {
                "name": f"Ollama / {self.hostname}",
                "description": "Local Ollama instance exposing LLM models as A2A skills",
                "url": self.announce_url,
                "version": "1.0.0",
                "skills": [
                    {
                        "id": f"ollama-{model['name'].replace(':', '-')}",
                        "name": f"Generate ({model['name']})",
                        "description": f"Generate text using {model['name']} ({model['size']})",
                        "inputModes": ["text/plain"],
                        "outputModes": ["text/plain"]
                    }
                    for model in self.models.values()
                ],
                "capabilities": {
                    "streaming": False,
                    "pushNotifications": False
                }
            }

        @self.app.post("/api/a2a/tasks/send")
        async def task_send(body: dict):
            """A2A standard endpoint — receive task, route to Ollama, return result"""
            try:
                task_id = body.get("id", f"task_{datetime.utcnow().timestamp()}")
                message = body.get("message", {})

                # Extract prompt from A2A message format
                parts = message.get("parts", [])
                prompt = ""
                for part in parts:
                    if part.get("type") == "text":
                        prompt = part.get("text", "")
                        break

                if not prompt:
                    raise ValueError("No text prompt found in message parts")

                # Pick first available model (or use metadata.model if specified)
                metadata = body.get("metadata", {})
                model = metadata.get("model") or list(self.models.keys())[0] if self.models else None

                if not model:
                    raise ValueError("No Ollama models available")

                # Call Ollama
                response = requests.post(
                    f"{self.ollama_url}/api/generate",
                    json={
                        "model": model,
                        "prompt": prompt,
                        "stream": False
                    },
                    timeout=300
                )
                response.raise_for_status()
                result = response.json()

                # Return in A2A format
                return {
                    "id": task_id,
                    "status": "completed",
                    "result": result.get("response", ""),
                    "artifacts": [{
                        "name": "response",
                        "parts": [{"type": "text", "text": result.get("response", "")}]
                    }]
                }
            except Exception as e:
                return JSONResponse(
                    status_code=500,
                    content={
                        "id": body.get("id", "unknown"),
                        "status": "failed",
                        "error": str(e)
                    }
                )

        @self.app.post("/api/a2a/tasks/execute")
        async def execute_task(task: dict):
            """Legacy endpoint — kept for backwards compatibility"""
            try:
                model = task.get("model")
                prompt = task.get("prompt")

                if not model or not prompt:
                    raise HTTPException(status_code=400, detail="model and prompt required")

                # Call Ollama
                response = requests.post(
                    f"{self.ollama_url}/api/generate",
                    json={
                        "model": model,
                        "prompt": prompt,
                        "stream": False
                    },
                    timeout=300
                )
                response.raise_for_status()
                result = response.json()

                return {
                    "task_id": task.get("id", "unknown"),
                    "status": "completed",
                    "result": result.get("response", ""),
                    "timestamp": datetime.utcnow().isoformat()
                }
            except Exception as e:
                return JSONResponse(
                    status_code=500,
                    content={"error": str(e), "task_id": task.get("id")}
                )

        @self.app.get("/health")
        async def health():
            """Health check"""
            try:
                resp = requests.get(f"{self.ollama_url}/api/tags", timeout=5)
                return {"status": "ok", "ollama": "connected"}
            except:
                return JSONResponse(
                    status_code=503,
                    content={"status": "error", "ollama": "disconnected"}
                )

    def discover_models(self):
        """Fetch available models from Ollama"""
        try:
            resp = requests.get(f"{self.ollama_url}/api/tags", timeout=5)
            resp.raise_for_status()
            data = resp.json()
            self.models = {m["name"]: m for m in data.get("models", [])}
            print(f"✅ Discovered {len(self.models)} models:")
            for name, meta in self.models.items():
                print(f"   - {name} ({meta.get('size', 'unknown')})")
            return True
        except Exception as e:
            print(f"⚠️  Failed to discover models: {e}")
            return False

    def discover_hub(self) -> bool:
        """Verify hub is reachable and get its AgentCard"""
        try:
            resp = requests.get(
                f"{self.hub_url}/api/a2a/.well-known/agent.json",
                timeout=5
            )
            resp.raise_for_status()
            agent = resp.json()
            print(f"✅ Hub discovered: {agent.get('name')} @ {self.hub_url}")
            print(f"   Skills: {len(agent.get('skills', []))} available")
            return True
        except Exception as e:
            print(f"⚠️  Hub unreachable: {e}")
            return False

    def register_at_hub(self) -> bool:
        """Register this spoke at the hub (POC Level 1+).

        Wraps the agent_card in the {name, url, card} envelope expected by
        the hub endpoint POST /api/a2a/agents/register (see code-buddy
        commit a85e654)."""
        try:
            agent_card = {
                "name": f"Ollama / {self.hostname}",
                "description": "Local Ollama instance",
                "url": self.announce_url,
                "version": "1.0.0",
                "skills": [
                    {
                        "id": f"ollama-{model['name'].replace(':', '-')}",
                        "name": f"Generate ({model['name']})",
                        "description": f"Generate text using {model['name']}",
                        "inputModes": ["text/plain"],
                        "outputModes": ["text/plain"],
                    }
                    for model in self.models.values()
                ],
                "capabilities": {"streaming": False, "pushNotifications": False},
            }

            # Try to register (POC Level 1 endpoint, code-buddy commit a85e654)
            resp = requests.post(
                f"{self.hub_url}/api/a2a/agents/register",
                json={"name": self.spoke_name, "url": self.announce_url, "card": agent_card},
                timeout=5
            )

            if resp.status_code == 404:
                print("⏳ Hub registration endpoint not ready (POC Level 1 pending)")
                return False
            elif resp.status_code in [200, 201]:
                print(f"✅ Registered at hub: {resp.json()}")
                return True
            else:
                print(f"⚠️  Registration failed: {resp.status_code} {resp.text}")
                return False

        except requests.exceptions.Timeout:
            print("⏳ Hub registration timeout (endpoint not ready)")
            return False
        except Exception as e:
            print(f"⚠️  Registration error: {e}")
            return False

    def run(self):
        """Start the spoke server"""
        print(f"\n🚀 Ollama A2A Spoke starting")
        print(f"   Hostname: {self.hostname}")
        print(f"   Spoke name: {self.spoke_name}")
        print(f"   Announce URL: {self.announce_url}")
        print(f"   Ollama: {self.ollama_url}")
        print(f"   Hub: {self.hub_url}")
        print(f"   Listen: {self.host}:{self.port}\n")

        # Discover models
        if not self.discover_models():
            print("⚠️  No models available. Start Ollama first.")
            sys.exit(1)

        print()

        # Try to discover hub
        self.discover_hub()

        # Try to register (will fail gracefully if endpoint not ready)
        self.register_at_hub()

        print(f"\n📡 Endpoints ready:")
        print(f"   Discovery: http://{self.hostname}:3002/api/a2a/.well-known/agent.json")
        print(f"   Health: http://{self.hostname}:3002/health")
        print(f"   Tasks: POST http://{self.hostname}:3002/api/a2a/tasks/execute")
        print()

        # Start server
        uvicorn.run(self.app, host=self.host, port=self.port, log_level="info")


def main():
    parser = argparse.ArgumentParser(description="Ollama A2A Spoke")
    parser.add_argument("--ollama", default="http://127.0.0.1:11434",
                       help="Ollama URL (default: http://127.0.0.1:11434)")
    parser.add_argument("--hub", default="http://100.98.18.76:3000",
                       help="Hub URL (default: http://100.98.18.76:3000)")
    parser.add_argument("--port", type=int, default=3002,
                       help="Port to listen on (default: 3002)")
    parser.add_argument("--host", default="0.0.0.0",
                       help="Host to bind to (default: 0.0.0.0)")
    parser.add_argument("--name", default=None,
                       help="Spoke name to register at hub (default: ollama-<hostname>)")
    parser.add_argument("--url", default=None,
                       help="Public URL announced to hub (default: http://<hostname>:<port>). "
                            "Set explicitly to a Tailscale IP when hostname doesn't resolve "
                            "cross-host (typical on Windows).")

    args = parser.parse_args()

    spoke = OllamaSpoke(
        ollama_url=args.ollama,
        hub_url=args.hub,
        port=args.port,
        host=args.host,
        name=args.name,
        announce_url=args.url,
    )
    spoke.run()


if __name__ == "__main__":
    main()
