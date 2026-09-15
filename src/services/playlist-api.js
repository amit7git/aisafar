const YT_PLAYLIST_ITEMS_ENDPOINT = "https://www.googleapis.com/youtube/v3/playlistItems";
const MAX_RESULTS_PER_PAGE = 50;
const MAX_PAGES = 200;

export function hasYouTubeApiKey() {
    return Boolean(import.meta.env.VITE_YOUTUBE_API_KEY);
}

/**
 * Fetch ALL video IDs from a YouTube playlist using the YouTube Data API v3.
 * Follows nextPageToken pagination so playlists larger than 200 videos are fully
 * loaded (the IFrame player API itself caps playlists at 200 videos).
 * IDs are de-duplicated so repeats are never included while paging.
 *
 * @param {string} playlistId
 * @returns {Promise<string[] | null>} video IDs, or null when no API key is configured.
 * @throws {Error} when a page request fails (caller should fall back gracefully).
 */
export async function fetchAllPlaylistItems(playlistId) {
    const apiKey = import.meta.env.VITE_YOUTUBE_API_KEY;
    if (!apiKey) return null;

    const ids = [];
    const seen = new Set();
    let pageToken = "";

    for (let page = 0; page < MAX_PAGES; page++) {
        const params = new URLSearchParams({
            part: "contentDetails,status",
            maxResults: String(MAX_RESULTS_PER_PAGE),
            playlistId,
            key: apiKey
        });
        if (pageToken) params.set("pageToken", pageToken);

        let data;
        try {
            const response = await fetch(`${YT_PLAYLIST_ITEMS_ENDPOINT}?${params.toString()}`);
            if (!response.ok) {
                let detail = `HTTP ${response.status}`;
                try {
                    const body = await response.json();
                    if (body?.error?.message) detail = body.error.message;
                } catch {}
                throw new Error(detail);
            }
            data = await response.json();
        } catch (error) {
            throw new Error(`Playlist page ${page + 1} failed: ${error.message}`);
        }

        const items = data.items || [];
        for (const item of items) {
            const videoId = item?.contentDetails?.videoId;
            if (!videoId) continue;
            if (item?.status?.privacyStatus && item.status.privacyStatus !== "public") continue;
            if (seen.has(videoId)) continue;
            seen.add(videoId);
            ids.push(videoId);
        }

        if (data.nextPageToken) {
            pageToken = data.nextPageToken;
            continue;
        }
        break;
    }

    return ids;
}