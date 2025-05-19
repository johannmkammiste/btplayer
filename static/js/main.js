document.addEventListener('DOMContentLoaded', function () {
    const currentPath = window.location.pathname;
    const navLinks = document.querySelectorAll('.sidebar .songs-list .song-item a, .sidebar .setlists-list .setlist-item a, .sidebar .nav-link');

    navLinks.forEach(link => {
        const linkPath = link.getAttribute('href');
        if (!linkPath) return;

        const isActive = (linkPath === currentPath || (linkPath !== '/' && currentPath.startsWith(linkPath + '/')) || (linkPath !== '/' && currentPath === linkPath));

        if (isActive) {
            let moreSpecificActive = false;
            navLinks.forEach(otherLink => {
                const otherPath = otherLink.getAttribute('href');
                if (otherPath && otherPath !== linkPath && currentPath.startsWith(otherPath) && otherPath.length > linkPath.length) {
                    const isOtherActive = (otherPath === currentPath || (otherPath !== '/' && currentPath.startsWith(otherPath + '/')));
                    if (isOtherActive) moreSpecificActive = true;
                }
            });

            if (!moreSpecificActive) {
                link.classList.add('active');
                if (link.closest('.song-item')) link.closest('.song-item').classList.add('active');
                if (link.closest('.setlist-item')) link.closest('.setlist-item').classList.add('active');
            } else {
                link.classList.remove('active');
                if (link.closest('.song-item')) link.closest('.song-item').classList.remove('active');
                if (link.closest('.setlist-item')) link.closest('.setlist-item').classList.remove('active');
            }
        } else {
            // Remove active class if not active
            link.classList.remove('active');
            if (link.closest('.song-item')) link.closest('.song-item').classList.remove('active');
            if (link.closest('.setlist-item')) link.closest('.setlist-item').classList.remove('active');
        }
    });

    const historyBackBtn = document.getElementById('history-back-btn');
    const historyForwardBtn = document.getElementById('history-forward-btn');
    const clockDisplay = document.getElementById('real-time-clock');

    // History Back Button
    if (historyBackBtn) {
        historyBackBtn.addEventListener('click', () => {
            window.history.back();
        });
    }

    // History Forward Button
    if (historyForwardBtn) {
        historyForwardBtn.addEventListener('click', () => {
            window.history.forward();
        });
    }

    window.addEventListener('popstate', () => {
    });

    // Real-time Clock Update Function
    function updateClock() {
        if (!clockDisplay) return;

        const now = new Date();
        let timeString;
        try {
            // Format time as HH:MM (24-hour)
            timeString = now.toLocaleTimeString('et-EE', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
        } catch (e) {
            console.warn("Could not format time using 'et-EE' locale, using fallback.");
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            timeString = hours + ':' + minutes;
        }
        clockDisplay.textContent = timeString;
    }

    if (clockDisplay) {
        updateClock(); //
        setInterval(updateClock, 30000); // Update every (30 seconds)
    }

    const exitAppBtn = document.getElementById('exit-app-btn');
    if (exitAppBtn) {
        exitAppBtn.addEventListener('click', async () => {
            // Read the KIOSK_MODE set by the template
            const isKioskMode = window.APP_CONFIG && window.APP_CONFIG.KIOSK_MODE === true;

            const confirmMessage = isKioskMode ?
                'Are you sure you want to exit the Kiosk application? This will stop the player and attempt to close the display.' :
                'Are you sure you want to exit the Backing Track Player?';
            const confirmTitle = isKioskMode ? 'Confirm Exit Kiosk' : 'Confirm Exit Application';

            const confirmed = await window.showCustomConfirm(confirmMessage, confirmTitle);

            if (confirmed) {
                exitAppBtn.disabled = true;
                exitAppBtn.textContent = 'Exiting...';

                if (isKioskMode) {
                    // --- KIOSK MODE EXIT LOGIC ---
                    // This calls the API endpoint that shuts down the Python backend.
                    // The start_chromium_scaled.sh script should then detect backend unavailability
                    // and kill Chromium, leading to X session termination.
                    try {
                        const response = await fetch('/api/application/quit', { method: 'POST' });
                        const result = await response.json();
                        if (response.ok && result.success) {
                            window.showGlobalNotification(result.message || 'Backend shutdown initiated. Closing Kiosk...', 'info', 10000);
                            document.body.innerHTML = "<div style='font-size:1.5em; color:white; text-align:center; padding: 50px; line-height:1.5;'>Kiosk application is shutting down.<br>The display should close automatically shortly.<br>If not, please wait a few moments.</div>";
                        } else {
                            throw new Error(result.error || 'Failed to initiate backend shutdown (Kiosk).');
                        }
                    } catch (error) {
                        console.error("Error calling application quit API (Kiosk Mode):", error);
                        window.showGlobalNotification('Exit Kiosk Error: ' + error.message, 'error');
                        exitAppBtn.disabled = false;
                        exitAppBtn.textContent = 'EXIT KIOSK'; // Reset text
                    }
                } else {
                    // --- NON-KIOSK MODE (PYWEBVIEW) EXIT LOGIC ---
                    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.quit === 'function') {
                        try {
                            window.showGlobalNotification('Exiting application...', 'info', 2000);
                            window.pywebview.api.quit(); // Calls Python Api.quit() in run.py
                        } catch (error) {
                            console.error("Error calling pywebview.api.quit:", error);
                            window.showGlobalNotification('Could not exit application cleanly. Please close the window manually.', 'error');
                            exitAppBtn.disabled = false;
                            exitAppBtn.textContent = 'EXIT APPLICATION'; // Reset text
                        }
                    } else {
                        // Fallback if pywebview is not available (shouldn't happen if run.py is used for non-kiosk)
                        window.showGlobalNotification('Standard exit mechanism (pywebview) not available. Please close the window manually.', 'warning');
                        exitAppBtn.disabled = false;
                        exitAppBtn.textContent = 'EXIT APPLICATION'; // Reset text
                        // As a last resort, you could try window.close(), but it's often blocked.
                        // window.close();
                    }
                }
            } else {
                 // User cancelled the confirmation
                 window.showGlobalNotification('Exit cancelled.', 'info');
            }
        });
    }

    const rebootSystemBtn = document.getElementById('reboot-system-btn');
    if (rebootSystemBtn) {
        rebootSystemBtn.addEventListener('click', async () => {
            const confirmed = await window.showCustomConfirm(
                'Are you sure you want to reboot the system? All unsaved work will be lost.',
                'Confirm System Reboot'
            );
            if (confirmed) {
                rebootSystemBtn.disabled = true;
                rebootSystemBtn.textContent = 'Rebooting...';
                try {
                    const response = await fetch('/api/system/reboot', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                    const result = await response.json();
                    if (response.ok && result.success) {
                        window.showGlobalNotification(result.message || 'System is rebooting...', 'success', 10000);
                    } else {
                        throw new Error(result.error || 'Failed to initiate reboot.');
                    }
                } catch (error) {
                    console.error("Error calling system reboot API:", error);
                    window.showGlobalNotification('Reboot Error: ' + error.message, 'error');
                    rebootSystemBtn.disabled = false; // Re-enable button on error
                    rebootSystemBtn.textContent = 'REBOOT SYSTEM'; // Reset text
                }
            } else {
                window.showGlobalNotification('System reboot cancelled.', 'info');
            }
        });
    }

    const shutdownSystemBtn = document.getElementById('shutdown-system-btn');
    if (shutdownSystemBtn) {
        shutdownSystemBtn.addEventListener('click', async () => {
            const confirmed = await window.showCustomConfirm(
                'Are you sure you want to shutdown the system? All unsaved work will be lost.',
                'Confirm System Shutdown'
            );
            if (confirmed) {
                shutdownSystemBtn.disabled = true;
                shutdownSystemBtn.textContent = 'Shutting down...';
                try {
                    const response = await fetch('/api/system/shutdown', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                    const result = await response.json();
                    if (response.ok && result.success) {
                        window.showGlobalNotification(result.message || 'System is shutting down...', 'success', 10000);
                    } else {
                        throw new Error(result.error || 'Failed to initiate shutdown.');
                    }
                } catch (error) {
                    console.error("Error calling system shutdown API:", error);
                    window.showGlobalNotification('Shutdown Error: ' + error.message, 'error');
                    shutdownSystemBtn().disabled = false; // Re-enable button on error
                    shutdownSystemBtn.textContent = 'SHUTDOWN SYSTEM'; //
                }
            } else {
                window.showGlobalNotification('System shutdown cancelled.', 'info');
            }
        });
    }

});


// Global Notification Helper Function
window.showGlobalNotification = function (message, type = 'info', duration = 4000) {
    const container = document.getElementById('notification-container');
    if (!container) {
        console.error('Notification container not found. Falling back to alert.');
        alert(type.toUpperCase() + ': ' + message); // Fallback
        return;
    }

    const notification = document.createElement('div');
    notification.className = 'notification-item ' + type;
    notification.textContent = message;
    let timer;

    const dismiss = () => {
        notification.classList.add('fade-out');
        setTimeout(() => {
            if (notification.parentNode === container) {
                container.removeChild(notification);
            }
        }, 500);
    };

    notification.addEventListener('click', () => {
        clearTimeout(timer);
        dismiss();
    });

    container.prepend(notification);

    timer = setTimeout(dismiss, duration);

    notification.addEventListener('mouseover', () => {
        clearTimeout(timer);
        notification.classList.remove('fade-out');
    });

    notification.addEventListener('mouseleave', () => {
        timer = setTimeout(dismiss, duration / 1.5);
    });
};


let globalConfirmResolve = null;
window.showCustomConfirm = function (message, title = 'Confirm Action') {
    return new Promise((resolve) => {
        globalConfirmResolve = resolve; // Store the resolve function globally for this instance

        const modal = document.getElementById('custom-confirm-modal');
        const titleEl = document.getElementById('custom-confirm-title');
        const messageEl = document.getElementById('custom-confirm-message');
        const btnYes = document.getElementById('custom-confirm-btn-yes');
        const btnNo = document.getElementById('custom-confirm-btn-no');

        if (!modal || !titleEl || !messageEl || !btnYes || !btnNo) {
            console.error('Custom confirm modal elements not found. Falling back to native confirm.');
            if (window.confirm(title + '\n' + message)) {
                resolve(true);
            } else {
                resolve(false);
            }
            return;
        }

        titleEl.textContent = title;
        messageEl.textContent = message;
        modal.style.display = 'flex';

        const yesHandler = () => {
            modal.style.display = 'none';
            if (globalConfirmResolve) globalConfirmResolve(true);
            cleanupGlobalConfirmHandlers();
        };

        const noHandler = () => {
            modal.style.display = 'none';
            if (globalConfirmResolve) globalConfirmResolve(false);
            cleanupGlobalConfirmHandlers();
        };

        const newBtnYes = btnYes.cloneNode(true);
        btnYes.parentNode.replaceChild(newBtnYes, btnYes);

        const newBtnNo = btnNo.cloneNode(true);
        btnNo.parentNode.replaceChild(newBtnNo, btnNo);

        newBtnYes.addEventListener('click', yesHandler);
        newBtnNo.addEventListener('click', noHandler);
    });
};

function cleanupGlobalConfirmHandlers() {
    globalConfirmResolve = null;
}
