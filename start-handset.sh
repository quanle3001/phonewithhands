#!/bin/bash
# start-handset.sh — one command to run the iPhone handset demo (single ngrok tunnel)
export PATH="$HOME/.nvm/versions/node/v24.17.0/bin:$PATH"
cd "/Users/quan/Library/Application Support/simular-unified-ui/SimularFiles/Claude/phone-with-hand"
NGROK=/tmp/ngrok

echo "==> 1/5 dev server (:3000)"
lsof -tiTCP:3000 -sTCP:LISTEN >/dev/null 2>&1 || nohup npm run dev > /tmp/pwh-dev.log 2>&1 &

echo "==> 2/5 restarting bridge (:5051, now proxies pages too)"
lsof -tiTCP:5051 -sTCP:LISTEN | xargs kill -9 2>/dev/null || true
sleep 1
nohup npm run handset > /tmp/pwh-bridge.log 2>&1 &
sleep 2

echo "==> 3/5 ngrok (single tunnel -> bridge :5051)"
pkill -f "ngrok" 2>/dev/null || true
sleep 1
nohup $NGROK http 5051 > /tmp/pwh-ngrok.log 2>&1 &
sleep 7

echo "==> 4/5 reading public URL"
HOST=$(curl -s http://localhost:4040/api/tunnels | python3 -c "import sys,json;print(json.load(sys.stdin)['tunnels'][0]['public_url'])")
WSS=${HOST/https:/wss:}/ws

echo "==> 5/5 set NEXT_PUBLIC_HANDSET_WS + restart dev"
grep -v '^NEXT_PUBLIC_HANDSET_WS=' .env.local > /tmp/env.tmp 2>/dev/null || true
echo "NEXT_PUBLIC_HANDSET_WS=$WSS" >> /tmp/env.tmp
mv /tmp/env.tmp .env.local
lsof -tiTCP:3000 -sTCP:LISTEN | xargs kill -9 2>/dev/null || true
sleep 1
nohup npm run dev > /tmp/pwh-dev.log 2>&1 &
sleep 8

echo ""
echo "===================================================="
echo " READY"
echo " MAC (this computer):  http://localhost:3000/call/live-phone"
echo " iPHONE (Safari):      $HOST/handset"
echo " (audio WS: $WSS)"
echo "===================================================="
