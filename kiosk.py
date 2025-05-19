import sys
import logging
import atexit
import threading
import traceback

from waitress import serve
from app import app, audio_player, config

_cleanup_lock = threading.Lock()
_cleanup_has_run = False

def perform_final_cleanup_if_needed():
    """
    Performs critical resource cleanup (like audio_player.shutdown).
    """
    global _cleanup_has_run

    with _cleanup_lock:
        if _cleanup_has_run:
            return
        _cleanup_has_run = True

    logging.info("kiosk.py: Starting final resource cleanup...")
    if 'audio_player' in globals() and audio_player:
        logging.info("kiosk.py: Calling audio_player.shutdown()...")
        try:
            audio_player.shutdown()
            logging.info("kiosk.py: audio_player.shutdown() completed.")
        except Exception as e:
            logging.error(f"kiosk.py: Error during audio_player.shutdown(): {e}")
            traceback.print_exc()
    else:
        logging.info("kiosk.py: No audio_player instance to shut down or not imported.")

    logging.info("kiosk.py: Final resource cleanup finished.")


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
    atexit.register(perform_final_cleanup_if_needed)
    shutdown_signal_received = False
    try:
        app.config.update({"KIOSK_MODE": True})
        logging.info("Kiosk mode successfully enabled in Flask app config from kiosk.py.") # For confirmation
        print(f"Starting Waitress server on http://127.0.0.1:5001...") # Standard output
        logging.info(f"kiosk.py: Starting Waitress server on http://127.0.0.1:5001...") # Log file
        serve(app, host='0.0.0.0', port=5001, threads=8)
    except KeyboardInterrupt:
        logging.info("kiosk.py: KeyboardInterrupt received (likely from API quit or Ctrl+C). Server is stopping.")
        shutdown_signal_received = True
    except NameError:
        logging.error("kiosk.py: NameError during startup, exiting.")
        sys.exit(1)
    except Exception as e:
        logging.error(f"kiosk.py: Exception in Waitress server: {e}")
        traceback.print_exc()
        sys.exit(1)
    finally:
        logging.info("kiosk.py: Waitress serve() call has finished or been interrupted.")
        if shutdown_signal_received:
            logging.info("kiosk.py: Exiting cleanly after shutdown signal.")
        else:
            logging.warning("kiosk.py: Server exited unexpectedly (not via KeyboardInterrupt).")