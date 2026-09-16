/**
 * AI Safar — lightweight semantic metadata layer.
 *
 * Adds search-friendly intent hints (mood, language, era, situation, keywords)
 * for every EXISTING Radio Safar. This file never defines a playlist ID, title,
 * or order — those live only in MOOD_PLAYLISTS. `select_safar` validation stays
 * anchored to MOOD_PLAYLISTS keys (see api/ai-safar.js), so a Safar can never be
 * invented here. Use `findSemanticDrift()` in tests to prove the layers match.
 */

import { MOOD_PLAYLISTS } from './playlists.js';

const SAFAR_SEMANTICS = {
    "90s": {
        mood: ['nostalgic', 'yaadon bhari', 'fun'],
        language: ['Hindi', 'Hinglish'],
        era: ['90s', '1990s', 'nineties'],
        situation: ['yaadein', 'college days', 'school friend', 'purana jamana'],
        keywords: ['90s', 'nineties', '1990', '90 ke gaane', '90s ke gaane', '90s songs', '90s gaane', '90s music', 'retro pop', 'old bollywood hits']
    },
    "Hindi": {
        mood: ['evergreen', 'romantic', 'dil se'],
        language: ['Hindi', 'Hinglish'],
        era: ['evergreen', 'classic', 'latest hits'],
        situation: ['bollywood', 'love songs', 'movie songs', 'general listening'],
        keywords: ['hindi', 'hindi songs', 'hindi gaane', 'bollywood', 'film songs', 'evergreen hindi', 'old hindi', 'new hindi']
    },
    "Purani Jeans": {
        mood: ['nostalgic', 'retro', 'sentimental', 'slow evening'],
        language: ['Hindi', 'Hinglish'],
        era: ['1950s-1980s', 'vintage', 'golden era', 'purana jamana'],
        situation: ['purani yaadein', 'night drive', 'highway', 'raat ka safar', 'open road', 'childhood', 'purane din'],
        keywords: ['nostalgic', 'nostalgia', 'purane gaane', 'old songs', 'purani yaadein', 'old memories', 'purane din', 'retro', 'purani jeans', 'evergreen', 'golden oldies', 'classic hindi songs', 'old hindi classics', 'yaad', 'yaadon', 'old days', 'night drive', 'highway', 'road trip', 'raat ka safar', 'late night', 'slow drive', 'evergreen hits']
    },
    "RadhaKrishna": {
        mood: ['bhakti', 'prem bhakti', 'devotional'],
        language: ['Hindi', 'Sanskrit'],
        era: ['traditional', 'shastriya'],
        situation: ['puja', 'radha krishna keht', 'bhagwan leela', 'morning aarti'],
        keywords: ['radha', 'krishna', 'bhajan', 'radha krishna', 'radhakrishna', 'kanha', 'krishna bhajan', 'krishna songs', 'radha krishna bhajan', 'bhagwan', 'leela', 'gokul', 'vraj']
    },
    "HareKrishna": {
        mood: ['bhakti', 'sattvik', 'peace'],
        language: ['Hindi', 'Sanskrit', 'mantra'],
        era: ['traditional', 'iskcon'],
        situation: ['kirtan', 'meditation', 'iskcon', 'mahamantra'],
        keywords: ['hare krishna', 'hare rama', 'iskcon', 'kirtan', 'mahamantra', 'mantra', 'govinda']
    },
    "Bhakti": {
        mood: ['sukoon', 'peaceful', 'shraddha', 'calm', 'relaxing'],
        language: ['Hindi'],
        era: ['traditional'],
        situation: ['puja', 'aarti', 'mandir', 'meditation', 'sukoon wali shaam', 'relax'],
        keywords: ['sukoon', 'peace', 'peaceful', 'calm', 'relax', 'relaxing', 'shanti', 'devotional', 'bhakti', 'bhajan', 'aarti', 'puja', 'mandir', 'ibadat', 'shraddha', 'prayer', 'god songs']
    },
    "English": {
        mood: ['upbeat', 'chill', 'good vibes'],
        language: ['English'],
        era: ['pop', 'rock', 'modern', 'classic'],
        situation: ['chill', 'drive', 'study', 'workout', 'good vibes'],
        keywords: ['english', 'english songs', 'english music', 'good vibes', 'chill', 'pop', 'rock', 'western', 'enjoy']
    },
    "Punjabi": {
        mood: ['energetic', 'masti', 'swag'],
        language: ['Punjabi', 'Hindi'],
        era: ['modern', 'bhangra'],
        situation: ['party', 'wedding', 'bhangra', 'workout', 'dhol', 'masti'],
        keywords: ['punjabi', 'panjabi', 'bhangra', 'jatt', 'punjab', 'punjabi songs', 'punjabi gaane', 'punjabi music', 'punjabi beats', 'party', 'swag', 'energy', 'desi beat', 'dance']
    },
    "Haryanvi": {
        mood: ['energetic', 'desi', 'powerful'],
        language: ['Haryanvi', 'Hindi'],
        era: ['modern', 'desi'],
        situation: ['party', 'raag', 'full power', 'desi night'],
        keywords: ['hariyanvi', 'haryanvi', 'haryana', 'desi', 'raag', 'jaat', 'full power', 'hatela', 'desi beat']
    },
    "Bhojpuri": {
        mood: ['masti', 'energetic', 'desi tadka'],
        language: ['Bhojpuri', 'Hindi'],
        era: ['modern', 'loka geet'],
        situation: ['party', 'pachra', 'social', 'bihar', 'desi night'],
        keywords: ['bhojpuri', 'bhojpuri songs', 'bhojpuri song', 'bhojpuri gaane', 'bhojpuri gaana', 'bhojpuri chalao', 'bhojpuri music', 'bihar', 'desi tadka', 'masti', 'nachni', 'pachra']
    },
    "Bhojpuri Bhakti": {
        mood: ['bhakti', 'shraddha'],
        language: ['Bhojpuri', 'Hindi'],
        era: ['traditional'],
        situation: ['bhojpuri puja', 'devi gana', 'desi bhakti'],
        keywords: ['bhojpuri bhakti', 'bhojpuri bhajan', 'devi', 'bhojpuri puja', 'desi bhajan', 'goddess songs']
    },
    "Vivaah Geet": {
        mood: ['celebratory', 'festive'],
        language: ['Hindi'],
        era: ['traditional', 'modern'],
        situation: ['shaadi', 'wedding', 'mehndi', 'sangeet', 'barat', 'rasmein'],
        keywords: ['shaadi', 'shadi', 'wedding', 'vivaah', 'marriage', 'mehndi', 'sangeet', 'barat', 'jodi', 'rasmein', 'dulhan', 'shaadi ke geet', 'wedding songs']
    },
    "Chhath Geet": {
        mood: ['shraddha', 'pavitra', 'festive'],
        language: ['Bhojpuri', 'Hindi', 'Maithili'],
        era: ['traditional'],
        situation: ['chhath puja', 'chhathi maiya', 'surya worship', 'festival'],
        keywords: ['chhath', 'chhath puja', 'chhathi maiya', 'surya', 'chhath geet', 'lok parva', 'festival songs']
    },
    "Kannada": {
        mood: ['melodious', 'regional pride', 'soulful'],
        language: ['Kannada'],
        era: ['evergreen', 'modern'],
        situation: ['kannada movies', 'karnataka', 'regional music'],
        keywords: ['kannada', 'kannada songs', 'kannada gaana', 'karnataka', 'sandalwood']
    },
    "Tamil": {
        mood: ['soulful', 'melodious', 'regional'],
        language: ['Tamil'],
        era: ['evergreen', 'modern'],
        situation: ['tamil movies', 'chennai', 'regional music'],
        keywords: ['tamil', 'tamil songs', 'tamil gaana', 'chennai', 'tamilnadu', 'kollywood']
    },
    "Telugu": {
        mood: ['melodious', 'regional', 'energetic'],
        language: ['Telugu'],
        era: ['evergreen', 'modern'],
        situation: ['telugu movies', 'hyderabad', 'regional music'],
        keywords: ['telugu', 'telugu songs', 'telugu gaana', 'hyderabad', 'tollywood', 'andhra']
    },
    "AI made": {
        mood: ['experimental', 'playful', 'surprise'],
        language: ['mixed', 'Hindi', 'English'],
        era: ['modern'],
        situation: ['experiment', 'surprise safar', 'ai ka safar', 'random'],
        keywords: ['ai made', 'ai safar', 'ai ka safar', 'experiment', 'surprise', 'random', 'mast andaz']
    }
};

export function getSafarSemantics(key) {
    return SAFAR_SEMANTICS[key] || null;
}

export function findSemanticDrift() {
    const playlistKeys = new Set(Object.keys(MOOD_PLAYLISTS));
    const semanticKeys = Object.keys(SAFAR_SEMANTICS);
    const missing = semanticKeys.filter(key => !playlistKeys.has(key));
    const unknown = semanticKeys.filter(key => getSafarSemantics(key).keywords.length === 0);
    const absent = [...playlistKeys].filter(key => !SAFAR_SEMANTICS[key]);
    return { missing, unknown, absent };
}