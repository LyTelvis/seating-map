#!/bin/bash
cd "$(dirname "$0")"

echo "=========================================="
echo " 🪑 Mac Seating Tracker Launcher"
echo "=========================================="

# Activate virtualenv if available
if [ -d ".venv" ]; then
    source .venv/bin/activate
fi

python3 process_photos.py
