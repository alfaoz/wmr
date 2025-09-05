function formatEventTimeWithOffset(event) {
    if (!event.start) return '';

    // Apply time offset if applicable
    const offsetEvent = applyTimeOffset(event);

    const options = { hour: '2-digit', minute: '2-digit', hour12: false };
    const startTimeStr = offsetEvent.start.toLocaleTimeString('en-GB', options);
    
    // Build time range string (start-end if end time available)
    let timeStr = startTimeStr;
    if (offsetEvent.end) {
        const endTimeStr = offsetEvent.end.toLocaleTimeString('en-GB', options);
        timeStr = `${startTimeStr}-${endTimeStr}`;
    }

    // Show if time was offset
    if (shouldApplyTimeOffset(event)) {
        const settings = getTimeOffsetSettings();
        if (settings.startOffset !== 0 || settings.endOffset !== 0) {
            const offsetParts = [];
            if (settings.startOffset !== 0) {
                const offsetStr = settings.startOffset > 0 ? `+${settings.startOffset}` : `${settings.startOffset}`;
                offsetParts.push(`${offsetStr}m`);
            }
            if (settings.endOffset !== 0 && event.end) {
                const offsetStr = settings.endOffset > 0 ? `+${settings.endOffset}` : `${settings.endOffset}`;
                offsetParts.push(`${offsetStr}m`);
            }
            if (offsetParts.length > 0) {
                return `${timeStr} (${offsetParts.join(' ')})`;
            }
        }
    }

    return timeStr;
}

function isExamEvent(event) {
    if (!event.summary) return false;

    // Get highlight keywords from settings
    const savedKeywords = getCookie('highlightKeywords');
    let keywords = ['exam', 'test', 'midterm', 'final']; // default

    if (savedKeywords) {
        try {
            keywords = JSON.parse(savedKeywords);
        } catch (e) {
            console.error('Error parsing highlight keywords:', e);
        }
    }

    const summary = event.summary.toLowerCase();
    return keywords.some(keyword => summary.includes(keyword.toLowerCase()));
}

function togglePatternSection(sectionId) {
    const section = document.getElementById(sectionId);
    const header = section.previousElementSibling;

    if (section.classList.contains('collapsed')) {
        section.classList.remove('collapsed');
        section.style.maxHeight = section.scrollHeight + 'px';
        if (header) header.classList.remove('collapsed');
    } else {
        section.classList.add('collapsed');
        section.style.maxHeight = '0px';
        if (header) header.classList.add('collapsed');
    }
}

function toggleExpand(listId, button) {
    const list = document.getElementById(listId);
    if (list.classList.contains('collapsed')) {
        list.classList.remove('collapsed');
        button.textContent = '[ collapse ]';
    } else {
        list.classList.add('collapsed');
        button.textContent = '[ expand ]';
    }
}

// Global variable to track the current day for day change detection
let currentDay = new Date().toDateString();

// Enhanced day change detection
function setupDayChangeDetection() {
    // Set up a timer to check for day changes every minute
    setInterval(() => {
        const now = new Date();
        const todayString = now.toDateString();

        if (currentDay !== todayString) {
            console.log('Day boundary crossed! Force refreshing calendar view...');
            currentDay = todayString;

            if (currentPatterns) {
                // Force a complete refresh of the display
                displayResults(currentPatterns);

                // Also refresh event statuses
                setTimeout(() => {
                    refreshEventStatuses();
                }, 200);
            }
        }
    }, 60000); // Check every minute

    // Also set up a specific timer for midnight
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const msUntilMidnight = tomorrow.getTime() - now.getTime();

    setTimeout(() => {
        console.log('Midnight refresh triggered!');
        if (currentPatterns) {
            displayResults(currentPatterns);
            refreshEventStatuses();
        }

        // Set up daily midnight refresh
        setInterval(() => {
            console.log('Daily midnight refresh triggered!');
            if (currentPatterns) {
                displayResults(currentPatterns);
                refreshEventStatuses();
            }
        }, 24 * 60 * 60 * 1000); // Every 24 hours

    }, msUntilMidnight);
}

// Make functions globally available
if (typeof window !== 'undefined') {
    window.formatEventTimeWithOffset = formatEventTimeWithOffset;
    window.isExamEvent = isExamEvent;
    window.togglePatternSection = togglePatternSection;
    window.toggleExpand = toggleExpand;
    window.setupDayChangeDetection = setupDayChangeDetection;
}
