export function initClock() {
    function updateClock() {
        const h = document.getElementById("clockHour");
        const m = document.getElementById("clockMinute");
        const p = document.getElementById("clockPeriod");

        if (!h || !m || !p) return;

        const now = new Date();
        const hours = now.getHours();
        const minutes = String(now.getMinutes()).padStart(2, "0");
        const period = hours >= 12 ? "PM" : "AM";
        const hour12 = hours % 12 || 12;

        h.textContent = String(hour12).padStart(2, "0");
        m.textContent = minutes;
        p.textContent = period;
    }

    // Run immediately
    updateClock();

    // Ensure it runs after DOM is ready
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", updateClock);
    }

    // Keep ticking every second
    setInterval(updateClock, 1000);
}