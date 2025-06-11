import os
import gc
import threading
import logging
import contextlib
import time
from collections import defaultdict
import traceback
from ctypes import c_float, byref
from pathlib import Path

from modpybass.pybass import *
from modpybass.pybassmix import *

if not hasattr(sys.modules[__name__], 'BASS_DEVICE_LOOPBACK'): BASS_DEVICE_LOOPBACK = 8

callback_lock = threading.Lock()


class AudioPlayer:
    def __init__(self, root_path, initial_audio_upload_folder_config,
                 songs_data_provider_func, settings_data_provider_func,
                 max_logical_channels_const, default_sample_rate_const):
        self.root_path = root_path
        self.current_audio_upload_folder_config_path = initial_audio_upload_folder_config
        self.get_songs_data = songs_data_provider_func
        self.get_settings_data = settings_data_provider_func
        self.MAX_LOGICAL_CHANNELS = max_logical_channels_const
        self.DEFAULT_SAMPLE_RATE = default_sample_rate_const
        self.initialized_devices = set()
        current_settings = self.get_settings_data()
        self.audio_outputs = current_settings.get('audio_outputs', [])
        self._current_global_volume = float(current_settings.get('volume', 1.0))
        self.target_sample_rate = int(current_settings.get('sample_rate', self.DEFAULT_SAMPLE_RATE))
        self._preloaded_song_id = None
        self._preloaded_mixers = {}
        self._active_mixer_handles = []
        self._is_song_preloaded = False
        self._playback_active = False
        self._playback_monitor_thread = None

    def _get_resolved_audio_upload_folder_abs(self):
        configured_path = self.current_audio_upload_folder_config_path
        if os.path.isabs(configured_path):
            abs_path = configured_path
        else:
            abs_path = os.path.join(self.root_path, configured_path)
        abs_path = os.path.normpath(abs_path)
        try:
            Path(abs_path).mkdir(parents=True, exist_ok=True)
        except Exception as e:
            logging.error(f"AudioPlayer: Failed to create or access audio directory {abs_path}: {e}.")
        return abs_path

    def update_audio_upload_folder_config(self, new_path_config_value):
        with callback_lock:
            old_path = self.current_audio_upload_folder_config_path
            self.current_audio_upload_folder_config_path = new_path_config_value
            logging.info(
                f"AudioPlayer: Audio upload folder config updated from '{old_path}' to '{new_path_config_value}'.")
            if self._is_song_preloaded or self._preloaded_mixers:
                logging.info("AudioPlayer: Clearing preload state due to audio folder change.")
                self.clear_preload_state(acquire_lock=False)  # Already under lock

    def initialize_bass(self):
        current_settings = self.get_settings_data()
        self.audio_outputs = current_settings.get('audio_outputs', [])
        self.target_sample_rate = int(current_settings.get('sample_rate', self.DEFAULT_SAMPLE_RATE))
        self._current_global_volume = float(current_settings.get('volume', 1.0))
        devices_to_init = sorted(
            list(set(mapping['device_id'] for mapping in self.audio_outputs if 'device_id' in mapping)))
        if not devices_to_init:
            logging.info("No specific devices in settings, attempting to initialize default BASS device.")
            if not BASS_Init(-1, self.target_sample_rate, 0, 0, None):
                if BASS_ErrorGetCode() != BASS_ERROR_ALREADY:
                    raise RuntimeError(f"BASS_Init default device failed! Error: {BASS_ErrorGetCode()}")
                logging.info("Default BASS device already initialized or was the target.")
                default_dev_id_after_init = BASS_GetDevice()
                if default_dev_id_after_init != 0xFFFFFFFF:
                    self.initialized_devices.add(default_dev_id_after_init)
                else:
                    logging.warning("Could not determine default device ID after BASS_Init(-1).")
            else:
                default_dev_id_after_init = BASS_GetDevice()
                if default_dev_id_after_init != 0xFFFFFFFF:
                    self.initialized_devices.add(default_dev_id_after_init)
                    logging.info(f"Default BASS device initialized successfully as device {default_dev_id_after_init}.")
                else:
                    logging.warning("BASS_Init(-1) succeeded but BASS_GetDevice() returned an error value.")
        else:
            for dev_id in devices_to_init:
                if dev_id in self.initialized_devices:
                    logging.info(f"BASS device {dev_id} was already initialized. Skipping BASS_Init.")
                    continue
                if not BASS_Init(dev_id, self.target_sample_rate, 0, 0, None):
                    if BASS_ErrorGetCode() == BASS_ERROR_ALREADY:
                        logging.info(f"BASS device {dev_id} already initialized.")
                        self.initialized_devices.add(dev_id)
                    else:
                        logging.error(f"BASS_Init failed for device {dev_id}! Error: {BASS_ErrorGetCode()}")
                else:
                    logging.info(f"BASS device {dev_id} initialized successfully.")
                    self.initialized_devices.add(dev_id)
        if not self.initialized_devices and self.audio_outputs:
            raise RuntimeError("Failed to initialize any of the configured BASS output devices.")
        elif not self.initialized_devices and not self.audio_outputs:
            logging.warning(
                "BASS initialized with no specific output devices configured and default device initialization failed or was not identified.")
        BASS_SetConfig(BASS_CONFIG_GVOL_STREAM, int(self._current_global_volume * 10000))
        BASS_SetConfig(BASS_CONFIG_UPDATEPERIOD, 10)
        BASS_SetConfig(BASS_CONFIG_BUFFER, 500)
        logging.info(
            f"BASS context ready. Global Vol: {self._current_global_volume:.2f}. Initialized devices: {self.initialized_devices}. Audio folder config: {self.current_audio_upload_folder_config_path}")

    def update_settings(self):
        with callback_lock:
            current_settings = self.get_settings_data()
            old_sr, old_vol, old_outputs = self.target_sample_rate, self._current_global_volume, self.audio_outputs
            old_audio_path_config = self.current_audio_upload_folder_config_path
            self.audio_outputs = current_settings.get('audio_outputs', [])
            self._current_global_volume = float(current_settings.get('volume', 1.0))
            self.target_sample_rate = int(current_settings.get('sample_rate', self.DEFAULT_SAMPLE_RATE))
            new_audio_path_config = current_settings.get('audio_directory_path',
                                                         self.current_audio_upload_folder_config_path)
            settings_changed_requiring_preload_clear = False
            if old_sr != self.target_sample_rate:
                logging.info(f"Sample rate changed from {old_sr} to {self.target_sample_rate}.")
                settings_changed_requiring_preload_clear = True
            if old_outputs != self.audio_outputs:
                logging.info("Audio outputs configuration changed.")
                settings_changed_requiring_preload_clear = True
            if old_audio_path_config != new_audio_path_config:
                logging.info(
                    f"Audio directory path config changed from '{old_audio_path_config}' to '{new_audio_path_config}'.")
                self.current_audio_upload_folder_config_path = new_audio_path_config
                settings_changed_requiring_preload_clear = True
            if settings_changed_requiring_preload_clear:
                logging.info("Audio settings affecting playback changed. Clearing preload state.")
                self.clear_preload_state(acquire_lock=False)  # Already under lock
            if abs(old_vol - self._current_global_volume) > 1e-6:
                BASS_SetConfig(BASS_CONFIG_GVOL_STREAM, int(self._current_global_volume * 10000))
            logging.debug(
                f"AudioPlayer settings updated: {len(self.audio_outputs)} outputs, Vol:{self._current_global_volume:.2f}, SR:{self.target_sample_rate} Hz, AudioPath: {self.current_audio_upload_folder_config_path}")

    def _build_logical_channel_map(self):
        logging.debug("Building logical channel map...")
        logical_map = {}
        if not self.audio_outputs:
            logging.warning("Building logical channel map: self.audio_outputs is empty.")
            return logical_map
        for i, mapping_info in enumerate(self.audio_outputs):
            bass_dev_id = mapping_info.get('device_id')
            app_logical_chans_for_this_device_mapping = mapping_info.get('channels', [])
            if bass_dev_id is None or not isinstance(app_logical_chans_for_this_device_mapping, list):
                logging.warning(f"  Skipping mapping entry {i} due to missing device_id or invalid channels list.")
                continue
            if bass_dev_id not in self.initialized_devices:
                logging.warning(
                    f"  Device ID {bass_dev_id} in settings mapping entry {i} but not in initialized_devices. Skipping.")
                continue
            for physical_idx_in_mapping, app_log_ch_val in enumerate(app_logical_chans_for_this_device_mapping):
                if isinstance(app_log_ch_val, int) and 1 <= app_log_ch_val <= self.MAX_LOGICAL_CHANNELS:
                    if app_log_ch_val in logical_map:
                        logging.warning(f"  Logical channel {app_log_ch_val} redefined. Using new.")
                    logical_map[app_log_ch_val] = (bass_dev_id, physical_idx_in_mapping)
                else:
                    logging.warning(f"  Invalid app_log_ch_val {app_log_ch_val} in mapping entry {i}. Skipping.")
        logging.debug(f"Finished building logical channel map: {logical_map}")
        return logical_map

    def prepare_song(self, song_id):
        # Get song data and validate
        songs_data = self.get_songs_data()
        song = next((s for s in songs_data.get('songs', []) if s.get('id') == song_id), None)
        if not song:
            logging.error(f"Song {song_id} not found for preparation.")
            return False

        # Get audio folder path
        audio_folder = self._get_resolved_audio_upload_folder_abs()
        logging.info(f"Preparing song {song_id} ('{song.get('name', 'N/A')}') using audio folder: {audio_folder}")

        # Validate configuration for songs with audio tracks
        if song.get('audio_tracks') and not self.audio_outputs:
            logging.error("Cannot prepare song: No audio outputs configured in settings.")
            return False

        # Clear any existing loaded song
        with callback_lock:
            self.clear_preload_state(acquire_lock=False)

            # Build channel mapping for audio routing
            logical_map = self._build_logical_channel_map()
            if not logical_map and song.get('audio_tracks'):
                logging.error("Cannot prepare song: Logical channel map is empty but song has audio tracks.")
                return False

            # Create mixers and load tracks
            try:
                # Create output mixers for each audio device
                mixer_info = self._create_device_mixers(logical_map)
                if not mixer_info and song.get('audio_tracks'):
                    logging.error("Failed to create any device mixers.")
                    return False

                # Handle songs with no audio (metadata only)
                if not song.get('audio_tracks'):
                    self._set_song_as_prepared(song_id, mixer_info)
                    logging.info(f"Song {song_id} prepared successfully (no audio tracks).")
                    return True

                # Load all audio tracks
                if self._load_audio_tracks(song, audio_folder, logical_map, mixer_info):
                    self._set_song_as_prepared(song_id, mixer_info)
                    logging.info(
                        f"Song '{song.get('name')}' (ID: {song_id}) prepared successfully with {len(song.get('audio_tracks', []))} track(s).")
                    return True
                else:
                    self._cleanup_mixers(mixer_info)
                    return False

            except Exception as e:
                logging.error(f"Exception during song preparation for ID {song_id}: {e}")
                traceback.print_exc()
                if 'mixer_info' in locals():
                    self._cleanup_mixers(mixer_info)
                return False

    def _create_device_mixers(self, logical_map):
        mixers = {}

        # Calculate how many channels each device needs
        channels_per_device = defaultdict(int)
        for dev_id, physical_idx in logical_map.values():
            channels_per_device[dev_id] = max(channels_per_device[dev_id], physical_idx + 1)

        # Create a mixer for each device
        for dev_id, num_channels in channels_per_device.items():
            if dev_id not in self.initialized_devices or num_channels == 0:
                continue

            mixer = BASS_Mixer_StreamCreate(self.target_sample_rate, num_channels, BASS_MIXER_END)
            if mixer:
                mixers[dev_id] = mixer
                logging.debug(f"Created mixer {mixer} for device {dev_id} with {num_channels} channels")
            else:
                logging.error(f"Failed to create mixer for device {dev_id}: Error {BASS_ErrorGetCode()}")

        return mixers

    def _load_audio_tracks(self, song, audio_folder, logical_map, mixers):
        streams = []
        try:
            for idx, track in enumerate(song.get('audio_tracks', [])):
                success = self._load_track(track, idx, audio_folder, logical_map, mixers, streams)
                if not success:
                    logging.warning(f"Failed to load track {idx} - continuing with others")

            return bool(streams)  # Return True if we loaded at least one track

        except Exception as e:
            logging.error(f"Error loading audio tracks: {e}")
            self._cleanup_resources(mixers, streams)
            return False

    def _cleanup_mixers(self, mixers):
        for mixer in mixers.values():
            if mixer:
                BASS_StreamFree(mixer)

    def _cleanup_resources(self, mixers, streams=None):
        """Free all resources including mixers and streams."""
        self._cleanup_mixers(mixers)

        if streams:
            for stream in streams:
                if stream:
                    BASS_StreamFree(stream)

    def _set_song_as_prepared(self, song_id, mixers):
        self._preloaded_song_id = song_id
        self._preloaded_mixers = mixers
        self._is_song_preloaded = True

    def preload_song(self, song_id):
        # Update settings first to ensure we have latest configuration
        self.update_settings()

        # Prepare the song and its resources
        return self.prepare_song(song_id)

    def play_song_directly(self, song_id):
        # Update settings first
        self.update_settings()

        # Check if we need to prepare the song
        needs_preparation = True
        with callback_lock:
            if self._is_song_preloaded and self._preloaded_song_id == song_id:
                needs_preparation = False

        # Prepare the song if needed
        if needs_preparation:
            logging.info(f"Song {song_id} not prepared or different from current. Preparing now.")
            if not self.prepare_song(song_id):
                logging.error(f"Failed to prepare song {song_id} for playback.")
                return False

        # Start playback of the prepared song
        return self.play_preloaded_song()

    def play_preloaded_song(self):
        with callback_lock:
            # Verify we have a preloaded song
            if not self._is_song_preloaded or not self._preloaded_mixers:
                logging.warning("Cannot play: No song is preloaded or no mixers available")
                self._playback_active = False
                return False

            # If already playing, nothing to do
            if self._playback_active:
                logging.info("Playback already active")
                return True

            # Reset active mixer list
            self._active_mixer_handles = []

            # Start all mixers
            all_started = True
            for dev_id, mixer_handle in self._preloaded_mixers.items():
                if not mixer_handle:
                    continue

                # Ensure device is initialized
                if dev_id not in self.initialized_devices:
                    logging.error(f"Device {dev_id} not initialized for mixer {mixer_handle}")
                    all_started = False
                    continue

                # Set the device for this mixer
                if not BASS_ChannelSetDevice(mixer_handle, dev_id):
                    logging.error(
                        f"Failed to set device {dev_id} for mixer {mixer_handle}: Error {BASS_ErrorGetCode()}")
                    all_started = False
                    continue

                # Start playback for this mixer
                if not BASS_ChannelPlay(mixer_handle, False):
                    logging.error(f"Failed to start playback for mixer {mixer_handle}: Error {BASS_ErrorGetCode()}")
                    all_started = False
                else:
                    logging.info(f"Mixer {mixer_handle} started on device {dev_id}")
                    self._active_mixer_handles.append(mixer_handle)

            # If we successfully started at least one mixer
            if self._active_mixer_handles:
                self._playback_active = True
                self._start_playback_monitor()
                logging.info(
                    f"Playback started for song {self._preloaded_song_id} with {len(self._active_mixer_handles)} mixer(s)")
                return True
            else:
                logging.error(f"Playback failed to start for song {self._preloaded_song_id}")
                return False

    def _start_playback_monitor(self):
        if self._playback_monitor_thread is None or not self._playback_monitor_thread.is_alive():
            self._playback_monitor_thread = threading.Thread(target=self._playback_monitor, daemon=True)
            self._playback_monitor_thread.start()

    def _load_track(self, track, track_idx, audio_folder, logical_map, mixers_by_device, all_streams):
        # Get track file path
        file_path_rel = track.get('file_path')
        if not file_path_rel:
            logging.warning(f"Track {track_idx} has no file_path specified. Skipping.")
            return False

        # Check if file exists
        file_path_abs = os.path.join(audio_folder, file_path_rel)
        if not os.path.exists(file_path_abs):
            logging.warning(f"Audio file not found for track {track_idx} ('{file_path_rel}'). Skipping.")
            return False

        # Get track settings
        logical_channel = track.get('output_channel', 1)
        is_stereo = track.get('is_stereo', False)
        track_volume = float(track.get('volume', 1.0))

        # Find target device and channel
        if logical_channel not in logical_map:
            logging.warning(
                f"Logical channel {logical_channel} not found in mapping for track '{file_path_rel}'. Skipping.")
            return False

        target_device_id, physical_idx = logical_map[logical_channel]

        # Find the mixer for this device
        if target_device_id not in mixers_by_device:
            logging.warning(f"No mixer found for device {target_device_id} for track '{file_path_rel}'. Skipping.")
            return False

        device_mixer = mixers_by_device[target_device_id]

        # Determine file channels and stream flags
        actual_file_channels = self._get_file_channel_count(file_path_abs, file_path_rel)

        # Create flags for stream creation
        source_flags = BASS_STREAM_DECODE | BASS_SAMPLE_FLOAT
        if actual_file_channels > 1 and not is_stereo:
            source_flags |= BASS_SAMPLE_MONO
            logging.info(f"Track '{file_path_rel}' set to play mono. Using BASS_SAMPLE_MONO.")

        # Create the source stream
        source_stream = BASS_StreamCreateFile(False, file_path_abs.encode('utf-8'), 0, 0, source_flags)
        if not source_stream:
            logging.error(f"Failed to create stream for '{file_path_rel}'. Error: {BASS_ErrorGetCode()}. Skipping.")
            return False

        # Add to streams list for cleanup
        all_streams.append(source_stream)

        # Get stream info
        source_info = BASS_CHANNELINFO()
        if not BASS_ChannelGetInfo(source_stream, byref(source_info)):
            logging.error(f"Failed to get channel info for '{file_path_rel}'. Error: {BASS_ErrorGetCode()}. Skipping.")
            return False

        # Get stream channels and add a robust validation check for all cases
        stream_channels = source_info.chans
        if not (1 <= stream_channels <= 8):  # Allow up to 8 channels, but catch garbage values
            logging.warning(
                f"Unusual stream channel count {stream_channels} detected for '{file_path_rel}'. Clamping value.")
            # Clamp to 1 for mono streams, otherwise default to 2
            if source_flags & BASS_SAMPLE_MONO:
                stream_channels = 1
            else:
                stream_channels = 2

        # The original check can be kept as a fallback
        if source_flags & BASS_SAMPLE_MONO and stream_channels != 1:
            logging.warning(f"Stream was supposed to be mono, but reports {stream_channels} channels. Forcing to 1.")
            stream_channels = 1

        # Get mixer channel count
        mixer_channels = self._get_mixer_channel_count(target_device_id, mixers_by_device)

        # Create and set up mixer matrix for channel routing
        matrix = self._create_channel_matrix(stream_channels, mixer_channels, physical_idx, is_stereo, logical_channel,
                                             logical_map)
        if not matrix:
            logging.error(f"Failed to create channel matrix for '{file_path_rel}'. Skipping.")
            return False

        # Add stream to mixer
        if not BASS_Mixer_StreamAddChannel(device_mixer, source_stream, BASS_MIXER_NORAMPIN | BASS_MIXER_MATRIX):
            logging.error(
                f"Failed to add stream to mixer for '{file_path_rel}'. Error: {BASS_ErrorGetCode()}. Skipping.")
            return False

        # Set volume
        if not BASS_ChannelSetAttribute(source_stream, BASS_ATTRIB_VOL, track_volume):
            logging.warning(f"Failed to set volume for '{file_path_rel}'. Error: {BASS_ErrorGetCode()}")

        # Set matrix
        if not BASS_Mixer_ChannelSetMatrix(source_stream, matrix):
            logging.error(f"Failed to set channel matrix for '{file_path_rel}'. Error: {BASS_ErrorGetCode()}")

        logging.debug(f"Successfully loaded track '{file_path_rel}' to channel {logical_channel}")
        return True

    @staticmethod
    def _get_file_channel_count(file_path_abs, file_path_rel):
        temp_stream = BASS_StreamCreateFile(False, file_path_abs.encode('utf-8'), 0, 0, BASS_STREAM_DECODE)
        if not temp_stream:
            logging.warning(
                f"Could not create temp stream for '{file_path_rel}'. Error: {BASS_ErrorGetCode()}. Assuming 2 channels.")
            return 2

        channel_info = BASS_CHANNELINFO()
        channel_count = 2

        if BASS_ChannelGetInfo(temp_stream, byref(channel_info)):
            channel_count = channel_info.chans
            if not (1 <= channel_count <= 2):
                logging.warning(f"Unusual channel count {channel_count} for '{file_path_rel}'. Assuming 2 for safety.")
                channel_count = 2
        else:
            logging.warning(
                f"Could not get channel info for '{file_path_rel}'. Error: {BASS_ErrorGetCode()}. Assuming 2 channels.")

        BASS_StreamFree(temp_stream)
        return channel_count

    def _get_mixer_channel_count(self, device_id, mixers_by_device):
        for output_config in self.audio_outputs:
            if output_config.get('device_id') == device_id:
                return len(output_config.get('channels', []))
        return 0

    @staticmethod
    def _create_channel_matrix(source_channels, mixer_channels, physical_idx, is_stereo, logical_channel,
                               logical_map):
        # Validate parameters
        if source_channels <= 0 or mixer_channels <= 0:
            logging.error(f"Invalid channel counts: source={source_channels}, mixer={mixer_channels}")
            return None

        # Create matrix buffer (source_channels × mixer_channels)
        matrix = (c_float * (source_channels * mixer_channels))()

        # Initialize all values to 0
        for i in range(source_channels * mixer_channels):
            matrix[i] = 0.0

        # Handle stereo output if requested
        if is_stereo:
            # For stereo, we need a second logical channel
            second_logical_channel = logical_channel + 1
            second_device_id, second_physical_idx = logical_map.get(second_logical_channel, (None, -1))

            # Check if second channel maps to same device
            if (second_device_id == logical_map[logical_channel][0] and
                    second_physical_idx != -1 and
                    second_physical_idx < mixer_channels and
                    physical_idx < mixer_channels):

                # Stereo source to stereo output
                if source_channels >= 2:
                    # Left channel to first output
                    matrix[0 * mixer_channels + physical_idx] = 1.0
                    # Right channel to second output
                    matrix[1 * mixer_channels + second_physical_idx] = 1.0
                    logging.debug(f"Stereo source to stereo output: L->{physical_idx}, R->{second_physical_idx}")
                # Mono source to stereo output
                elif source_channels == 1:
                    # Mono to both outputs
                    matrix[0 * mixer_channels + physical_idx] = 1.0
                    matrix[0 * mixer_channels + second_physical_idx] = 1.0
                    logging.debug(f"Mono source to stereo output: Mono->{physical_idx}/{second_physical_idx}")
            else:
                # Stereo requested but second channel invalid, fallback to mono on single channel
                if source_channels >= 1 and physical_idx < mixer_channels:
                    matrix[0 * mixer_channels + physical_idx] = 1.0
                    logging.warning(f"Stereo requested but second channel invalid. Using mono output->{physical_idx}")
        else:
            # Mono output (from any source) - always route to single specified channel
            if physical_idx < mixer_channels:
                # Route first channel (or only channel for mono source) to output
                matrix[0 * mixer_channels + physical_idx] = 1.0
                logging.debug(f"Mono output: First source channel -> {physical_idx}")
            else:
                logging.warning(f"Physical index {physical_idx} invalid for mixer with {mixer_channels} channels")

        return matrix

    def _playback_monitor(self):
        logging.debug(f"Playback monitor started for {len(self._active_mixer_handles)} BASS mixer(s).")
        while True:
            with callback_lock:
                if not self._playback_active or not self._active_mixer_handles:
                    logging.debug("Monitor: Playback no longer active or no active handles. Exiting.")
                    break
                still_active_count = 0
                for mixer_h in self._active_mixer_handles:
                    if BASS_ChannelIsActive(mixer_h) in [BASS_ACTIVE_PLAYING, BASS_ACTIVE_STALLED]:
                        still_active_count += 1
                if still_active_count == 0:
                    logging.info("Monitor: All BASS mixers appear to have finished or stopped.")
                    self._playback_active = False
                    break
            time.sleep(0.1)

        with callback_lock:
            if not self._playback_active:
                logging.debug("Monitor: Cleaning up active mixer handles as playback is no longer active.")
                self._active_mixer_handles = []
        logging.debug("Playback monitor thread finished.")

    def clear_preload_state(self, acquire_lock=True):
        """
        Clears only the preloaded song state (mixers and flags),
        does not stop active playback.
        """
        lock = callback_lock if acquire_lock else contextlib.nullcontext()
        with lock:
            if self._is_song_preloaded or self._preloaded_mixers:
                logging.debug("Clearing preload state (resources and flags)...")
                for mixer_handle_to_free in self._preloaded_mixers.values():
                    if mixer_handle_to_free:
                        # If this mixer is somehow in _active_mixer_handles, it means stop() wasn't called properly before.
                        # BASS_StreamFree will stop it anyway.
                        if mixer_handle_to_free in self._active_mixer_handles:
                            logging.warning(
                                f"Preloaded mixer {mixer_handle_to_free} was found in active handles during clear_preload_state. This might indicate an issue if playback wasn't explicitly stopped first.")
                        BASS_StreamFree(mixer_handle_to_free)

                self._preloaded_song_id = None
                self._preloaded_mixers = {}
                self._is_song_preloaded = False
                # Do NOT clear _active_mixer_handles here, as they might be playing something else,
                # or stop() is responsible for them.
                gc.collect()  # Optional
                logging.debug("Preload state (resources and flags) cleared.")
            # else:
            #     logging.debug("Clear preload state called, but nothing was preloaded or mixers already cleared.")

    def stop(self, acquire_lock=True):
        """
        Stops all current playback and clears the preloaded song state,
        ensuring the next play action will start fresh.
        """
        lock = callback_lock if acquire_lock else contextlib.nullcontext()
        with lock:
            # Check if there's anything to do (active playback or preloaded song)
            if not self._playback_active and not self._active_mixer_handles and not self._is_song_preloaded:
                logging.debug("Stop called, but nothing is playing and no song is preloaded.")
                return

            logging.info("AudioPlayer: Stop Requested. Halting playback and clearing preload.")

            # 1. Stop any currently active playback
            if self._playback_active or self._active_mixer_handles:  # Check both flags
                self._playback_active = False  # Signal playback to stop for monitor thread
                if acquire_lock and self._playback_monitor_thread and self._playback_monitor_thread.is_alive():
                    self._playback_monitor_thread.join(timeout=0.2)  # Give monitor a chance to exit

                handles_to_stop = list(self._active_mixer_handles)  # Iterate over a copy
                self._active_mixer_handles = []  # Clear immediately

                for mixer_h in handles_to_stop:
                    if mixer_h:
                        BASS_ChannelStop(mixer_h)
                logging.debug(f"Stopped {len(handles_to_stop)} active mixer handles.")

            # 2. Clear the preloaded song state (frees _preloaded_mixers and resets flags)
            # This is crucial to ensure the next play starts fresh.
            self.clear_preload_state(acquire_lock=False)  # We already hold the lock

            # Ensure playback_active is definitely false after all operations
            self._playback_active = False

            logging.info("AudioPlayer: Stop complete. Playback halted and all preloads cleared.")

    def is_playing(self):
        with callback_lock:
            if not self._playback_active or not self._active_mixer_handles: return False
            for mixer_h in self._active_mixer_handles:
                if BASS_ChannelIsActive(mixer_h) in [BASS_ACTIVE_PLAYING, BASS_ACTIVE_STALLED]: return True
            self._playback_active = False
            return False

    def shutdown(self):
        logging.info("AudioPlayer shutting down BASS...")
        self.stop()

        current_device_before_free = BASS_GetDevice()
        initialized_devices_copy = list(self.initialized_devices)
        for dev_id in initialized_devices_copy:
            if BASS_SetDevice(dev_id):
                logging.info(f"Freeing BASS device: {dev_id}")
                if not BASS_Free():
                    logging.error(f"BASS_Free failed for device {dev_id}. Error: {BASS_ErrorGetCode()}")
            else:
                logging.error(
                    f"BASS_SetDevice failed for device {dev_id} during shutdown. Error: {BASS_ErrorGetCode()}")
        self.initialized_devices.clear()
        if not initialized_devices_copy and current_device_before_free != 0xFFFFFFFF:
            if BASS_SetDevice(current_device_before_free):
                logging.info(f"Attempting to free current/default BASS context (device {current_device_before_free}).")
                BASS_Free()
        logging.info("BASS Freed (attempted for all initialized devices).")

    def calculate_song_duration(self, song_data_item):
        max_duration = 0.0
        if not song_data_item or not isinstance(song_data_item.get('audio_tracks'), list): return 0.0
        current_audio_folder = self._get_resolved_audio_upload_folder_abs()
        for track in song_data_item['audio_tracks']:
            file_path_rel = track.get('file_path')
            if not file_path_rel: continue
            file_path_abs = os.path.join(current_audio_folder, file_path_rel)
            if not os.path.exists(file_path_abs): continue
            flags = BASS_STREAM_DECODE | BASS_SAMPLE_FLOAT
            temp_stream = 0
            try:
                temp_stream = BASS_StreamCreateFile(False, file_path_abs.encode('utf-8'), 0, 0, flags)
                if temp_stream:
                    length_bytes = BASS_ChannelGetLength(temp_stream, BASS_POS_BYTE)
                    if length_bytes != 0xFFFFFFFFFFFFFFFF:
                        duration_sec = BASS_ChannelBytes2Seconds(temp_stream, length_bytes)
                        if duration_sec > max_duration: max_duration = duration_sec
                    else:
                        logging.warning(
                            f"BASS_ChannelGetLength failed for {file_path_rel} (duration calc). Error: {BASS_ErrorGetCode()}")
                else:
                    logging.warning(
                        f"BASS_StreamCreateFile failed for {file_path_rel} (duration calc). Error: {BASS_ErrorGetCode()}")
            except Exception as e:
                logging.error(f"Exception in duration calc for {file_path_rel}: {e}")
            finally:
                if temp_stream: BASS_StreamFree(temp_stream)
        return max_duration