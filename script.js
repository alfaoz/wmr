// Global variables for auto-refresh functionality
let autoRefreshInterval = null;
let lastCalendarHash = '';
let currentPatterns = null;
let timeUpdateInterval = null;
let showNoChangesNotification = false; // Track whether to show "no changes" notifications

// Wait for DOM to be ready before initializing
document.addEventListener('DOMContentLoaded', function() {
    // Display current date
    const today = new Date();
    const currentDateElement = document.getElementById('currentDate');
    if (currentDateElement) {
        currentDateElement.textContent = `today: ${today.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`;
    }
    
    // Initialize day change detection
    if (typeof setupDayChangeDetection === 'function') {
        setupDayChangeDetection();
    }
});

// Simple ICS parser
    function parseICS(icsContent) {
    const events = [];
    const lines = icsContent.split(/\r?\n/);
    let currentEvent = null;

    for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Handle line folding (lines that start with space or tab)
    while (i + 1 < lines.length && (lines[i + 1].startsWith(' ') || lines[i + 1].startsWith('\t'))) {
    line += lines[i + 1].substring(1);
    i++;
}

    if (line === 'BEGIN:VEVENT') {
    currentEvent = {};
} else if (line === 'END:VEVENT' && currentEvent) {
    events.push(currentEvent);
    currentEvent = null;
} else if (currentEvent) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > -1) {
    const key = line.substring(0, colonIndex).split(';')[0];
    const value = line.substring(colonIndex + 1);

    switch(key) {
    case 'SUMMARY':
    currentEvent.summary = value;
    break;
    case 'DTSTART':
    currentEvent.start = parseDate(value);
    break;
    case 'DTEND':
    currentEvent.end = parseDate(value);
    break;
    case 'LOCATION':
    currentEvent.location = value;
    break;
    case 'DESCRIPTION':
    currentEvent.description = value;
    break;
    case 'RRULE':
    currentEvent.rrule = value;
    break;
}
}
}
}

    return events;
}

    function parseDate(dateStr) {
    // Handle both datetime and date formats
    if (dateStr.length === 8) {
    // Date only format: YYYYMMDD
    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(4, 6);
    const day = dateStr.substring(6, 8);
    return new Date(`${year}-${month}-${day}`);
} else if (dateStr.includes('T')) {
    // DateTime format: YYYYMMDDTHHMMSS or with timezone
    const datePart = dateStr.substring(0, 8);
    const timePart = dateStr.substring(9, 15);

    const year = datePart.substring(0, 4);
    const month = datePart.substring(4, 6);
    const day = datePart.substring(6, 8);
    const hour = timePart.substring(0, 2);
    const minute = timePart.substring(2, 4);
    const second = timePart.substring(4, 6);

    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
}
    return new Date(dateStr);
}

    function analyzePatterns(events) {
    const patterns = {
    byTimeSlot: {},
    byDayTime: {},
    byName: {},
    byLocation: {},
    recurring: [],
    weeklyPatterns: {},
    smartPatterns: [], // New: actual recurring patterns
    stats: {
    totalEvents: events.length,
    uniqueNames: new Set(),
    uniqueLocations: new Set(),
    dateRange: { start: null, end: null }
}
};

    events.forEach(event => {
    if (!event.start) return;

    // Update stats
    patterns.stats.uniqueNames.add(event.summary || 'Untitled');
    if (event.location) patterns.stats.uniqueLocations.add(event.location);

    if (!patterns.stats.dateRange.start || event.start < patterns.stats.dateRange.start) {
    patterns.stats.dateRange.start = event.start;
}
    if (!patterns.stats.dateRange.end || event.start > patterns.stats.dateRange.end) {
    patterns.stats.dateRange.end = event.start;
}

    // Analyze by day and time
    const day = event.start.toLocaleDateString('en-GB', { weekday: 'long' });
    const time = event.start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    const dayTimeKey = `${day} ${time}`;

    if (!patterns.byDayTime[dayTimeKey]) {
    patterns.byDayTime[dayTimeKey] = [];
}
    patterns.byDayTime[dayTimeKey].push(event);

    // Analyze by time slot only
    if (!patterns.byTimeSlot[time]) {
    patterns.byTimeSlot[time] = [];
}
    patterns.byTimeSlot[time].push(event);

    // Analyze by exact name
    const className = event.summary || 'Untitled';
    if (!patterns.byName[className]) {
    patterns.byName[className] = [];
}
    patterns.byName[className].push(event);

    // Keep the old weekly patterns for compatibility
    if (!patterns.weeklyPatterns[className]) {
    patterns.weeklyPatterns[className] = {
    times: {},
    events: []
};
}
    patterns.weeklyPatterns[className].events.push(event);
    const weekdayTime = `${day} @ ${time}`;
    if (!patterns.weeklyPatterns[className].times[weekdayTime]) {
    patterns.weeklyPatterns[className].times[weekdayTime] = 0;
}
    patterns.weeklyPatterns[className].times[weekdayTime]++;

    // Analyze by location
    if (event.location) {
    if (!patterns.byLocation[event.location]) {
    patterns.byLocation[event.location] = [];
}
    patterns.byLocation[event.location].push(event);
}

    // Check for RRULE (recurring events)
    if (event.rrule) {
    patterns.recurring.push(event);
}
});

    // NEW: Analyze smart patterns - actual weekly recurring patterns
    patterns.smartPatterns = analyzeSmartWeeklyPatterns(events);

    return patterns;
}

    // NEW: Smart weekly pattern analysis
    function analyzeSmartWeeklyPatterns(events) {
    const smartPatterns = [];

    // Filter events to next month only
    const today = new Date();
    const nextMonth = new Date(today);
    nextMonth.setMonth(today.getMonth() + 1);

    const nextMonthEvents = events.filter(event => {
    if (!event.start) return false;
    return event.start >= today && event.start <= nextMonth;
});

    // Group events by name and location (more specific grouping)
    const eventGroups = {};
    nextMonthEvents.forEach(event => {
    if (!event.start) return;

    const key = `${event.summary || 'Untitled'}|${event.location || 'No Location'}`;
    if (!eventGroups[key]) {
    eventGroups[key] = [];
}
    eventGroups[key].push(event);
});

    // Analyze each group for actual recurring patterns
    Object.entries(eventGroups).forEach(([key, groupEvents]) => {
    const [className, location] = key.split('|');

    if (groupEvents.length < 2) return; // Need at least 2 events for next month view

    // Sort events by date
    groupEvents.sort((a, b) => a.start - b.start);

    // Detect weekly recurring patterns
    const weeklyPatterns = detectWeeklyRecurrence(groupEvents, className, location);
    smartPatterns.push(...weeklyPatterns);
});

    // Sort by pattern strength (consistency and frequency)
    smartPatterns.sort((a, b) => {
    const scoreA = a.consistency * a.occurrences;
    const scoreB = b.consistency * b.occurrences;
    return scoreB - scoreA;
});

    return smartPatterns;
}

    // NEW: Detect actual weekly recurring patterns
    function detectWeeklyRecurrence(events, className, location) {
    const patterns = [];

    // Group by day of week and time
    const dayTimeGroups = {};
    events.forEach(event => {
    const dayOfWeek = event.start.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const timeKey = event.start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    const key = `${dayOfWeek}-${timeKey}`;

    if (!dayTimeGroups[key]) {
    dayTimeGroups[key] = [];
}
    dayTimeGroups[key].push(event);
});

    // Analyze each day-time combination for weekly recurrence
    Object.entries(dayTimeGroups).forEach(([key, dayTimeEvents]) => {
    if (dayTimeEvents.length < 3) return; // Need at least 3 occurrences

    const [dayOfWeek, timeKey] = key.split('-');
    const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][parseInt(dayOfWeek)];

    // Sort by date
    dayTimeEvents.sort((a, b) => a.start - b.start);

    // Check for weekly consistency
    const weeklyConsistency = calculateWeeklyConsistency(dayTimeEvents);

    if (weeklyConsistency.isWeeklyPattern) {
    patterns.push({
    className: className,
    location: location === 'No Location' ? null : location,
    dayOfWeek: dayName,
    time: timeKey,
    occurrences: dayTimeEvents.length,
    consistency: weeklyConsistency.consistency,
    frequency: weeklyConsistency.frequency,
    startDate: dayTimeEvents[0].start,
    endDate: dayTimeEvents[dayTimeEvents.length - 1].start,
    events: dayTimeEvents,
    pattern: weeklyConsistency.pattern,
    gaps: weeklyConsistency.gaps
});
}
});

    return patterns;
}

    // NEW: Calculate if events follow a weekly pattern
    function calculateWeeklyConsistency(events) {
    if (events.length < 3) {
    return { isWeeklyPattern: false, consistency: 0 };
}

    // Calculate week differences between consecutive events
    const weekDiffs = [];
    for (let i = 1; i < events.length; i++) {
    const daysDiff = (events[i].start - events[i-1].start) / (1000 * 60 * 60 * 24);
    const weeksDiff = Math.round(daysDiff / 7);
    weekDiffs.push(weeksDiff);
}

    // Count frequency of each week difference
    const diffCounts = {};
    weekDiffs.forEach(diff => {
    diffCounts[diff] = (diffCounts[diff] || 0) + 1;
});

    // Find the most common pattern
    const sortedDiffs = Object.entries(diffCounts).sort((a, b) => b[1] - a[1]);
    const mostCommonDiff = parseInt(sortedDiffs[0][0]);
    const mostCommonCount = sortedDiffs[0][1];

    // Calculate consistency percentage
    const consistency = mostCommonCount / weekDiffs.length;

    // Determine if it's a weekly pattern
    const isWeeklyPattern = mostCommonDiff >= 1 && consistency >= 0.6; // At least 60% consistent

    // Calculate actual frequency
    const totalWeeks = Math.ceil((events[events.length - 1].start - events[0].start) / (1000 * 60 * 60 * 24 * 7));
    const frequency = events.length / Math.max(totalWeeks, 1);

    // Detect gaps (weeks where the event should have occurred but didn't)
    const gaps = [];
    if (isWeeklyPattern && mostCommonDiff === 1) {
    // For weekly events, check for missing weeks
    for (let i = 1; i < events.length; i++) {
    const expectedDate = new Date(events[i-1].start);
    expectedDate.setDate(expectedDate.getDate() + 7);

    const actualDate = events[i].start;
    const daysDiff = (actualDate - expectedDate) / (1000 * 60 * 60 * 24);

    if (daysDiff > 10) { // More than 10 days difference indicates gaps
    const weeksGap = Math.round(daysDiff / 7);
    gaps.push({ after: events[i-1].start, weeks: weeksGap - 1 });
}
}
}

    let pattern = 'irregular';
    if (isWeeklyPattern) {
    if (mostCommonDiff === 1 && consistency >= 0.9) {
    pattern = 'weekly';
} else if (mostCommonDiff === 2 && consistency >= 0.8) {
    pattern = 'bi-weekly';
} else if (mostCommonDiff === 1 && consistency >= 0.6) {
    pattern = 'mostly weekly';
} else {
    pattern = `every ${mostCommonDiff} weeks`;
}
}

    return {
    isWeeklyPattern,
    consistency,
    frequency,
    pattern,
    gaps,
    mostCommonInterval: mostCommonDiff
};
}

    function getNextWeekEvents(events) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);

    const weekEvents = events.filter(event => {
    if (!event.start) return false;
    const eventDate = new Date(event.start);
    eventDate.setHours(0, 0, 0, 0);
    return eventDate >= today && eventDate < nextWeek;
}).sort((a, b) => a.start - b.start);

    // Group by day
    const byDay = {};
    weekEvents.forEach(event => {
    const dayKey = event.start.toLocaleDateString('en-GB', { weekday: 'long', month: 'short', day: 'numeric' });
    if (!byDay[dayKey]) {
    byDay[dayKey] = [];
}
    byDay[dayKey].push(event);
});

    return byDay;
}

    function formatWeeklyPattern(className, pattern) {
    const times = Object.entries(pattern.times)
    .filter(([time, count]) => count >= 2) // Only show if it happened at least twice
    .sort((a, b) => {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const dayA = days.findIndex(d => a[0].toLowerCase().includes(d));
    const dayB = days.findIndex(d => b[0].toLowerCase().includes(d));
    return dayA - dayB;
});

    if (times.length === 0) return null;

    // Get date range
    const dates = pattern.events.map(e => e.start).sort((a, b) => a - b);
    const startDate = dates[0];
    const endDate = dates[dates.length - 1];

    // Format weekly occurrences
    const weekdays = times.map(([time]) => {
    const parts = time.split(' @ ');
    return `${parts[0].toUpperCase().slice(0, 3)} @ ${parts[1]}`;
}).join(', ');

    // Determine frequency
    const weekSpan = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24 * 7));
    const frequency = pattern.events.length / Math.max(weekSpan, 1);

    let frequencyText = 'occurs ';
    if (frequency >= 0.8) {
    frequencyText += 'weekly';
} else if (frequency >= 0.4) {
    frequencyText += 'bi-weekly';
} else {
    frequencyText += 'occasionally';
}

    return {
    summary: `${className} ${frequencyText} ${weekdays} until ${endDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`,
    className,
    weekdays,
    startDate,
    endDate,
    occurrences: pattern.events.length
};
}

    function analyzeBreakSlots(dayEvents) {
    if (!dayEvents || dayEvents.length === 0) return [];

    const breaks = [];
    const sortedEvents = dayEvents.sort((a, b) => a.start - b.start);

    // Check for break before first event (if event starts after 10:00)
    const firstEvent = sortedEvents[0];
    const firstEventTime = firstEvent.start.getHours() * 60 + firstEvent.start.getMinutes();
    if (firstEventTime > 10 * 60) { // After 10:00 AM
    const breakStart = Math.max(9 * 60, firstEventTime - 90); // Start at 9 AM or 1.5h before
    const breakEnd = firstEventTime - 15; // 15 min before first event
    const duration = Math.max(0, breakEnd - breakStart); // Calculate duration in minutes

    if (duration >= 10) { // Show breaks of 10+ minutes
    breaks.push({
    start: Math.floor(breakStart / 60),
    startMin: breakStart % 60,
    end: Math.floor(breakEnd / 60),
    endMin: breakEnd % 60,
    type: 'morning break',
    duration: Math.floor(duration),
    isShort: duration < 30
});
}
}

    // Check gaps between events (lunch opportunities)
    for (let i = 0; i < sortedEvents.length - 1; i++) {
    const currentEnd = sortedEvents[i].end || sortedEvents[i].start;
    const nextStart = sortedEvents[i + 1].start;

    const gapMinutes = (nextStart - currentEnd) / (1000 * 60);

    if (gapMinutes >= 15) { // Show breaks of 15+ minutes
    const breakStartTime = new Date(currentEnd.getTime() + 10 * 60 * 1000); // 10 min after previous event
    const breakEndTime = new Date(nextStart.getTime() - 10 * 60 * 1000); // 10 min before next event

    const breakDuration = (breakEndTime - breakStartTime) / (1000 * 60);
    if (breakDuration >= 10) {
    const startHour = breakStartTime.getHours();
    const startMin = breakStartTime.getMinutes();
    const endHour = breakEndTime.getHours();
    const endMin = breakEndTime.getMinutes();

    let breakType = 'break';
    if (startHour >= 11 && startHour <= 14 && breakDuration >= 30) {
    breakType = 'lunch';
} else if (startHour >= 15 && startHour <= 17) {
    breakType = 'afternoon break';
}

    breaks.push({
    start: startHour,
    startMin: startMin,
    end: endHour,
    endMin: endMin,
    type: breakType,
    duration: Math.floor(breakDuration),
    isShort: breakDuration < 30
});
}
}
}

    // Check for break after last event (if event ends before 18:00)
    const lastEvent = sortedEvents[sortedEvents.length - 1];
    const lastEventEnd = lastEvent.end || lastEvent.start;
    const lastEventTime = lastEventEnd.getHours() * 60 + lastEventEnd.getMinutes();
    if (lastEventTime < 18 * 60) { // Before 6:00 PM
    const breakStart = lastEventTime + 10; // 10 min after last event
    const breakEnd = 18 * 60; // Until 6:00 PM
    const duration = breakEnd - breakStart;

    if (duration >= 10) { // Show breaks of 10+ minutes
    breaks.push({
    start: Math.floor(breakStart / 60),
    startMin: breakStart % 60,
    end: 18,
    endMin: 0,
    type: 'evening break',
    duration: Math.floor(duration),
    isShort: duration < 30
});
}
}

    return breaks;
}
    function getCurrentEventStatus(dayEvents) {
    if (!dayEvents || dayEvents.length === 0) return null;

    const now = new Date();
    const nowTime = now.getHours() * 60 + now.getMinutes();

    for (let i = 0; i < dayEvents.length; i++) {
    const event = dayEvents[i];
    const eventStart = event.start.getHours() * 60 + event.start.getMinutes();
    const eventEnd = event.end ? (event.end.getHours() * 60 + event.end.getMinutes()) : (eventStart + 60);

    if (nowTime >= eventStart && nowTime <= eventEnd) {
    return { event, status: 'current', indicator: '>' };
}

    if (nowTime < eventStart) {
    const timeDiff = eventStart - nowTime;
    if (timeDiff <= 30) { // Next event within 30 minutes
    return { event, status: 'upcoming', indicator: '>>', minutesUntil: timeDiff };
}
    return { event, status: 'next', indicator: '>' };
}
}

    return null;
}

    function analyzeDayPatterns(events) {
    const patterns = {
    timeSlots: {},
    breaks: [],
    currentEvent: null,
    upcomingEvent: null,
    nextEvent: null
};

    events.forEach(event => {
    if (!event.start) return;

    // Analyze time slots
    const timeSlot = event.start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    if (!patterns.timeSlots[timeSlot]) {
    patterns.timeSlots[timeSlot] = [];
}
    patterns.timeSlots[timeSlot].push(event);
});

    // Analyze breaks and current status
    const now = new Date();
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();
    const nowTime = currentHour * 60 + currentMin;

    const sortedEvents = events.sort((a, b) => a.start - b.start);
    patterns.breaks = analyzeBreakSlots(sortedEvents);

    // Determine current, upcoming, and next events
    if (sortedEvents.length > 0) {
    const firstEvent = sortedEvents[0];
    const lastEvent = sortedEvents[sortedEvents.length - 1];

    // Current event (ongoing)
    if (now >= firstEvent.start && now <= (firstEvent.end || firstEvent.start)) {
    patterns.currentEvent = firstEvent;
}

    // Upcoming event (next in the future)
    for (let i = 0; i < sortedEvents.length; i++) {
    const event = sortedEvents[i];
    const eventStart = event.start.getTime();

    if (eventStart > now.getTime()) {
    patterns.upcomingEvent = event;
    break;
}
}

    // Next event (next in the schedule, could be current or upcoming)
    if (patterns.currentEvent) {
    patterns.nextEvent = patterns.currentEvent;
} else if (patterns.upcomingEvent) {
    patterns.nextEvent = patterns.upcomingEvent;
}
}

    return patterns;
}

    function formatEventTime(event) {
    if (!event.start) return '';
    const options = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    return event.start.toLocaleTimeString('en-GB', options);
}

    function formatEventDate(event) {
    if (!event.start) return '';
    return event.start.toLocaleDateString('en-GB', { weekday: 'short', month: 'short', day: 'numeric' });
}

    function displayDailyOverview(events) {
    const container = document.getElementById('nextWeekSection');
    container.innerHTML = '';

    if (!events || events.length === 0) {
    container.innerHTML = '<p class="loading">no events found for the next 7 days.</p>';
    return;
}

    // Analyze patterns for the day
    const dayPatterns = analyzeDayPatterns(events);

    // Display current, upcoming, and next events
    const currentStatus = dayPatterns.currentEvent ? `current: ${dayPatterns.currentEvent.summary}` : '';
    const upcomingStatus = dayPatterns.upcomingEvent ? `upcoming: ${dayPatterns.upcomingEvent.summary}` : '';
    const nextStatus = dayPatterns.nextEvent ? `next: ${dayPatterns.nextEvent.summary}` : '';

    const statusHTML = `
                <div class="day-status">
                    ${currentStatus ? `<div class="status-item">${currentStatus}</div>` : ''}
                    ${upcomingStatus ? `<div class="status-item">${upcomingStatus}</div>` : ''}
                    ${nextStatus ? `<div class="status-item">${nextStatus}</div>` : ''}
                </div>
            `;

    container.innerHTML += statusHTML;

    // Display time slots
    const timeSlots = Object.entries(dayPatterns.timeSlots).sort((a, b) => a[0].localeCompare(b[0]));
    timeSlots.forEach(([time, events]) => {
    const timeLabel = document.createElement('div');
    timeLabel.className = 'time-slot';
    timeLabel.innerHTML = `<strong>${time}</strong>`;
    container.appendChild(timeLabel);

    events.forEach(event => {
    const eventDiv = document.createElement('div');
    eventDiv.className = 'day-event';
    eventDiv.innerHTML = `
                        <span class="event-time">${formatEventTime(event)}</span>
                        ${event.summary || 'Untitled'}
                        ${event.location ? ` @ ${event.location}` : ''}
                    `;
    container.appendChild(eventDiv);
});
});

    // Display breaks
    dayPatterns.breaks.forEach(b => {
    const breakDiv = document.createElement('div');
    breakDiv.className = 'day-break';
    breakDiv.innerHTML = `${b.type} (${b.start}:${b.startMin} - ${b.end}:${b.endMin})`;
    container.appendChild(breakDiv);
});
}

    function displayResults(patterns) {
    const resultsSection = document.getElementById('resultsSection');
    const statsGrid = document.getElementById('statsGrid');
    const patternsContainer = document.getElementById('patternsContainer');
    const nextWeekSection = document.getElementById('nextWeekSection');

    // Clear previous results
    statsGrid.innerHTML = '';
    patternsContainer.innerHTML = '';
    nextWeekSection.innerHTML = '';

    // Display next week overview with enhanced features
    const allEvents = Object.values(patterns.byName).flat();
    const nextWeek = getNextWeekEvents(allEvents);
    const now = new Date();
    const currentTime = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

    if (Object.keys(nextWeek).length > 0) {
    const nextWeekHTML = Object.entries(nextWeek).map(([day, events]) => {
    // Check if this is today
    const dayDate = new Date(events[0].start);
    dayDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isToday = dayDate.getTime() === today.getTime();

    // Get current event status for today
    let currentEventStatus = null;
    if (isToday) {
    currentEventStatus = getCurrentEventStatus(events);
}

    // Analyze break opportunities for this day
    const dayBreaks = analyzeBreakSlots(events);

    return `
                        <div class="day-schedule ${isToday ? 'today' : ''}">
                            <div class="day-header ${isToday ? 'today' : ''}">
                                <span>${day} ${isToday ? '<span class="today-indicator">TODAY</span>' : ''}</span>
                                <div class="day-date">
                                    <span>[${events.length} events]</span>
                                    ${isToday ? `<span class="current-time">${currentTime}</span>` : ''}
                                </div>
                            </div>
                            <div class="day-events">
    ${events.map(event => {
    let eventClass = 'day-event';
    let indicator = '';

    // Check for exam events and add exam class
    if (isExamEvent(event)) {
    eventClass += ' exam';
}

    if (isToday && currentEventStatus) {
    if (currentEventStatus.event === event) {
    eventClass += ` ${currentEventStatus.status}`;
    indicator = `<span class="event-indicator">${currentEventStatus.indicator}</span>`;

    if( currentEventStatus.minutesUntil) {
    indicator += ` <span style="font-size: 0.7rem; color: #ffaa00;">(in ${currentEventStatus.minutesUntil}min)</span>`;
}
}
}

    return `
            <div class="${eventClass}">
                ${indicator}
                <span class="event-time">${formatEventTimeWithOffset(event)}</span>
                ${event.summary || 'Untitled'}
                ${event.location ? ` @ ${event.location}` : ''}
            </div>
        `;
}).join('')}

    ${dayBreaks.map(b => {
    const startTime = `${b.start}:${b.startMin.toString().padStart(2, '0')}`;
    const endTime = `${b.end}:${b.endMin.toString().padStart(2, '0')}`;
    return `
            <div class="day-break${b.isShort ? ' short' : ''}">
                <span class="break-time">${startTime} - ${endTime}</span>
                <span class="break-type">${b.type}</span>
                (${b.duration} min)
            </div>
        `;
}).join('')}
</div>
                        </div>
                    `;
}).join('');

    nextWeekSection.innerHTML = `
                    <h2>// next 7 days</h2>
                    ${nextWeekHTML}
                `;
}

    // Display stats
    const stats = patterns.stats;
    statsGrid.innerHTML = `
                <div class="stat-card">
                    <h3>${stats.totalEvents}</h3>
                    <p>total events</p>
                </div>
                <div class="stat-card">
                    <h3>${stats.uniqueNames.size}</h3>
                    <p>unique classes</p>
                </div>
                <div class="stat-card">
                    <h3>${stats.uniqueLocations.size}</h3>
                    <p>locations</p>
                </div>
                <div class="stat-card">
                    <h3>${Object.keys(patterns.byDayTime).length}</h3>
                    <p>time patterns</p>
                </div>
            `;

    // Display smart recurring patterns with grouping and collapsible functionality
    if (patterns.smartPatterns.length > 0) {
    // Group patterns by class name
    const groupedPatterns = {};
    patterns.smartPatterns.forEach(pattern => {
    if (!groupedPatterns[pattern.className]) {
    groupedPatterns[pattern.className] = [];
}
    groupedPatterns[pattern.className].push(pattern);
});

    const today = new Date();
    const nextMonth = new Date(today);
    nextMonth.setMonth(today.getMonth() + 1);

    const smartPatternsHTML = `
                    <div class="pattern-card">
                        <h2 onclick="togglePatternSection('smartPatterns')">// recurring patterns (next month)</h2>
                        <div class="pattern-content" id="smartPatterns">
                            ${Object.entries(groupedPatterns).map(([className, classPatterns]) => `
                                <div class="pattern-summary">
                                    <div class="pattern-class-name">${className}</div>
                                    ${classPatterns.map(pattern => {
    const consistencyPercent = Math.round(pattern.consistency * 100);
    const gapsText = pattern.gaps.length > 0 ? ` (${pattern.gaps.length} gaps)` : '';

    return `
                                            <div class="pattern-schedule">
                                                <span class="pattern-weekdays">${pattern.dayOfWeek.toUpperCase().slice(0, 3)} @ ${pattern.time}</span>
                                                - ${pattern.pattern} (${consistencyPercent}% consistent)${gapsText}
                                                ${pattern.location ? ` @ ${pattern.location}` : ''}
                                                <div class="pattern-dates">
                                                    ${pattern.startDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                    →
                                                    ${pattern.endDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                    [${pattern.occurrences}x]
                                                </div>
                                            </div>
                                        `;
}).join('')}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
    patternsContainer.innerHTML += smartPatternsHTML;
}

    // Display recurring patterns (by day and time) with collapsible functionality
    const recurringPatterns = Object.entries(patterns.byDayTime)
    .filter(([key, events]) => events.length > 1)
    .sort((a, b) => b[1].length - a[1].length);

    if (recurringPatterns.length > 0) {
    const recurringHTML = `
                    <div class="pattern-card">
                        <h2 onclick="togglePatternSection('recurringSlots')" class="collapsed">// recurring time slots</h2>
                        <div class="pattern-content collapsed" id="recurringSlots" style="max-height: 0px;">
                            ${recurringPatterns.map(([dayTime, events], index) => {
    const groupId = `recurring-${index}`;
    const showExpand = events.length > 5;
    return `
                                <div class="pattern-group">
                                    <h3>${dayTime} <span class="badge badge-frequency">[${events.length}x]</span></h3>
                                    <ul class="event-list ${showExpand ? 'collapsed' : ''}" id="${groupId}">
                                        ${events.map(event => `
                                            <li class="event-item">
                                                <span class="event-date">${event.start.toLocaleDateString('en-GB')}</span>
                                                ${event.summary || 'Untitled'}
                                                ${event.location ? `<span class="badge badge-location">${event.location}</span>` : ''}
                                            </li>
                                        `).join('')}
                                    </ul>
                                    ${showExpand ? `<button class="expand-button" onclick="toggleExpand('${groupId}', this)">[ expand ]</button>` : ''}
                                </div>
                            `;
}).join('')}
                        </div>
                    </div>
                `;
    patternsContainer.innerHTML += recurringHTML;
}

    // Show results section
    resultsSection.style.display = 'block';
}

    function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = `[error] ${message}`;
    errorDiv.style.display = 'block';
    setTimeout(() => {
    errorDiv.style.display = 'none';
}, 5000);
}

    // Cookie handling functions - FIXED
    function setCookie(name, value, days) {
    let expires = "";
    if (days) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    expires = "; expires=" + date.toUTCString();
}
    document.cookie = name + "=" + (value || "") + expires + "; path=/; SameSite=Lax";
}

    function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length, c.length));
}
    return null;
}

    function deleteCookie(name) {
    document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
}

    // Status message handling
    function showStatus(message, type, isAutoLoad = false) {
    const statusDiv = document.getElementById('statusMessage');
    statusDiv.className = `status-message ${type}`;
    statusDiv.style.display = 'block';

    if (isAutoLoad && type === 'success') {
    statusDiv.textContent = `auto-loaded from saved url: ${message}`;
} else {
    statusDiv.textContent = message;
}

    setTimeout(() => {
    statusDiv.style.display = 'none';
}, 5000);
}

    // URL fetch handler
    async function fetchFromURL(isAutoLoad = false) {
    const urlInput = document.getElementById('urlInput');
    let url = urlInput.value.trim();

    if (!url) {
    showError('enter the link first!');
    return;
}

    // Convert webcal:// to https://
    if (url.startsWith('webcal://')) {
    url = url.replace('webcal://', 'https://');
    urlInput.value = url; // Update the input to show the converted URL
}

    // Show loading status
    if (isAutoLoad) {
    showStatus('auto-loading saved calendar...', 'info');
} else {
    showStatus('fetching calendar...', 'loading');
}

    try {
    // Try to fetch through a CORS proxy
    const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(url)}`;
    const response = await fetch(proxyUrl);

    if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
}

    const content = await response.text();

    // Process the calendar content
    processICSContent(content);

    // Save URL to cookie (only if it's a manual fetch, not auto-load)
    if (!isAutoLoad) {
    setCookie('calendarURL', url, 365); // Save for 30 days
}

    // Show success message
    const truncatedUrl = url.length > 50 ? url.substring(0, 50) + '...' : url;
    showStatus(`calendar loaded successfully! (${truncatedUrl})`, 'success', isAutoLoad);

} catch (error) {
    showStatus('✗ could not fetch calendar. try uploading an .ics file instead', 'error');
    console.error('Fetch error:', error);
}
}

    // File input handler
    document.getElementById('fileInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.name.match(/\.(ics|ical|ifb|icalendar)$/i)) {
    showError('please upload a valid ics file.');
    return;
}

    const reader = new FileReader();
    reader.onload = function(e) {
    processICSContent(e.target.result);
};

    reader.readAsText(file);
});

    // Auto-refresh and time update functionality
    function startAutoRefresh() {
    const indicator = document.getElementById('autoRefreshIndicator');
    indicator.className = 'auto-refresh-indicator active';
    indicator.textContent = '● auto-refresh: on';

    // Start time updates every second
    if (!timeUpdateInterval) {
    timeUpdateInterval = setInterval(updateTime, 1000);
}

    // Start calendar refresh checks every 30 seconds
    autoRefreshInterval = setInterval(async () => {
    const savedURL = getCookie('calendarURL');
    if (savedURL) {
    await checkForCalendarUpdates(savedURL);
}
}, 30 * 1000); // 30 seconds
}

    function stopAutoRefresh() {
    const indicator = document.getElementById('autoRefreshIndicator');
    indicator.className = 'auto-refresh-indicator';
    indicator.textContent = '◐ auto-refresh: off';

    if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
}
    if (timeUpdateInterval) {
    clearInterval(timeUpdateInterval);
    timeUpdateInterval = null;
}
}

    function updateTime() {
    // Update current date and time
    const now = new Date();
    document.getElementById('currentDate').textContent = `today: ${now.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`;

    // Update current time displays in today's events with seconds
    const currentTimeElements = document.querySelectorAll('.current-time');
    const currentTime = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    currentTimeElements.forEach(el => {
    el.textContent = currentTime;
});

    // Refresh today's event status if we have current patterns
    if (currentPatterns) {
    refreshEventStatuses();
}
}

    function refreshEventStatuses() {
    const allEvents = Object.values(currentPatterns.byName).flat();
    const nextWeek = getNextWeekEvents(allEvents);
    const todayEvents = Object.values(nextWeek).find(events => {
    if (!events || events.length === 0) return false;
    const dayDate = new Date(events[0].start);
    dayDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return dayDate.getTime() === today.getTime();
});

    if (todayEvents) {
    const currentEventStatus = getCurrentEventStatus(todayEvents);
    updateEventStatusDisplay(todayEvents, currentEventStatus);
}
}

    function updateEventStatusDisplay(todayEvents, currentEventStatus) {
    const dayEvents = document.querySelectorAll('.day-schedule.today .day-event');
    const now = new Date();

    dayEvents.forEach((eventEl, index) => {
    const event = todayEvents[index];
    if (!event) return;

    // Reset classes
    eventEl.className = 'day-event';

    // Check for exam events and add exam class
    if (isExamEvent(event)) {
    eventEl.classList.add('exam');
}

    // Check if event is done
    const eventEnd = event.end || new Date(event.start.getTime() + 60 * 60 * 1000); // Default 1 hour if no end time
    if (now > eventEnd) {
    eventEl.classList.add('done');
    // Update indicator to show it's done
    const indicatorEl = eventEl.querySelector('.event-indicator');
    if (indicatorEl) {
    indicatorEl.textContent = '';
} else {
    eventEl.insertAdjacentHTML('afterbegin', '<span class="event-indicator"> </span>');
}
    return;
}

    // Apply current status
    if (currentEventStatus && currentEventStatus.event === event) {
    eventEl.classList.add(currentEventStatus.status);

    let indicatorEl = eventEl.querySelector('.event-indicator');
    if (!indicatorEl) {
    eventEl.insertAdjacentHTML('afterbegin', '<span class="event-indicator"></span>');
    indicatorEl = eventEl.querySelector('.event-indicator');
}

    indicatorEl.textContent = currentEventStatus.indicator;

    // Update minutes until if applicable
    let minutesEl = eventEl.querySelector('.minutes-until');
    if (currentEventStatus.minutesUntil) {
    if (!minutesEl) {
    indicatorEl.insertAdjacentHTML('afterend', ' <span class="minutes-until" style="font-size: 0.7rem; color: #ffaa00;"></span>');
    minutesEl = eventEl.querySelector('.minutes-until');
}
    //minutesEl.textContent = `(in ${currentEventStatus.minutesUntil}min)`;
} else if (minutesEl) {
    minutesEl.remove();
}
} else {
    // Remove indicator if not current
    const indicatorEl = eventEl.querySelector('.event-indicator');
    if (indicatorEl) {
    indicatorEl.remove();
}
    const minutesEl = eventEl.querySelector('.minutes-until');
    if (minutesEl) {
    minutesEl.remove();
}
}
});
}

    async function checkForCalendarUpdates(url) {
    const indicator = document.getElementById('autoRefreshIndicator');
    indicator.className = 'auto-refresh-indicator checking';
    indicator.textContent = '◒ checking updates...';

    try {
    const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(url)}`;
    const response = await fetch(proxyUrl);

    if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
}

    const content = await response.text();

    // Debug logging with diff check instead of hash
    console.log('=== Calendar Update Check ===');
    console.log('Content length:', content.length);

    if (window.lastCalendarContent) {
    // Perform detailed diff check
    const hasChanges = performDetailedDiff(window.lastCalendarContent, content);

    if (hasChanges) {
    // Calendar has changed, refresh the display
    console.log('CHANGES DETECTED - Refreshing calendar');

    indicator.className = 'auto-refresh-indicator active';
    indicator.textContent = '↻ updating...';

    processICSContent(content);
    window.lastCalendarContent = content; // Store for next comparison

    // Show brief update notification
    showStatus('calendar updated automatically', 'success');
    showNoChangesNotification = true; // Enable "no changes" notifications after first update

    setTimeout(() => {
    indicator.className = 'auto-refresh-indicator active';
    indicator.textContent = '● auto-refresh: on';
}, 2000);
} else {
    // No changes detected
    console.log('NO CHANGES - Content is identical');
    window.lastCalendarContent = content; // Store for next comparison
    indicator.className = 'auto-refresh-indicator active';
    indicator.textContent = '● auto-refresh: on';

    // Show "no changes" notification only if we've had at least one update before
    // and only occasionally (every 5th check) to avoid spam
    if (showNoChangesNotification && Math.random() < 0.2) { // 20% chance to show notification
    console.log('Showing "no changes" notification');
    showStatus('calendar checked - no changes detected', 'info');
} else if (showNoChangesNotification) {
    console.log('No changes detected (notification suppressed)');
}
}
} else {
    // First time setting the content
    console.log('🆕 FIRST TIME - Setting initial content');
    window.lastCalendarContent = content; // Store for next comparison
    indicator.className = 'auto-refresh-indicator active';
    indicator.textContent = '● auto-refresh: on';
}
} catch (error) {
    console.error('Auto-refresh error:', error);
    indicator.className = 'auto-refresh-indicator active';
    indicator.textContent = '● auto-refresh: on';

    // Show error notification occasionally
    if (Math.random() < 0.3) { // 30% chance to show error notification
    showStatus('⚠️ auto-refresh connection issue - retrying...', 'error');
}
}
}

    // New function to perform detailed diff analysis
    function performDetailedDiff(oldContent, newContent) {
    if (oldContent === newContent) {
    console.log('📄 Content is byte-for-byte identical');
    return false;
}

    console.log('�� Content differs - analyzing changes...');

    // Split into lines for comparison
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    console.log(`Old content: ${oldLines.length} lines`);
    console.log(`New content: ${newLines.length} lines`);

    const maxLines = Math.max(oldLines.length, newLines.length);
    let differences = 0;
    let significantChanges = 0;

    // Track types of changes
    const changeTypes = {
    timestamps: 0,
    sequences: 0,
    uids: 0,
    content: 0,
    lineCount: 0
};

    for (let i = 0; i < maxLines; i++) {
    const oldLine = oldLines[i] || '';
    const newLine = newLines[i] || '';

    if (oldLine !== newLine) {
    differences++;

    // Analyze type of change
    if (oldLine.startsWith('DTSTAMP:') || newLine.startsWith('DTSTAMP:')) {
    changeTypes.timestamps++;
    console.log(`Timestamp change on line ${i + 1}:`);
    console.log(`  Old: ${oldLine}`);
    console.log(`  New: ${newLine}`);
} else if (oldLine.startsWith('SEQUENCE:') || newLine.startsWith('SEQUENCE:')) {
    changeTypes.sequences++;
    console.log(`Sequence change on line ${i + 1}:`);
    console.log(`  Old: ${oldLine}`);
    console.log(`  New: ${newLine}`);
} else if (oldLine.includes('UID:') || newLine.includes('UID:')) {
    changeTypes.uids++;
    console.log(`UID change on line ${i + 1}:`);
    console.log(`  Old: ${oldLine}`);
    console.log(`  New: ${newLine}`);
} else if (oldLine === '' && newLine !== '' || oldLine !== '' && newLine === '') {
    changeTypes.lineCount++;
    console.log(`Line count change at line ${i + 1}:`);
    console.log(`  Old: "${oldLine}"`);
    console.log(`  New: "${newLine}"`);
} else {
    changeTypes.content++;
    significantChanges++;
    console.log(`📝 Content change on line ${i + 1}:`);
    console.log(`  Old: ${oldLine}`);
    console.log(`  New: ${newLine}`);
}

    // Limit detailed output to first 10 differences
    if (differences >= 10) {
    console.log(`... and ${maxLines - i - 1} more lines to check`);
    break;
}
}
}

    // Summary
    console.log('=== CHANGE SUMMARY ===');
    console.log(`Total differences: ${differences}`);
    console.log(`Timestamp changes: ${changeTypes.timestamps}`);
    console.log(`Sequence changes: ${changeTypes.sequences}`);
    console.log(`UID changes: ${changeTypes.uids}`);
    console.log(`Line count changes: ${changeTypes.lineCount}`);
    console.log(`Significant content changes: ${changeTypes.content}`);

    // Determine if we should refresh based on significant changes
    const shouldRefresh = significantChanges > 0 || changeTypes.content > 0;

    if (!shouldRefresh && differences > 0) {
    console.log('🔍 Changes detected but appear to be metadata only (timestamps, sequences, UIDs)');
    console.log('🚫 Skipping refresh to preserve view state');
}

    return shouldRefresh;
}
    // Enhanced processICSContent to store patterns and enable auto-refresh
    function processICSContent(content) {
    try {
    const events = parseICS(content);

    if (events.length === 0) {
    showError('calendar empty');
    return;
}

    currentPatterns = analyzePatterns(events);
    displayResults(currentPatterns);

    // Immediately update event statuses (done classes, exam styling) without waiting for timer
    setTimeout(() => {
    refreshEventStatuses();
}, 100); // Very short delay to ensure DOM is ready

    // Start auto-refresh if we have a saved URL and it's not already running
    const savedURL = getCookie('calendarURL');
    if (savedURL && !autoRefreshInterval) {
    // Store initial content for comparison
    window.lastCalendarContent = content;
    startAutoRefresh();
}
} catch (error) {
    showError('error parsing calendar:' + error.message);
    console.error(error);
}
}

    // Toggle auto-refresh on indicator click
    document.addEventListener('DOMContentLoaded', function() {
    // Show mobile controls on mobile devices
    function showMobileControlsIfNeeded() {
        const isMobile = window.innerWidth <= 768;
        const mobileControls = document.querySelector('.mobile-controls');
        const desktopAutoRefresh = document.getElementById('autoRefreshIndicator');
        const desktopSettings = document.getElementById('settingsToggle');

        if (isMobile) {
            mobileControls.style.display = 'flex';
            desktopAutoRefresh.style.display = 'none';
            desktopSettings.style.display = 'none';
        } else {
            mobileControls.style.display = 'none';
            desktopAutoRefresh.style.display = 'block';
            desktopSettings.style.display = 'block';
        }
    }

    // Show mobile controls immediately
    showMobileControlsIfNeeded();

    // Handle window resize
    window.addEventListener('resize', showMobileControlsIfNeeded);

    // Set up mobile control event handlers
    const mobileAutoRefresh = document.getElementById('mobileAutoRefreshIndicator');
    const mobileSettings = document.getElementById('mobileSettingsToggle');

    if (mobileAutoRefresh) {
    mobileAutoRefresh.addEventListener('click', function() {
    if (autoRefreshInterval) {
    stopAutoRefresh();
    this.textContent = '◐ auto-refresh: off';
} else {
    const savedURL = getCookie('calendarURL');
    if (savedURL && currentPatterns) {
    startAutoRefresh();
    this.textContent = '● auto-refresh: on';
} else {
    showStatus('load a calendar first to enable auto-refresh', 'info');
}
}
});
}

    if (mobileSettings) {
    mobileSettings.addEventListener('click', function() {
    const section = document.getElementById('settingsSection');
    if (section.style.display === 'none' || section.style.display === '') {
    section.style.display = 'block';
    this.textContent = '[ hide settings ]';

    // Load current keywords into input - FIXED
    const savedKeywords = getCookie('highlightKeywords');
    if (savedKeywords) {
    try {
    const keywords = JSON.parse(savedKeywords);
    document.getElementById('keywordsInput').value = keywords.join(', ');
} catch (e) {
    console.error('Error loading keywords:', e);
    // Fallback to default
    document.getElementById('keywordsInput').value = 'exam, test, midterm, final';
}
} else {
    // Show default keywords
    document.getElementById('keywordsInput').value = 'exam, test, midterm, final';
}

    // Load current time offset settings
    const timeOffsetSettings = getTimeOffsetSettings();
    document.getElementById('timeOffsetKeywords').value = timeOffsetSettings.keywords.join(', ');
    document.getElementById('startTimeOffset').value = timeOffsetSettings.startOffset;
    document.getElementById('endTimeOffset').value = timeOffsetSettings.endOffset;

    // Smoothly scroll to the settings section
    setTimeout(() => {
    section.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
});
}, 100); // Small delay to ensure the section is visible before scrolling
} else {
    section.style.display = 'none';
    this.textContent = '[ settings ]';
}
});
}

    // Desktop indicator click handler
    const indicator = document.getElementById('autoRefreshIndicator');
    indicator.addEventListener('click', function() {
    if (autoRefreshInterval) {
    stopAutoRefresh();
} else {
    const savedURL = getCookie('calendarURL');
    if (savedURL && currentPatterns) {
    startAutoRefresh();
} else {
    showStatus('load a calendar first to enable auto-refresh', 'info');
}
}
});

    // Desktop settings toggle click handler
    const desktopSettingsToggle = document.getElementById('settingsToggle');
    if (desktopSettingsToggle) {
    desktopSettingsToggle.addEventListener('click', function() {
    const section = document.getElementById('settingsSection');
    if (section.style.display === 'none' || section.style.display === '') {
    section.style.display = 'block';
    this.textContent = '[ hide settings ]';

    // Load current keywords into input
    const savedKeywords = getCookie('highlightKeywords');
    if (savedKeywords) {
    try {
    const keywords = JSON.parse(savedKeywords);
    document.getElementById('keywordsInput').value = keywords.join(', ');
} catch (e) {
    console.error('Error loading keywords:', e);
    // Fallback to default
    document.getElementById('keywordsInput').value = 'exam, test, midterm, final';
}
} else {
    // Show default keywords
    document.getElementById('keywordsInput').value = 'exam, test, midterm, final';
}

    // Load current time offset settings
    const timeOffsetSettings = getTimeOffsetSettings();
    document.getElementById('timeOffsetKeywords').value = timeOffsetSettings.keywords.join(', ');
    document.getElementById('startTimeOffset').value = timeOffsetSettings.startOffset;
    document.getElementById('endTimeOffset').value = timeOffsetSettings.endOffset;

    // Smoothly scroll to the settings section
    setTimeout(() => {
    section.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
});
}, 100);
} else {
    section.style.display = 'none';
    this.textContent = '[ settings ]';
}
});
}
});

    // Auto-load saved URL on page load - FIXED
    window.addEventListener('load', function() {
    const savedURL = getCookie('calendarURL');
    if (savedURL) {
    document.getElementById('urlInput').value = savedURL;
    fetchFromURL(true); // Pass true to indicate this is an auto-load
}
});

    // Make functions available globally
    window.fetchFromURL = fetchFromURL;

    // Settings functionality - FIXED
    document.getElementById('saveKeywordsButton').addEventListener('click', function() {
    const keywordsInput = document.getElementById('keywordsInput');
    const keywords = keywordsInput.value.split(',').map(k => k.trim()).filter(k => k !== '');

    if (keywords.length === 0) {
    showError('please enter at least one keyword.');
    return;
}

    // Save keywords to cookie - FIXED
    setCookie('highlightKeywords', JSON.stringify(keywords), 365);
    showStatus('keywords saved! refreshing highlights...', 'success');

    // Refresh the display to apply new keywords
    if (currentPatterns) {
    setTimeout(() => {
    displayResults(currentPatterns);
    refreshEventStatuses();
}, 500);
}
});

    document.getElementById('resetKeywordsButton').addEventListener('click', function() {
    // Reset to default keywords - FIXED
    deleteCookie('highlightKeywords');
    document.getElementById('keywordsInput').value = 'exam, test, midterm, final';
    showStatus('keywords reset to default. refreshing highlights...', 'success');

    // Refresh the display to apply default keywords
    if (currentPatterns) {
    setTimeout(() => {
    displayResults(currentPatterns);
    refreshEventStatuses();
}, 500);
}
});

    // Time offset functionality
    document.getElementById('saveTimeOffsetsButton').addEventListener('click', function() {
    const offsetKeywords = document.getElementById('timeOffsetKeywords').value.split(',').map(k => k.trim()).filter(k => k !== '');
    const startOffset = parseInt(document.getElementById('startTimeOffset').value) || 0;
    const endOffset = parseInt(document.getElementById('endTimeOffset').value) || 0;

    if (offsetKeywords.length === 0) {
    showError('please enter at least one keyword for time offsets.');
    return;
}

    // Save time offset settings to cookies
    setCookie('timeOffsetKeywords', JSON.stringify(offsetKeywords), 365);
    setCookie('startTimeOffset', startOffset.toString(), 365);
    setCookie('endTimeOffset', endOffset.toString(), 365);

    showStatus('time offset settings saved! refreshing display...', 'success');

    // Refresh the display to apply new time offsets
    if (currentPatterns) {
    setTimeout(() => {
    displayResults(currentPatterns);
    refreshEventStatuses();
}, 500);
}
});

    document.getElementById('resetTimeOffsetsButton').addEventListener('click', function() {
    // Reset to default time offset settings
    deleteCookie('timeOffsetKeywords');
    deleteCookie('startTimeOffset');
    deleteCookie('endTimeOffset');

    document.getElementById('timeOffsetKeywords').value = 'lecture, seminar, class';
    document.getElementById('startTimeOffset').value = '0';
    document.getElementById('endTimeOffset').value = '-15';

    showStatus('time offset settings reset to default. refreshing display...', 'success');

    // Refresh the display to apply default settings
    if (currentPatterns) {
    setTimeout(() => {
    displayResults(currentPatterns);
    refreshEventStatuses();
}, 500);
}
});

    // Function to get current time offset settings
    function getTimeOffsetSettings() {
    const keywords = getCookie('timeOffsetKeywords');
    const startOffset = getCookie('startTimeOffset');
    const endOffset = getCookie('endTimeOffset');

    return {
    keywords: keywords ? JSON.parse(keywords) : ['lecture', 'seminar', 'class'],
    startOffset: startOffset ? parseInt(startOffset) : 0,
    endOffset: endOffset ? parseInt(endOffset) : -15
};
}

    // Function to check if event should have time offset applied
    function shouldApplyTimeOffset(event) {
    if (!event.summary) return false;
    const summary = event.summary.toLowerCase();
    const settings = getTimeOffsetSettings();
    return settings.keywords.some(keyword => summary.includes(keyword.toLowerCase()));
}

    // Function to apply time offset to event times
    function applyTimeOffset(event) {
    if (!shouldApplyTimeOffset(event)) return event;

    const settings = getTimeOffsetSettings();
    const offsetEvent = { ...event };

    // Apply start time offset
    if (offsetEvent.start && settings.startOffset !== 0) {
    offsetEvent.start = new Date(offsetEvent.start.getTime() + (settings.startOffset * 60 * 1000));
}

    // Apply end time offset
    if (offsetEvent.end && settings.endOffset !== 0) {
    offsetEvent.end = new Date(offsetEvent.end.getTime() + (settings.endOffset * 60 * 1000));
}

    return offsetEvent;
}
