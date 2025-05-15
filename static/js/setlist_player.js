document.addEventListener('DOMContentLoaded', function() {
    const currentSongName = document.getElementById('current-song-name');
    const currentSongBpm = document.getElementById('current-song-bpm');
    const timeRemainingDisplay = document.getElementById('time-remaining');
    const prevBtn = document.getElementById('previous-btn');
    const playBtn = document.getElementById('play-btn');
    const stopBtn = document.getElementById('stop-btn');
    const nextBtn = document.getElementById('next-btn');

    let currentSetlistId = null;
    let currentSongIndex = 0;
    let currentSetlist = { songs: [] };
    let isPlayingOrLoading = false;
    let isActivelyPreloading = false;
    let preloadedSongId = null;
    let timerInterval = null;
    let remainingSeconds = 0;
    let currentPreloadController = null;

    function _showGlobalNotification(message, type = 'info') {
        if (typeof window.showGlobalNotification === 'function') {
            window.showGlobalNotification(message, type);
        } else {
            console.warn('setlist_player.js: window.showGlobalNotification function not found. Using alert as fallback.');
            alert(type.toUpperCase() + ': ' + message);
        }
    }

    const pathParts = window.location.pathname.split('/');
    currentSetlistId = parseInt(pathParts[pathParts.length - 2]);

    if (isNaN(currentSetlistId)) {
        console.error('Invalid setlist ID from URL.');
        if(currentSongName) currentSongName.textContent = "Error: Invalid Setlist ID";
        [prevBtn, playBtn, stopBtn, nextBtn].forEach(btn => { if(btn) btn.disabled = true; });
        return;
    }

    initPlayer();

    function formatTime(totalSeconds) {
        if (isNaN(totalSeconds) || totalSeconds < 0) return "--:--";
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = Math.floor(totalSeconds % 60);
        return minutes + ":" + seconds.toString().padStart(2, '0');
    }

    function startTimer(duration) {
        stopTimer();
        if (isNaN(duration) || duration <= 0) {
            updateTimerDisplay(0); return;
        }
        remainingSeconds = Math.round(duration);
        updateTimerDisplay(remainingSeconds);
        timerInterval = setInterval(() => {
            remainingSeconds--;
            updateTimerDisplay(remainingSeconds);
            if (remainingSeconds <= 0) {
                stopTimer();
            }
        }, 1000);
    }

    function stopTimer() {
        if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
        if (!isPlayingOrLoading && currentSetlist.songs[currentSongIndex]) {
            const songDuration = currentSetlist.songs[currentSongIndex].duration || 0;
            if(timeRemainingDisplay) timeRemainingDisplay.textContent = "Length: " + formatTime(songDuration);
        } else if (!isPlayingOrLoading) {
            if(timeRemainingDisplay) timeRemainingDisplay.textContent = "Length: --:--";
        }
        remainingSeconds = 0;
    }

    function updateTimerDisplay(seconds) {
        if (timeRemainingDisplay) {
            timeRemainingDisplay.textContent = "Time: " + formatTime(seconds);
        }
    }

    async function triggerPreload(songIndexToPreload) {
        if (currentPreloadController) currentPreloadController.abort();
        currentPreloadController = new AbortController();
        const signal = currentPreloadController.signal;

        if (songIndexToPreload < 0 || songIndexToPreload >= currentSetlist.songs.length) {
            currentPreloadController = null; return;
        }
        const songToPreload = currentSetlist.songs[songIndexToPreload];
        if (!songToPreload || !songToPreload.id) {
            currentPreloadController = null; return;
        }
        if (preloadedSongId === songToPreload.id && !isActivelyPreloading) {
            currentPreloadController = null; return;
        }

        console.log("Preloading song: '" + songToPreload.name + "' (ID: " + songToPreload.id + ")");
        isActivelyPreloading = true;
        preloadedSongId = null;

        if (!isPlayingOrLoading && playBtn) {
            playBtn.disabled = true;
            playBtn.textContent = '⏳ Preloading...';
        }
        _showGlobalNotification("Preloading '" + songToPreload.name + "'...", 'info');

        try {
            const response = await fetch("/api/setlists/" + currentSetlistId + "/song/" + songToPreload.id + "/preload", {
                method: 'POST', signal: signal
            });
            const data = await response.json();
            if (signal.aborted) { console.log('Preload aborted for', songToPreload.name); return; }
            if (!response.ok || !data.success) {
                throw new Error(data.error || "Failed to preload '" + songToPreload.name + "'");
            }
            preloadedSongId = data.preloaded_song_id;
            console.log("Successfully preloaded song ID " + preloadedSongId + " ('" + songToPreload.name + "')");
            _showGlobalNotification("'" + songToPreload.name + "' is ready.", 'success');
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Error in triggerPreload:', error);
                _showGlobalNotification(error.message, 'error');
                preloadedSongId = null;
            }
        } finally {
            if (currentPreloadController && currentPreloadController.signal === signal) {
                currentPreloadController = null;
            }
            isActivelyPreloading = false;
            if (!isPlayingOrLoading && playBtn) {
                playBtn.disabled = false;
                playBtn.textContent = '▶ Play';
            }
        }
    }

    async function playCurrentSong() {
        if (isActivelyPreloading) {
            _showGlobalNotification("Please wait, song is preloading...", "info"); return;
        }
        if (isPlayingOrLoading) return;
        if (currentSetlist.songs.length === 0 || currentSongIndex >= currentSetlist.songs.length) {
            _showGlobalNotification("No valid song selected or end of setlist.", "warning"); return;
        }

        isPlayingOrLoading = true;
        const songToPlay = currentSetlist.songs[currentSongIndex];
        if(playBtn) { playBtn.disabled = true; playBtn.textContent = '⏳ Loading...'; }

        try {
            if (preloadedSongId !== songToPlay.id) {
                _showGlobalNotification("Preloading '" + songToPlay.name + "' before playback...", 'info');
                await triggerPreload(currentSongIndex);
                if (preloadedSongId !== songToPlay.id) {
                    throw new Error("Preload failed for '" + songToPlay.name + "', cannot play.");
                }
            }

            const response = await fetch("/api/setlists/" + currentSetlistId + "/play", {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ current_song_index: currentSongIndex })
            });
            const responseData = await response.json();
            if (!response.ok) throw new Error(responseData.error || 'HTTP error! status: ' + response.status);
            if (responseData.success && responseData.current_song_id === songToPlay.id) {
                if(currentSongName) currentSongName.textContent = responseData.song_name;
                if(currentSongBpm) currentSongBpm.textContent = 'BPM: ' + responseData.song_tempo;
                setActiveSongUI(currentSongIndex);
                if(playBtn) playBtn.textContent = '⏸ Playing';
                startTimer(responseData.duration);
            } else {
                throw new Error(responseData.error || 'Playback initiation failed on backend.');
            }
        } catch (error) {
            console.error('Error in playCurrentSong:', error);
            _showGlobalNotification("Playback Error: " + error.message, 'error');
            isPlayingOrLoading = false;
            if(playBtn) { playBtn.textContent = '▶ Play'; playBtn.disabled = false; }
            stopTimer();
            updateNowPlayingUI(songToPlay);
        } finally {
            if(playBtn) playBtn.disabled = false;
        }
    }

    async function stopPlayback() {
        console.log("Stop playback requested.");
        const songAtStop = currentSetlist.songs[currentSongIndex];

        if (currentPreloadController) { currentPreloadController.abort(); currentPreloadController = null; }
        isActivelyPreloading = false;
        stopTimer();

        if (!isPlayingOrLoading && playBtn && playBtn.textContent === '▶ Play') {
            if(playBtn) playBtn.disabled = false;
            if(stopBtn) stopBtn.disabled = false;
            if (songAtStop) updateNowPlayingUI(songAtStop);
            return;
        }

        const wasPlaying = isPlayingOrLoading;
        isPlayingOrLoading = false;
        if(stopBtn) { stopBtn.disabled = true; stopBtn.textContent = 'Stopping...';}
        if(playBtn) { playBtn.textContent = '▶ Play'; playBtn.disabled = false; }

        try {
            const response = await fetch('/api/stop', { method: 'POST' });
            const data = await response.json();
            if (!response.ok || !data.success) {
                console.warn("Backend /api/stop reported failure or no action:", data.error || "Unknown");
                 if(wasPlaying) _showGlobalNotification("Stop command sent, but backend reported an issue.", "warning");
            } else {
                if(wasPlaying) _showGlobalNotification("Playback stopped.", "info");
            }
        } catch (error) {
            console.error('Error calling /api/stop:', error);
            _showGlobalNotification('Error stopping playback: ' + error.message, 'error');
        } finally {
            if(playBtn) { playBtn.textContent = '▶ Play'; playBtn.disabled = false; }
            if(stopBtn) { stopBtn.disabled = false; stopBtn.textContent = '⏹ Stop'; }
            if (songAtStop) updateNowPlayingUI(songAtStop);
            else if (currentSetlist.songs.length > 0) updateNowPlayingUI(currentSetlist.songs[0]);
            else if(timeRemainingDisplay) timeRemainingDisplay.textContent = "Length: --:--";
        }
    }

    async function handleNextSong() {
        if (currentSetlist.songs.length === 0) return;
        if (isPlayingOrLoading || isActivelyPreloading) await stopPlayback();
        if (isPlayingOrLoading || isActivelyPreloading) return;

        let nextIndex = currentSongIndex + 1;
        if (nextIndex >= currentSetlist.songs.length) {
            _showGlobalNotification('Reached end of setlist.', 'info');
            nextIndex = currentSetlist.songs.length - 1;
            if (currentSongIndex === nextIndex && currentSetlist.songs[nextIndex]) {
                 updateNowPlayingUI(currentSetlist.songs[nextIndex]);
                 triggerPreload(nextIndex);
                return;
            }
        }
        currentSongIndex = nextIndex;
        setActiveSongUI(currentSongIndex);
        updateNowPlayingUI(currentSetlist.songs[currentSongIndex]);
        triggerPreload(currentSongIndex);
    }

    async function handlePreviousSong() {
        if (currentSetlist.songs.length === 0) return;
        if (isPlayingOrLoading || isActivelyPreloading) await stopPlayback();
        if (isPlayingOrLoading || isActivelyPreloading) return;

        let prevIndex = currentSongIndex - 1;
        if (prevIndex < 0) {
            _showGlobalNotification('Already at the first song.', 'info');
            prevIndex = 0;
             if (currentSongIndex === prevIndex && currentSetlist.songs[prevIndex]) {
                 updateNowPlayingUI(currentSetlist.songs[prevIndex]);
                 triggerPreload(prevIndex);
                return;
            }
        }
        currentSongIndex = prevIndex;
        setActiveSongUI(currentSongIndex);
        updateNowPlayingUI(currentSetlist.songs[currentSongIndex]);
        triggerPreload(currentSongIndex);
    }

    function initPlayer() {
        const songItemsFromDOM = document.querySelectorAll('#setlist-songs .song-item');
        currentSetlist.songs = Array.from(songItemsFromDOM).map(item => {
            const nameEl = item.querySelector('.song-name');
            const detailsEl = item.querySelector('.song-details');
            const songId = parseInt(item.dataset.songId);
            const duration = parseFloat(item.dataset.duration) || 0;
            const tempoMatch = detailsEl ? detailsEl.textContent.match(/(\d+)\s*BPM/i) : null;
            if (!nameEl || isNaN(songId) || !tempoMatch) return null;
            return { id: songId, name: nameEl.textContent, tempo: parseInt(tempoMatch[1]), duration: duration };
        }).filter(song => song !== null);

        if (currentSetlist.songs.length === 0) {
            if(currentSongName) currentSongName.textContent = "Setlist is empty";
            [prevBtn, playBtn, stopBtn, nextBtn].forEach(btn => { if(btn) btn.disabled = true; });
        } else {
            attachSongItemClickListeners();
            setActiveSongUI(0);
            updateNowPlayingUI(currentSetlist.songs[0]);
            triggerPreload(0);
        }

        if(playBtn) playBtn.addEventListener('click', playCurrentSong);
        if(stopBtn) stopBtn.addEventListener('click', stopPlayback);
        if(prevBtn) prevBtn.addEventListener('click', handlePreviousSong);
        if(nextBtn) nextBtn.addEventListener('click', handleNextSong);
    }

    function attachSongItemClickListeners() {
        document.querySelectorAll('#setlist-songs .song-item').forEach((item) => {
            const songId = parseInt(item.dataset.songId);
            const songInSetlist = currentSetlist.songs.find(s => s.id === songId);
            if (!songInSetlist) return;
            item.addEventListener('click', async () => {
                const clickedSongIndex = currentSetlist.songs.findIndex(s => s.id === songId);
                if (clickedSongIndex === -1) return;
                if (currentSongIndex === clickedSongIndex && (isPlayingOrLoading || (playBtn && playBtn.textContent === '⏸ Playing'))) {
                    return;
                }
                if (isPlayingOrLoading || isActivelyPreloading) await stopPlayback();
                if (isPlayingOrLoading || isActivelyPreloading) return;

                currentSongIndex = clickedSongIndex;
                setActiveSongUI(currentSongIndex);
                updateNowPlayingUI(currentSetlist.songs[currentSongIndex]);
                triggerPreload(currentSongIndex);
            });
        });
    }

    function setActiveSongUI(index) {
        document.querySelectorAll('#setlist-songs .song-item').forEach((item, i) => {
            item.classList.toggle('active', i === index);
        });
        const activeItem = document.querySelector('#setlist-songs .song-item.active');
        if (activeItem) activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function updateNowPlayingUI(song) {
        if (!song) {
            if(currentSongName) currentSongName.textContent = "Error: Song data missing";
            if(currentSongBpm) currentSongBpm.textContent = "BPM: --";
            if(timeRemainingDisplay) timeRemainingDisplay.textContent = "Length: --:--";
            return;
        }
        if(currentSongName) currentSongName.textContent = song.name;
        if(currentSongBpm) currentSongBpm.textContent = "BPM: " + song.tempo;
        if (!isPlayingOrLoading && !isActivelyPreloading && !timerInterval) {
             if(timeRemainingDisplay) timeRemainingDisplay.textContent = "Length: " + formatTime(song.duration || 0);
        }
    }
});
