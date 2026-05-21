#!/usr/bin/env bash
# Gestion individuelle des services pour le Dashboard
ACTION=$1
SERVICE=$2

case "$SERVICE" in
    open-webui|litellm|qdrant|searxng|ai-redis|monartisan-db|monartisan-redis)
        cd /home/patrice/DEV/ai-stack
        if [ "$ACTION" == "start" ]; then
            docker compose up -d $SERVICE
        else
            docker compose stop $SERVICE
        fi
        ;;
    ollama)
        sudo systemctl $ACTION ollama
        ;;
    lemonade)
        sudo systemctl $ACTION lemond
        ;;
    comfyui)
        sudo systemctl $ACTION comfyui.service
        ;;
esac
