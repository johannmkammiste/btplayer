import webview
import threading
import time
import sys
import atexit
import logging
from waitress import serve
from app import app, audio_player

shutdown_event = threading.Event()

_cleanup_lock = threading.Lock()
_cleanup_has_run = False


def perform_final_cleanup_if_needed():
    global _cleanup_has_run
    with _cleanup_lock:
        if _cleanup_has_run:
            return
        logging.info("perform_final_cleanup_if_needed: Setting cleanup flag and starting cleanup...")
        _cleanup_has_run = True

    logging.info("perform_final_cleanup_if_needed: Starting final resource cleanup...")
    if audio_player:
        logging.info("perform_final_cleanup_if_needed: Calling audio_player.shutdown()...")
        try:
            audio_player.shutdown()
            logging.info("perform_final_cleanup_if_needed: audio_player.shutdown() completed.")
        except Exception as e:
            logging.error(f"perform_final_cleanup_if_needed: Error during audio_player.shutdown(): {e}", exc_info=True)
    else:
        logging.info("perform_final_cleanup_if_needed: No audio_player instance to shut down.")

    logging.info("perform_final_cleanup_if_needed: Final resource cleanup finished.")


atexit.register(perform_final_cleanup_if_needed)

class Api:
    def __init__(self):
        self._window = None

    def set_window(self, window):
        self._window = window

    def quit(self):
        self._window.destroy()

    def select_audio_directory(self):
        if not self._window:
            logging.error("API: Window not set, cannot create file dialog.")
            return None
        try:
            result = self._window.create_file_dialog(webview.FOLDER_DIALOG)
            if result and isinstance(result, tuple) and len(result) > 0:
                logging.info(f"Folder selected: {result[0]}")
                return result[0]
            else:
                logging.info("Folder selection cancelled or no folder selected.")
                return None
        except Exception as e:
            logging.error(f"Error in select_audio_directory: {e}", exc_info=True)
            return None


def start_waitress_server():
    logging.info(f"Starting Waitress server on http://127.0.0.1:5001...")
    try:
        serve(app, host='0.0.0.0', port=5001, threads=8)
    except Exception as e:
        logging.critical(f"Failed to start Waitress server: {e}", exc_info=True)
        if not shutdown_event.is_set():
            shutdown_event.set()


if __name__ == '__main__':
    if not logging.getLogger().hasHandlers():
        logging.basicConfig(stream=sys.stdout, level=logging.INFO,
                            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

    logging.info("Application starting (run.py)...")

    server_thread = threading.Thread(target=start_waitress_server, daemon=True)
    server_thread.start()
    logging.info(
        f"Flask server thread started. Main thread: {threading.get_ident()}, Server thread: {server_thread.ident}")

    window = None
    api = Api()
    exit_code = 0

    try:
        logging.info("Creating pywebview window...")
        window = webview.create_window(
            'Backing Track Player',
            'http://127.0.0.1:5001',
            width=1024,
            height=600,
            resizable=True,
            fullscreen=True,
            text_select=True,
            js_api=api
        )
        webview.settings['ALLOW_DOWNLOADS'] = True
        api.set_window(window)
        webview.start(debug=False)
        logging.info("closed")


    except SystemExit as e:
        logging.info(f"SystemExit caught during main execution: {e}")
        if not shutdown_event.is_set():
            shutdown_event.set()
    except KeyboardInterrupt:
        logging.info("KeyboardInterrupt caught. Initiating shutdown...")
        if not shutdown_event.is_set():
            shutdown_event.set()
        window.destroy()
    except Exception as e:
        logging.error(f"An unexpected error occurred in the pywebview main block: {e}", exc_info=True)
        if not shutdown_event.is_set():
            shutdown_event.set()
        window.destroy()
    finally:
        logging.info("Main block finally: Ensuring cleanup and exit.")
        if not shutdown_event.is_set():
            logging.info("Main block finally: Setting shutdown_event.")
            shutdown_event.set()
        perform_final_cleanup_if_needed()
        active_threads_list = threading.enumerate()
        active_thread_names = [t.name for t in active_threads_list]
        logging.info(f"Main block finally: Names of {len(active_threads_list)} active threads: {active_thread_names}")

        logging.info(f"Main block finally: Cleanup sequence finished.")

    logging.info(f"Main thread ({threading.get_ident()}) of run.py has completed its Python code execution.")

