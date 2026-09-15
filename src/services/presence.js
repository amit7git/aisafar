let presenceChannel = null;
let cdnLoading = false;
let startAttempts = 0;

function loadSupabaseCdn() {
    if (window.supabase || cdnLoading) return;
    cdnLoading = true;
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    script.async = true;
    script.onerror = () => {
        cdnLoading = false;
    };
    document.head.append(script);
}

export function initPresence(supabaseUrl, supabaseKey, onCountUpdate) {
    function start() {
        if (!window.supabase) {
            loadSupabaseCdn();
            if (startAttempts < 40) {
                startAttempts++;
                setTimeout(start, 150);
            }
            return;
        }

        try {
            const client = window.supabase.createClient(supabaseUrl, supabaseKey);
            presenceChannel = client.channel("highway-listeners", {
                config: { presence: { key: crypto.randomUUID() } }
            });

            const updateOnlineCount = () => {
                if (!presenceChannel) return;
                const state = presenceChannel.presenceState();
                const count = Object.values(state)
                    .reduce((total, users) => total + (Array.isArray(users) ? users.length : 0), 0);
                
                // Count at least 1 for yourself + other active tabs/devices + 555 offset
                const totalActive = Math.max(1, count);
                const displayCount = totalActive + 555;
                onCountUpdate(displayCount);
            };

            presenceChannel
                .on("presence", { event: "sync" }, updateOnlineCount)
                .on("presence", { event: "join" }, updateOnlineCount)
                .on("presence", { event: "leave" }, updateOnlineCount);

            presenceChannel.subscribe(status => {
                if (status === "SUBSCRIBED") {
                    presenceChannel.track({
                        online_at: new Date().toISOString(),
                        page: "radio-safar",
                        device: /Mobi|Android/i.test(navigator.userAgent) ? "mobile" : "desktop"
                    });
                    updateOnlineCount();
                }
            });

            window.addEventListener("pagehide", () => presenceChannel?.untrack());
            window.addEventListener("beforeunload", () => presenceChannel?.untrack());
        } catch (error) {
            console.error("Supabase Presence Error:", error);
        }
    }

    start();
}