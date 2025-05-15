#!/bin/dash
# Autostart script for kiosk mode, based on @AYapejian: https://github.com/MichaIng/DietPi/issues/1737#issue-318697621
# 1. Define your project directory
#    IMPORTANT: Change this to the absolute path of your project directory
PROJECT_DIR="/root/backingtrackplayer"

# 2. Navigate to your project directory
cd "$PROJECT_DIR" || echo "Failed to cd to $PROJECT_DIR"

# 3. Activate the virtual environment
if [ -f "$PROJECT_DIR/venv/bin/activate" ]; then
    . "$PROJECT_DIR/venv/bin/activate"
else
    echo "Error: Virtual environment activate script not found at $PROJECT_DIR/venv/bin/activate" >> /tmp/kiosk_startup_error.log
fi

# 4. Start kiosk.py in the background
#    Log its output to a file for debugging (optional, but recommended)
LOG_FILE="$PROJECT_DIR/kiosk_server.log" # You can change this log path
echo "Starting kiosk.py server..." > "$LOG_FILE"
APP_MODE=kiosk python "$PROJECT_DIR/kiosk.py" >> "$LOG_FILE" 2>&1 &
KIOSK_PID=$!
echo "kiosk.py background process started with PID $KIOSK_PID. Output logged to $LOG_FILE" >> "$LOG_FILE"

# Resolution to use for kiosk mode, should ideally match current system resolution
RES_X=$(sed -n '/^[[:blank:]]*SOFTWARE_CHROMIUM_RES_X=/{s/^[^=]*=//p;q}' /boot/dietpi.txt)
RES_Y=$(sed -n '/^[[:blank:]]*SOFTWARE_CHROMIUM_RES_Y=/{s/^[^=]*=//p;q}' /boot/dietpi.txt)

# Command line switches: https://peter.sh/experiments/chromium-command-line-switches/
# - Review and add custom flags in: /etc/chromium.d
CHROMIUM_OPTS="--kiosk --window-size=${RES_X:-1280},${RES_Y:-720} --window-position=0,0"

# If you want tablet mode, uncomment the next line.
CHROMIUM_OPTS="$CHROMIUM_OPTS --force-tablet-mode --tablet-ui --noerrdialogs --no-memcheck"

# Home page
URL=$(sed -n '/^[[:blank:]]*SOFTWARE_CHROMIUM_AUTOSTART_URL=/{s/^[^=]*=//p;q}' /boot/dietpi.txt)

# RPi or Debian Chromium package
FP_CHROMIUM=$(command -v chromium-browser)
[ "$FP_CHROMIUM" ] || FP_CHROMIUM=$(command -v chromium)

# Use "startx" as non-root user to get required permissions via systemd-logind
STARTX='xinit'
[ "$USER" = 'root' ] || STARTX='startx'

exec "$STARTX" "$FP_CHROMIUM" $CHROMIUM_OPTS "${URL:-http://127.0.0.1:5001/}"
