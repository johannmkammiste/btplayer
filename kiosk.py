import sys
import logging
import atexit
import threading
import traceback

from waitress import serve
from app import app, audio_player, config

_cleanup_lock = threading.Lock()
_cleanup_has_run = False

def perform_final_cleanup_if_needed(reason="atexit"): # Add a reason for logging
    global _cleanup_has_run
    with _cleanup_lock:
        if _cleanup_has_run:
            logging.info(f"kiosk.py: perform_final_cleanup_if_needed ({reason}): Cleanup already run or in progress.")
            return
        logging.info(f"kiosk.py: perform_final_cleanup_if_needed ({reason}): Setting cleanup flag.")
        _cleanup_has_run = True

    logging.info(f"kiosk.py: perform_final_cleanup_if_needed ({reason}): Starting final resource cleanup...")
    if 'audio_player' in globals() and audio_player:
        logging.info(f"kiosk.py: perform_final_cleanup_if_needed ({reason}): Calling audio_player.shutdown()...")
        try:
            audio_player.shutdown() # This calls BASS_Free etc.
            logging.info(f"kiosk.py: perform_final_cleanup_if_needed ({reason}): audio_player.shutdown() completed.")
        except Exception as e:
            logging.error(f"kiosk.py: Error during audio_player.shutdown() ({reason}): {e}", exc_info=True)
    else:
        logging.info(f"kiosk.py: No audio_player instance to shut down or not imported ({reason}).")
    logging.info(f"kiosk.py: Final resource cleanup finished ({reason}). Python process should exit now.")


if __name__ == '__main__':
    logging.basicConfig(stream=sys.stdout, level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
    # atexit.register(lambda: perform_final_cleanup_if_needed("atexit handler")) # Keep atexit as a final fallback

    shutdown_signal_received = False
    server_instance = None # To potentially control waitress if possible
    try:
        app.config.update({"KIOSK_MODE": True})
        logging.info("kiosk.py: KIOSK_MODE in app.config set to True")

        logging.info(f"kiosk.py: Starting Waitress server on http://127.0.0.1:5001...")
        # For Waitress, there isn't a direct 'server.shutdown()' method easily callable
        serve(app, host='0.0.0.0', port=5001, threads=8)
        # If serve() returns normally (e.g. not via exception), it means server stopped.
        logging.info("kiosk.py: Waitress serve() call has returned.")

    except KeyboardInterrupt:
        logging.info("kiosk.py: KeyboardInterrupt received (likely from API quit or Ctrl+C). Server is stopping.")
        shutdown_signal_received = True
        # The serve() call should have been interrupted.
    except SystemExit as e:
        logging.info(f"kiosk.py: SystemExit caught with code {e.code}")
        shutdown_signal_received = True # Treat SystemExit as a signal to shut down
    except Exception as e:
        logging.error(f"kiosk.py: Exception in Waitress server or startup: {e}", exc_info=True)
        sys.exit(1) # Exit with error code if server fails
    finally:
        logging.info("kiosk.py: Entering finally block.")
        perform_final_cleanup_if_needed("finally block") # Call cleanup explicitly here

        if shutdown_signal_received:
            logging.info("kiosk.py: Exiting cleanly after shutdown signal.")
            sys.exit(0) # Ensure a clean exit code for intentional shutdown
        else:
            logging.warning("kiosk.py: Server exited unexpectedly (not via signal).")
            sys.exit(1) # Exit with error if it was unexpected