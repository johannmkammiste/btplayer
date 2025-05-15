class InputControlService {
    constructor() {
        this.settings = {
            enabled: false,
            shortcuts: {},
        };
        this.isLearning = false;
        this.actionToLearn = null;
        this.statusIndicator = null;
        this.saveStatusElement = null;

        this._handleKeyDown = this._handleKeyDown.bind(this);
        this.saveSettings = this.saveSettings.bind(this);
        this.toggleEnabled = this.toggleEnabled.bind(this);
        this.startLearning = this.startLearning.bind(this);
    }

    _notify(message, type = 'info', duration = 4000) {
        if (typeof window.showGlobalNotification === 'function') {
            window.showGlobalNotification(message, type, duration);
        } else {
            console.warn('input-control.js: window.showGlobalNotification not found. Using alert.');
            alert('[' + type.toUpperCase() + '] ' + message);
        }
    }

    async loadSettings() {
        try {
            const response = await fetch('/api/settings/keyboard');
            if (!response.ok) {
                throw new Error('HTTP error! status: ' + response.status);
            }
            const loadedSettings = await response.json();
            this.settings.enabled = loadedSettings.enabled ?? false;
            this.settings.shortcuts = loadedSettings.shortcuts || {};
            this.setupKeyListener();
            this.updateStatusIndicator();

            if (document.getElementById('settings-editor')) {
                this._updateSettingsDisplay();
            }

        } catch (error) {
            console.error('Error loading keyboard settings:', error);
            this._notify('Error loading keyboard settings: ' + error.message, 'error');
            this.settings.enabled = false;
            this.settings.shortcuts = {};
            this.setupKeyListener();
            this.updateStatusIndicator();
             if (document.getElementById('settings-editor')) {
                this._updateSettingsDisplay();
            }
        }
    }

    async saveSettings() {
        const payload = {
             enabled: this.settings.enabled,
             shortcuts: this.settings.shortcuts
        };
        if (this.saveStatusElement) this.saveStatusElement.textContent = 'Saving...';

        try {
            const response = await fetch('/api/settings/keyboard', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', },
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                 const errorData = await response.json().catch(() => ({ error: 'Unknown server error' }));
                 throw new Error(errorData.error || 'HTTP error! status: ' + response.status);
            }
            await response.json();
            if (this.saveStatusElement) {
                this.saveStatusElement.textContent = 'Saved!';
                this.saveStatusElement.className = 'save-status setting-status-message success active';
                setTimeout(() => {
                    if(this.saveStatusElement) {
                        this.saveStatusElement.textContent = '';
                        this.saveStatusElement.classList.remove('active', 'success');
                    }
                }, 3000);
            }
        } catch (error) {
            console.error('Error saving keyboard settings:', error);
            this._notify('Error saving keyboard settings: ' + error.message, 'error');
            if (this.saveStatusElement) {
                this.saveStatusElement.textContent = 'Error: ' + error.message;
                this.saveStatusElement.className = 'save-status setting-status-message error active';
            }
        }
    }

    setupKeyListener() {
        document.removeEventListener('keydown', this._handleKeyDown);
        if (this.settings.enabled) {
            document.addEventListener('keydown', this._handleKeyDown);
        }
        this.updateStatusIndicator();
    }

    _handleKeyDown(event) {
        const targetTagName = event.target.tagName.toLowerCase();
        if (['input', 'textarea', 'select'].includes(targetTagName) && !event.target.classList.contains('learn-keyboard-btn')) {
            return;
        }

        let isBoundKey = false;

        if (this.isLearning) {
            event.preventDefault(); event.stopPropagation();
            this._assignShortcut(event);
            isBoundKey = true;
            return;
        }

        if (!this.settings.enabled) return;

        for (const [action, keyBinding] of Object.entries(this.settings.shortcuts)) {
            if (this._compareKeys(event, keyBinding)) {
                 isBoundKey = true;
                 this._dispatchAction(action);
                 break;
            }
        }
        if (isBoundKey) event.preventDefault();
    }

    _compareKeys(event, keyBinding) {
        if (!keyBinding) return false;
        if (keyBinding.startsWith('Key') || keyBinding.startsWith('Digit') || keyBinding.startsWith('Numpad')) {
            return event.code === keyBinding;
        }
        return event.key === keyBinding;
    }

    _dispatchAction(action) {
        const playBtn = document.getElementById('play-btn');
        const stopBtn = document.getElementById('stop-btn');
        const prevBtn = document.getElementById('previous-btn');
        const nextBtn = document.getElementById('next-btn');

        try {
            switch (action) {
                case 'play_pause': if (playBtn) playBtn.click(); break;
                case 'stop':       if (stopBtn) stopBtn.click(); break;
                case 'next':       if (nextBtn) nextBtn.click(); break;
                case 'previous':   if (prevBtn) prevBtn.click(); break;
                default: console.warn('Unhandled keyboard action: ' + action);
            }
        } catch (error) {
            console.error("Error executing action '" + action + "':", error);
        }
    }

    initSettingsUI() {
        this.statusIndicator = document.getElementById('keyboard-status');
        this.saveStatusElement = document.getElementById('keyboard-save-status');

        this.loadSettings().then(() => {
            const enabledCheckbox = document.getElementById('keyboard-enabled');
            if (enabledCheckbox) {
                enabledCheckbox.checked = this.settings.enabled;
                enabledCheckbox.removeEventListener('change', this.toggleEnabled);
                enabledCheckbox.addEventListener('change', this.toggleEnabled);
            }
             document.querySelectorAll('.learn-keyboard-btn').forEach(button => {
                const action = button.dataset.action;
                if (action) {
                     button.removeEventListener('click', this.startLearning);
                     button.addEventListener('click', () => this.startLearning(action));
                 }
            });
        });
    }

    toggleEnabled(event) {
        this.settings.enabled = event.target.checked;
        this.setupKeyListener();
        this.saveSettings();
        this.updateStatusIndicator();
    }

    _updateSettingsDisplay() {
         for (const [action, keyBinding] of Object.entries(this.settings.shortcuts)) {
            const displayElement = document.getElementById('shortcut-' + action + '-display');
            if (displayElement) {
                displayElement.textContent = this.formatKeyForDisplay(keyBinding) || 'Not Set';
            }
            const learnButton = document.querySelector('.learn-keyboard-btn[data-action="' + action + '"]');
             if (learnButton) {
                 if (this.isLearning && this.actionToLearn === action) {
                     learnButton.textContent = 'Press Key...';
                     learnButton.classList.add('learning');
                 } else {
                     learnButton.textContent = 'Learn';
                     learnButton.classList.remove('learning');
                 }
             }
         }
         this.updateStatusIndicator();
    }

    formatKeyForDisplay(keyBinding) {
        if (!keyBinding) return '';
        if (keyBinding === " ") return "Space";
        if (keyBinding.startsWith('Key')) return keyBinding.substring(3);
        if (keyBinding.startsWith('Digit')) return keyBinding.substring(5);
        if (keyBinding.startsWith('Numpad')) return 'Numpad ' + keyBinding.substring(6);
        return keyBinding;
    }

    startLearning(action) {
        if (this.isLearning) this.stopLearning(false);
        this.isLearning = true;
        this.actionToLearn = action;
        this._updateSettingsDisplay();
        document.body.classList.add('is-learning-shortcut');
        const learnButton = document.querySelector('.learn-keyboard-btn[data-action="' + action + '"]');
        if(learnButton) learnButton.focus();
    }

    stopLearning(save = true) {
        this.isLearning = false;
        this.actionToLearn = null;
        document.body.classList.remove('is-learning-shortcut');
        if(save) this.saveSettings();
        this._updateSettingsDisplay();
    }

    _assignShortcut(event) {
        let keyBinding;
        if (event.code.startsWith('Key') || event.code.startsWith('Digit') || event.code.startsWith('Numpad')) {
            keyBinding = event.code;
        } else {
            keyBinding = event.key;
        }

        if (['Control', 'Alt', 'Meta'].includes(keyBinding)) {
             this._notify("Modifier keys (Ctrl, Alt, Meta) cannot be assigned as shortcuts directly.", "warning");
             this.stopLearning(false);
             return;
        }
        if (event.code === "Tab") {
            this._notify("Tab key cannot be assigned as a shortcut.", "warning");
            this.stopLearning(false);
            return;
        }

        this.settings.shortcuts[this.actionToLearn] = keyBinding;
        this.stopLearning(true);
    }

     updateStatusIndicator() {
         if (!this.statusIndicator) this.statusIndicator = document.getElementById('keyboard-status');
         if (this.statusIndicator) {
             this.statusIndicator.textContent = 'Keyboard: ' + (this.settings.enabled ? 'Active' : 'Inactive');
             this.statusIndicator.className = 'status-indicator ' + (this.settings.enabled ? 'status-enabled' : 'status-disabled');
         }
     }
}

const inputControlService = new InputControlService();
inputControlService.loadSettings();
