document.addEventListener('DOMContentLoaded', function() {
    const MAX_LOGICAL_CHANNELS = 64;

    const mappingsContainer = document.getElementById('audio-output-mappings');
    const addMappingBtn = document.getElementById('add-mapping-btn');
    const saveAudioSettingsBtn = document.getElementById('save-audio-settings-btn');
    const globalVolumeSlider = document.getElementById('global-volume-control');
    const globalVolumeValue = document.getElementById('global-volume-value');
    const audioSaveStatus = document.getElementById('audio-save-status');
    const sampleRateSelect = document.getElementById('sample-rate-select');
    const audioOutputSection = document.getElementById('audio-output-section');
    const keyboardControlSection = document.getElementById('keyboard-control-section');
    const dataManagementSection = document.getElementById('data-management-section');
    const dangerZoneSection = document.getElementById('danger-zone-section');
    const customAudioDirectoryPathInput = document.getElementById('custom-audio-directory-path');
    const setAudioDirectoryBtn = document.getElementById('set-audio-directory-btn');
    const audioDirectoryStatusEl = document.getElementById('audio-directory-status');
    const browseAudioDirectoryBtn = document.getElementById('browse-audio-directory-btn');
    const importSongsBtn = document.getElementById('import-songs-btn');
    const importSongsFileEl = document.getElementById('import-songs-file');
    const importSongsStatusEl = document.getElementById('import-songs-status');
    const importSetlistsBtn = document.getElementById('import-setlists-btn');
    const importSetlistsFileEl = document.getElementById('import-setlists-file');
    const importSetlistsStatusEl = document.getElementById('import-setlists-status');
    const openAudioDirBtn = document.getElementById('open-audio-dir');
    const clearCacheBtn = document.getElementById('clear-cache');
    const factoryResetBtn = document.getElementById('factory-reset');
    const deleteAllSongsBtn = document.getElementById('delete-all-songs');

    // Hidden file input for webkitdirectory is NO LONGER NEEDED
    // const hiddenAudioDirPicker = document.getElementById('hidden-audio-dir-picker');

    let masterAvailableDevicesFromBass = [];
    let availableAudioDevices = [];
    let knownDeviceDetails = {};

    function showStatusMessage(element, message, isError = false, duration = 4000) {
        if (!element) return;
        element.textContent = message;
        element.className = 'save-status setting-status-message ' + (isError ? 'error active' : 'success active');
        element.style.display = 'block';
        setTimeout(() => {
            if (element) {
                element.textContent = '';
                element.style.display = 'none';
                element.classList.remove('active', 'success', 'error');
            }
        }, duration);
    }

    function parseChannels(channelString) {
        if (!channelString || typeof channelString !== 'string') return null;
        const channels = new Set();
        const parts = channelString.split(',');
        const rangeRegex = /^\s*(\d+)\s*-\s*(\d+)\s*$/;
        const singleRegex = /^\s*(\d+)\s*$/;
        for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed) continue;
            let begin, end;
            const singleMatch = trimmed.match(singleRegex);
            if (singleMatch) {
                begin = end = parseInt(singleMatch[1], 10);
            } else {
                const rangeMatch = trimmed.match(rangeRegex);
                if (rangeMatch) {
                    begin = parseInt(rangeMatch[1], 10);
                    end = parseInt(rangeMatch[2], 10);
                } else {
                    return null;
                }
            }
            if (isNaN(begin) || isNaN(end) || begin < 1 || end < 1 || begin > MAX_LOGICAL_CHANNELS || end > MAX_LOGICAL_CHANNELS || begin > end) {
                return null;
            }
            for (let i = begin; i <= end; i++) {
                channels.add(i - 1);
            }
        }
        return channels.size > 0 ? Array.from(channels).sort((a, b) => a - b) : [];
    }

    function formatChannels(channelsZeroBased) {
        if (!channelsZeroBased || channelsZeroBased.length === 0) return "";
        const uniqueChannelsOneBased = [...new Set(channelsZeroBased.map(ch => ch + 1))].sort((a, b) => a - b);
        const parts = [];
        let rangeStart = -1;
        for (let i = 0; i < uniqueChannelsOneBased.length; i++) {
            const current = uniqueChannelsOneBased[i];
            if (rangeStart === -1) {
                rangeStart = current;
            }
            const next = uniqueChannelsOneBased[i + 1];
            if (next !== current + 1 || i === uniqueChannelsOneBased.length - 1) {
                const begin = rangeStart;
                const end = current;
                if (begin === end) {
                    parts.push(String(begin));
                } else {
                    parts.push(begin + '-' + end);
                }
                rangeStart = -1;
            }
        }
        return parts.join(',');
    }

    function refreshAllDeviceSelectOptions() {
        if (!mappingsContainer) return;
        const allDeviceSelects = mappingsContainer.querySelectorAll('.device-select');

        const globallySelectedIdsInThisRefresh = new Set();
        allDeviceSelects.forEach(sel => {
            const intendedVal = sel.dataset.intendedDeviceId ? parseInt(sel.dataset.intendedDeviceId, 10) : parseInt(sel.value, 10);
            if (intendedVal !== -1 && !isNaN(intendedVal)) {
                globallySelectedIdsInThisRefresh.add(intendedVal);
            }
        });

        allDeviceSelects.forEach(currentSelect => {
            const intendedDeviceIdFromDataset = currentSelect.dataset.intendedDeviceId
                                                ? parseInt(currentSelect.dataset.intendedDeviceId, 10)
                                                : null;
            const currentValueInSelect = parseInt(currentSelect.value, 10);
            const targetDeviceIdForThisSelect = intendedDeviceIdFromDataset !== null && !isNaN(intendedDeviceIdFromDataset)
                                               ? intendedDeviceIdFromDataset
                                               : (currentValueInSelect !== -1 && !isNaN(currentValueInSelect) ? currentValueInSelect : -1);

            while (currentSelect.options.length > 1) {
                currentSelect.remove(1);
            }

            let targetOptionWasAdded = false;
            availableAudioDevices.forEach(device => {
                const isClaimedByAnotherDropdown = globallySelectedIdsInThisRefresh.has(device.id) && device.id !== targetDeviceIdForThisSelect;
                if (device.id === targetDeviceIdForThisSelect || !isClaimedByAnotherDropdown) {
                    const option = document.createElement('option');
                    option.value = String(device.id);
                    let nameDisplay = device.name;
                    let channelsDisplay = device.max_output_channels ? '(' + device.max_output_channels + ' ch)' : '(N/A)';
                    if (device.is_placeholder) {
                        option.style.fontStyle = "italic";
                        option.style.color = "#888";
                        channelsDisplay = device.max_output_channels ? '(' + device.max_output_channels + ' ch)' : '';
                    }
                    option.textContent = (nameDisplay + ' ' + channelsDisplay).trim();
                    currentSelect.appendChild(option);
                    if (device.id === targetDeviceIdForThisSelect) {
                        targetOptionWasAdded = true;
                    }
                }
            });

            if (targetOptionWasAdded) {
                currentSelect.value = String(targetDeviceIdForThisSelect);
            } else {
                currentSelect.value = "-1";
            }

            if (currentSelect.dataset.intendedDeviceId) {
                delete currentSelect.dataset.intendedDeviceId;
            }
            currentSelect.classList.remove('input-error');
        });

        const finalSelections = new Map();
        allDeviceSelects.forEach(sel => {
            const val = parseInt(sel.value, 10);
            const deviceData = availableAudioDevices.find(d => d.id === val);
            if (val !== -1 && deviceData && !deviceData.is_placeholder) {
                finalSelections.set(val, (finalSelections.get(val) || 0) + 1);
            }
        });
        allDeviceSelects.forEach(sel => {
            const val = parseInt(sel.value);
            const deviceData = availableAudioDevices.find(d => d.id === val);
            if (val !== -1 && deviceData && !deviceData.is_placeholder && finalSelections.get(val) > 1) {
                sel.classList.add('input-error');
            }
        });
    }

    function addMappingRow(mapping = null) {
        if (!mappingsContainer) return;
        const row = document.createElement('div');
        row.className = 'mapping-row setting-row';
        const deviceLabel = document.createElement('label');
        deviceLabel.textContent = "Device:";
        const deviceSelect = document.createElement('select');
        deviceSelect.className = 'settings-select device-select';
        const defaultOption = document.createElement('option');
        defaultOption.value = "-1";
        defaultOption.textContent = "Select Device...";
        deviceSelect.appendChild(defaultOption);

        if (mapping && mapping.device_id !== undefined) {
            deviceSelect.dataset.intendedDeviceId = String(mapping.device_id);
        }

        deviceSelect.addEventListener('change', () => {
            availableAudioDevices = [...masterAvailableDevicesFromBass];
            refreshAllDeviceSelectOptions();
        });

        const channelLabel = document.createElement('label');
        channelLabel.textContent = "Logical Ch:";
        const channelInput = document.createElement('input');
        channelInput.type = 'text';
        channelInput.className = 'settings-input channel-input';
        channelInput.placeholder = 'Channels (1-' + MAX_LOGICAL_CHANNELS + ')';
        if (mapping && mapping.channels) {
            channelInput.value = formatChannels(mapping.channels.map(ch => ch - 1));
        }

        const removeBtn = document.createElement('button');
        removeBtn.textContent = '✕ Remove';
        removeBtn.className = 'settings-button danger remove-mapping-btn';
        removeBtn.type = 'button';
        removeBtn.addEventListener('click', () => {
            row.remove();
            availableAudioDevices = [...masterAvailableDevicesFromBass];
            refreshAllDeviceSelectOptions();
        });

        row.appendChild(deviceLabel);
        row.appendChild(deviceSelect);
        row.appendChild(channelLabel);
        row.appendChild(channelInput);
        row.appendChild(removeBtn);
        mappingsContainer.appendChild(row);
    }

    async function loadAndDisplayAudioSettings() {
        if (!mappingsContainer || !sampleRateSelect || !globalVolumeSlider || !globalVolumeValue) {
             console.error("LoadAudioSettings: Missing critical UI elements.");
             if(mappingsContainer) mappingsContainer.innerHTML = '<p class="error-message">UI elements missing. Cannot load settings.</p>';
             return;
        }
        mappingsContainer.innerHTML = '<p>Loading audio settings...</p>';

        try {
            const response = await fetch('/api/settings/audio_device');
            if (!response.ok) {
                const errData = await response.json().catch(() => ({error: 'HTTP error ' + response.status}));
                throw new Error(errData.error || 'HTTP error ' + response.status);
            }
            const data = await response.json();

            masterAvailableDevicesFromBass = data.available_devices || [];
            knownDeviceDetails = {};
            masterAvailableDevicesFromBass.forEach(device => {
                knownDeviceDetails[device.id] = {
                    name: device.name,
                    max_output_channels: device.max_output_channels
                };
            });

            let uiSelectableDevices = [...masterAvailableDevicesFromBass];
            if (data.current_config && data.current_config.length > 0) {
                data.current_config.forEach(mapping => {
                    const savedDeviceId = mapping.device_id;
                    if (savedDeviceId !== undefined && savedDeviceId !== -1) {
                        const isAlreadyInEffectiveList = uiSelectableDevices.some(d => d.id === savedDeviceId);
                        if (!isAlreadyInEffectiveList) {
                            const cachedDetail = knownDeviceDetails[savedDeviceId];
                            uiSelectableDevices.push({
                                id: savedDeviceId,
                                name: cachedDetail ? (cachedDetail.name + ' (Saved - Not Active)') : ('Device ID ' + savedDeviceId + ' (Saved - Unknown)'),
                                max_output_channels: cachedDetail ? cachedDetail.max_output_channels : null,
                                is_placeholder: true
                            });
                        }
                    }
                });
                uiSelectableDevices.sort((a, b) => a.id - b.id);
            }

            availableAudioDevices = uiSelectableDevices;

            mappingsContainer.innerHTML = '';
            if (data.current_config && data.current_config.length > 0) {
                data.current_config.forEach(mapping => {
                    addMappingRow(mapping);
                });
                refreshAllDeviceSelectOptions();
            } else {
                mappingsContainer.innerHTML = '<p class="setting-hint">No audio output mappings defined. Click "Add Output Mapping" to begin.</p>';
            }

            availableAudioDevices = [...masterAvailableDevicesFromBass];

            if (data.volume !== undefined) {
                globalVolumeSlider.value = data.volume * 100;
                globalVolumeValue.textContent = Math.round(data.volume * 100) + '%';
            } else {
                 globalVolumeSlider.value = 100;
                 globalVolumeValue.textContent = '100%';
            }

            sampleRateSelect.innerHTML = '';
            const supportedRates = data.supported_sample_rates || [44100, 48000, 88200, 96000];
            supportedRates.forEach(rate => {
                const option = document.createElement('option');
                option.value = rate;
                option.textContent = rate + ' Hz';
                sampleRateSelect.appendChild(option);
            });
            if (data.current_sample_rate !== undefined) {
                sampleRateSelect.value = data.current_sample_rate;
            } else {
                sampleRateSelect.value = "48000";
            }

        } catch (error) {
            console.error("Error loading audio settings:", error);
            if (mappingsContainer) mappingsContainer.innerHTML = '<p class="error-message">Error loading audio settings: ' + error.message + '</p>';
            showGlobalNotification('Audio settings load failed: ' + error.message, 'error');
        }
    }

    async function saveAudioConfiguration() {
        if (!mappingsContainer || !saveAudioSettingsBtn || !globalVolumeSlider || !sampleRateSelect || !audioSaveStatus) {
            console.error("SaveAudioConfiguration: Critical elements missing.");
            return;
        }
        saveAudioSettingsBtn.disabled = true;
        saveAudioSettingsBtn.textContent = 'Saving...';
        if (audioSaveStatus) showStatusMessage(audioSaveStatus, '', false);
        const rows = mappingsContainer.querySelectorAll('.mapping-row');
        const outputs = [];
        let clientSideValidationError = false;
        const tempUsedDeviceIds = new Set();
        rows.forEach(row => {
            if (clientSideValidationError) return;
            const deviceSelect = row.querySelector('.device-select');
            const channelInput = row.querySelector('.channel-input');
            const deviceId = parseInt(deviceSelect.value, 10);
            const channelString = channelInput.value.trim();
            deviceSelect.classList.remove('input-error');
            channelInput.classList.remove('input-error');
            if (deviceId === -1 && channelString === "") {
                return;
            }
            if (deviceId === -1) {
                showStatusMessage(audioSaveStatus, 'A mapping row is incomplete. Please select a device.', true);
                clientSideValidationError = true;
                if (deviceSelect) deviceSelect.classList.add('input-error');
                return;
            }

            const isCurrentDevicePlaceholder = !(masterAvailableDevicesFromBass.some(d => d.id === deviceId));
            if (!isCurrentDevicePlaceholder && tempUsedDeviceIds.has(deviceId)) {
                const deviceName = deviceSelect.options[deviceSelect.selectedIndex]?.text || ('Device ID ' + deviceId);
                showStatusMessage(audioSaveStatus, 'Device "' + deviceName.replace(/\s*\(Saved.*?\)\s*/, '').replace(/\s*\(Channels N\/A\)\s*/, '').trim() + '" is selected multiple times. Each active device can only be used once.', true);
                clientSideValidationError = true;
                mappingsContainer.querySelectorAll('.device-select').forEach(sel => {
                    if (parseInt(sel.value) === deviceId) sel.classList.add('input-error');
                });
                return;
            }
            if(!isCurrentDevicePlaceholder) tempUsedDeviceIds.add(deviceId);

            const parsedZeroBasedChannels = parseChannels(channelString);
            if (parsedZeroBasedChannels === null || (parsedZeroBasedChannels.length === 0 && channelString !== "")) {
                const deviceName = deviceSelect.options[deviceSelect.selectedIndex]?.text || ('Device ID ' + deviceId);
                showStatusMessage(audioSaveStatus, 'Invalid channel format for device "' + deviceName.replace(/\s*\(Saved.*?\)\s*/, '').replace(/\s*\(Channels N\/A\)\s*/, '').trim() + '". Use numbers or ranges (e.g., 1, 3-5).', true);
                clientSideValidationError = true;
                if (channelInput) channelInput.classList.add('input-error');
                return;
            }
            if (parsedZeroBasedChannels.length === 0 && deviceId !== -1) {
                const deviceName = deviceSelect.options[deviceSelect.selectedIndex]?.text || ('Device ID ' + deviceId);
                showStatusMessage(audioSaveStatus, 'Please enter channels for selected device: ' + deviceName.replace(/\s*\(Saved.*?\)\s*/, '').replace(/\s*\(Channels N\/A\)\s*/, '').trim() + '.', true);
                clientSideValidationError = true;
                if (channelInput) channelInput.classList.add('input-error');
                return;
            }
            const logicalChannelsOneBased = parsedZeroBasedChannels.map(ch => ch + 1);
            outputs.push({ device_id: deviceId, channels: logicalChannelsOneBased });
        });

        if (clientSideValidationError) {
            saveAudioSettingsBtn.disabled = false;
            saveAudioSettingsBtn.textContent = 'Save Audio Settings';
            return;
        }
        const volume = parseFloat(globalVolumeSlider.value) / 100;
        const sampleRate = parseInt(sampleRateSelect.value, 10);
        const payload = {
            audio_outputs: outputs,
            volume: volume,
            sample_rate: sampleRate
        };
        try {
            const response = await fetch('/api/settings/audio_device', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (!response.ok) {
                 showStatusMessage(audioSaveStatus, 'Error: ' + (result.error || 'HTTP ' + response.status), true);
                 showGlobalNotification('Save failed: ' + (result.error || 'HTTP ' + response.status), 'error');
                 throw new Error(result.error || 'HTTP ' + response.status);
            }
            showStatusMessage(audioSaveStatus, 'Audio settings saved successfully!', false);
            showGlobalNotification("Audio settings saved. Outputs will update on app reset.", "success", 6000);
            await loadAndDisplayAudioSettings();
        } catch (error) {
            console.error("Error saving audio configuration:", error);
            if (!audioSaveStatus.textContent || audioSaveStatus.style.display !== 'block') {
                showStatusMessage(audioSaveStatus, 'Save Error: ' + error.message, true);
                showGlobalNotification('Save failed: ' + error.message, 'error');
            }
        } finally {
            saveAudioSettingsBtn.disabled = false;
            saveAudioSettingsBtn.textContent = 'Save Audio Settings';
        }
    }

    async function loadAudioDirectorySetting() {
        if (!customAudioDirectoryPathInput || !audioDirectoryStatusEl) return;
        try {
            const response = await fetch('/api/settings/audio_directory');
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || 'HTTP error ' + response.status);
            }
            const data = await response.json();
            customAudioDirectoryPathInput.value = data.audio_directory_path || '';
        } catch (error) {
            console.error('Error loading audio directory setting:', error);
            showStatusMessage(audioDirectoryStatusEl, 'Error loading path: ' + error.message, true);
        }
    }

    async function saveAudioDirectorySetting() {
        if (!customAudioDirectoryPathInput || !setAudioDirectoryBtn || !audioDirectoryStatusEl) return;
        const newPath = customAudioDirectoryPathInput.value.trim();
        if (!newPath) {
            showStatusMessage(audioDirectoryStatusEl, "Audio directory path cannot be empty.", true);
            return;
        }
        setAudioDirectoryBtn.disabled = true;
        setAudioDirectoryBtn.textContent = 'Setting...';
        showStatusMessage(audioDirectoryStatusEl, "Updating path...", false, 60000);
        try {
            const response = await fetch('/api/settings/audio_directory', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ audio_directory_path: newPath })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'HTTP error ' + response.status);
            if (result.success) {
                showStatusMessage(audioDirectoryStatusEl, result.message || "Audio directory updated successfully!", false);
                showGlobalNotification(result.message || "Audio directory updated. Restart may be needed for full effect.", "success", 6000);
            } else {
                throw new Error(result.error || "Failed to update audio directory.");
            }
        } catch (error) {
            console.error('Error saving audio directory setting:', error);
            showStatusMessage(audioDirectoryStatusEl, 'Error: ' + error.message, true, 8000);
            showGlobalNotification('Failed to set audio directory: ' + error.message, 'error');
        } finally {
            setAudioDirectoryBtn.disabled = false;
            setAudioDirectoryBtn.textContent = 'Set Path';
        }
    }

    async function handleBrowseAudioDirectory() {
        if (!customAudioDirectoryPathInput || !audioDirectoryStatusEl || !browseAudioDirectoryBtn) return;

        const originalButtonText = browseAudioDirectoryBtn.textContent;
        browseAudioDirectoryBtn.disabled = true;
        browseAudioDirectoryBtn.textContent = 'Browsing...';

        if (audioDirectoryStatusEl) {
            audioDirectoryStatusEl.textContent = '';
            audioDirectoryStatusEl.style.display = 'none';
            audioDirectoryStatusEl.classList.remove('active', 'success', 'error');
        }

        if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.select_audio_directory === 'function') {
            try {
                const selectedPath = await window.pywebview.api.select_audio_directory();
                if (selectedPath) {
                    customAudioDirectoryPathInput.value = selectedPath;
                    showStatusMessage(audioDirectoryStatusEl, "Path selected. Click 'Set Path' to save.", false);
                } else {
                    showStatusMessage(audioDirectoryStatusEl, "Folder selection cancelled.", true, 3000);
                }
            } catch (error) {
                console.error("Error calling pywebview API for folder selection:", error);
                showStatusMessage(audioDirectoryStatusEl, "Error opening folder dialog.", true);
                showGlobalNotification("Could not open folder dialog. Ensure the app is running correctly.", "error");
            } finally {
                browseAudioDirectoryBtn.disabled = false;
                browseAudioDirectoryBtn.textContent = originalButtonText;
            }
        } else {
            showGlobalNotification("Browse feature is not available in this environment. Please type the path manually.", "warning", 6000);
            console.warn("window.pywebview.api.select_audio_directory is not available.");
            browseAudioDirectoryBtn.disabled = false;
            browseAudioDirectoryBtn.textContent = originalButtonText;
        }
    }

    async function handleImport(importType, fileInputEl, statusEl, importBtnEl) {
        if (!fileInputEl || !fileInputEl.files || fileInputEl.files.length === 0) {
            showStatusMessage(statusEl, "Please select a file first.", true);
            return;
        }
        const file = fileInputEl.files[0];
        if (!file.name.endsWith('.json')) {
            showStatusMessage(statusEl, "Invalid file type. Please select a .json file.", true);
            return;
        }
        const confirmed = await showCustomConfirm(
            'Importing ' + importType + ' will OVERWRITE current data. Are you sure you want to proceed? It\'s recommended to export your current data first.',
            'Confirm Import ' + importType.charAt(0).toUpperCase() + importType.slice(1)
        );
        if (!confirmed) {
            showStatusMessage(statusEl, "Import cancelled by user.", true);
            if (fileInputEl) fileInputEl.value = '';
            return;
        }

        const originalButtonText = importBtnEl.textContent;
        importBtnEl.disabled = true;
        importBtnEl.textContent = 'Importing...';
        showStatusMessage(statusEl, "Importing data...", false, 60000);

        const formData = new FormData();
        formData.append('file', file);
        try {
            const response = await fetch('/api/import/' + importType, { method: 'POST', body: formData });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'HTTP ' + response.status);
            if (result.success) {
                showStatusMessage(statusEl, result.message || importType.charAt(0).toUpperCase() + importType.slice(1) + ' imported successfully.', false);
                showGlobalNotification(result.message || importType.charAt(0).toUpperCase() + importType.slice(1) + ' imported. Please refresh relevant pages if needed.', "success", 6000);
            } else {
                throw new Error(result.error || 'Failed to import ' + importType + '.');
            }
        } catch (error) {
            console.error('Import error (' + importType + '):', error);
            showStatusMessage(statusEl, 'Error: ' + error.message, true);
            showGlobalNotification('Import failed: ' + error.message, 'error');
        } finally {
            importBtnEl.disabled = false;
            importBtnEl.textContent = originalButtonText;
            if (fileInputEl) fileInputEl.value = '';
        }
    }

    if (addMappingBtn) {
        addMappingBtn.addEventListener('click', () => {
            if (mappingsContainer) {
                const hint = mappingsContainer.querySelector('p.setting-hint');
                if (hint) hint.remove();
            }
            availableAudioDevices = [...masterAvailableDevicesFromBass];
            addMappingRow();
            refreshAllDeviceSelectOptions();
        });
    }
    if (saveAudioSettingsBtn) {
        saveAudioSettingsBtn.addEventListener('click', saveAudioConfiguration);
    }
    if (globalVolumeSlider && globalVolumeValue) {
        globalVolumeSlider.addEventListener('input', () => {
            if (globalVolumeValue) globalVolumeValue.textContent = globalVolumeSlider.value + '%';
        });
    }

    if (setAudioDirectoryBtn) setAudioDirectoryBtn.addEventListener('click', saveAudioDirectorySetting);
    if (browseAudioDirectoryBtn) browseAudioDirectoryBtn.addEventListener('click', handleBrowseAudioDirectory);
    if (importSongsBtn && importSongsFileEl && importSongsStatusEl) {
        importSongsBtn.addEventListener('click', async () => {
            await handleImport('songs', importSongsFileEl, importSongsStatusEl, importSongsBtn);
        });
    }
    if (importSetlistsBtn && importSetlistsFileEl && importSetlistsStatusEl) {
        importSetlistsBtn.addEventListener('click', async () => {
            await handleImport('setlists', importSetlistsFileEl, importSetlistsStatusEl, importSetlistsBtn);
        });
    }

    if (openAudioDirBtn) {
        openAudioDirBtn.addEventListener('click', function() {
            fetch('/api/settings/open_directory', { method: 'POST' })
            .then(response => response.json().then(data => ({ ok: response.ok, data })))
            .then(({ ok, data }) => {
                if (!ok || !data.success) throw new Error(data.error || 'Unknown error opening directory');
                showGlobalNotification(data.message || 'Opened Audio Directory (OS dependent).', 'info');
            }).catch(error => {
                console.error('Error opening audio directory:', error);
                showGlobalNotification('Error: ' + error.message, 'error');
            });
        });
    }
    if (clearCacheBtn) {
        clearCacheBtn.addEventListener('click', async function() {
            const confirmed = await showCustomConfirm('Are you sure you want to clear the application cache? This might resolve some display issues but will not delete your data files.', 'Confirm Clear Cache');
            if (confirmed) {
                fetch('/api/clear_cache', { method: 'POST' })
                .then(response => response.json().then(data => ({ ok: response.ok, data })))
                .then(({ ok, data }) => {
                    if (!ok || !data.success) throw new Error(data.message || 'Cache clear failed');
                    showGlobalNotification('Application cache cleared successfully.', 'success');
                }).catch(error => {
                    console.error('Cache clear error:', error);
                    showGlobalNotification('Error: ' + error.message, 'error');
                });
            } else {
                showGlobalNotification("Cache clear cancelled.", "info");
            }
        });
    }
    if (factoryResetBtn) {
        factoryResetBtn.addEventListener('click', async function() {
            let confirmed = await showCustomConfirm('DANGER ZONE! Are you absolutely sure you want to perform a factory reset? This will DELETE ALL songs, setlists, audio files, and reset ALL settings to their defaults. This action is IRREVERSIBLE.', 'Confirm Factory Reset');
            if (confirmed) {
                confirmed = await showCustomConfirm('SECOND AND FINAL CONFIRMATION: Really proceed with factory reset? There is no going back.', 'Final Confirmation');
                if (confirmed) {
                    fetch('/api/factory_reset', { method: 'POST' })
                    .then(response => response.json().then(data => ({ ok: response.ok, data })))
                    .then(({ ok, data }) => {
                        if (!ok || !data.success) throw new Error(data.message || 'Factory reset failed');
                        showGlobalNotification('Factory reset complete. The application will attempt to reload.', 'success', 8000);
                        setTimeout(() => window.location.reload(), 3000);
                    }).catch(error => {
                        console.error('Factory reset error:', error);
                        showGlobalNotification('Error: ' + error.message, 'error');
                    });
                } else {
                     showGlobalNotification("Factory reset cancelled (second confirmation).", "info");
                }
            } else {
                showGlobalNotification("Factory reset cancelled.", "info");
            }
        });
    }
    if (deleteAllSongsBtn) {
        deleteAllSongsBtn.addEventListener('click', async function() {
            const confirmed = await showCustomConfirm('Are you sure you want to delete ALL songs and their associated audio files? This will also empty all setlists. This action is IRREVERSIBLE.', 'Confirm Delete All Songs');
            if (confirmed) {
                fetch('/api/songs', { method: 'DELETE' })
                .then(response => response.json().then(data => ({ ok: response.ok, data })))
                .then(({ ok, data }) => {
                    if (!ok || !data.success) throw new Error(data.message || 'Delete all songs failed');
                    showGlobalNotification('All songs and associated audio files have been deleted.', 'success');
                }).catch(error => {
                    console.error('Delete all songs error:', error);
                    showGlobalNotification('Error: ' + error.message, 'error');
                });
            } else {
                showGlobalNotification("Delete all songs cancelled.", "info");
            }
        });
    }

    const sectionNavItems = document.querySelectorAll('.songs-sidebar .song-item[data-section]');
    const sections = {
        'audio-output': audioOutputSection,
        'keyboard-control': keyboardControlSection,
        'data-management': dataManagementSection,
        'danger-zone': dangerZoneSection
    };

    function switchSection(sectionId) {
        if (!sectionId || !sections[sectionId]) {
            const firstKey = Object.keys(sections).find(k => sections[k]);
            if (firstKey) {
                sectionId = firstKey;
            } else {
                console.error("No valid sections found to switch to.");
                return;
            }
        }
        sectionNavItems.forEach(nav => {
            if (nav) nav.classList.toggle('active', nav.dataset.section === sectionId);
        });
        Object.keys(sections).forEach(key => {
            if (sections[key]) {
                sections[key].style.display = (key === sectionId) ? 'block' : 'none';
            }
        });
        if (sectionId === 'audio-output') {
            loadAndDisplayAudioSettings();
        } else if (sectionId === 'keyboard-control') {
            if (typeof inputControlService !== 'undefined' && typeof inputControlService.initSettingsUI === 'function') {
                inputControlService.initSettingsUI();
            } else {
                console.warn("inputControlService or initSettingsUI not found for keyboard-control section.");
            }
        } else if (sectionId === 'data-management') {
            loadAudioDirectorySetting();
        }
    }

    const initialActiveNavItem = document.querySelector('.songs-sidebar .song-item.active[data-section]');
    let initialSectionId = null;
    if (initialActiveNavItem) {
        initialSectionId = initialActiveNavItem.dataset.section;
    } else if (sectionNavItems.length > 0 && sectionNavItems[0]) {
        initialSectionId = sectionNavItems[0].dataset.section;
        sectionNavItems[0].classList.add('active');
    }

    if (initialSectionId) {
        switchSection(initialSectionId);
    } else {
        Object.values(sections).forEach(sectionEl => { if (sectionEl) sectionEl.style.display = 'none'; });
        console.warn("No initial section could be determined for settings page.");
    }

    sectionNavItems.forEach(item => {
        if (item && !item.hasAttribute('data-listener-added')) {
            item.addEventListener('click', function() {
                switchSection(this.dataset.section);
            });
            item.setAttribute('data-listener-added', 'true');
        }
    });

});

if (typeof window.showCustomConfirm !== 'function') {
    console.warn("settings.js: window.showCustomConfirm is not defined. Using native confirm fallback.");
    window.showCustomConfirm = function(message, title = 'Confirm Action') {
        const fullMessage = title ? (title + '\n' + message) : message;
        return Promise.resolve(window.confirm(fullMessage));
    };
}
