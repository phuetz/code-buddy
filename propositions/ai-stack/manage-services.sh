#!/usr/bin/env bash
# Script de gestion rapide de la stack Ministar AI

case "\$1" in
    start)
        echo "🚀 Démarrage de la stack..."
        ./start-stack.sh
        sudo systemctl start ministar-cyberdeck
        echo "✅ Stack démarrée."
        ;;
    stop)
        echo "🛑 Arrêt des services..."
        docker compose down
        sudo systemctl stop ministar-cyberdeck
        echo "✅ Stack arrêtée."
        ;;
    status)
        echo "📊 État des services :"
        ./start-stack.sh --status
        systemctl status ministar-cyberdeck --no-pager
        ;;
    *)
        echo "Usage: \$0 {start|stop|status}"
        ;;
esac
