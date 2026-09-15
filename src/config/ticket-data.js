/**
 * Mitthu Travels — Radio Safar journey ticket DATA.
 *
 * Curated configuration for the fictional journey generator. Everything here
 * is decorative: cities, highways, seats, platforms, fares and identifiers are
 * playful Radio Safar fiction. Nothing is a real booking, and nothing is
 * persisted or sent anywhere.
 */

export const CITIES = [
    "Bengaluru", "Mumbai", "Delhi", "Hyderabad", "Chennai", "Pune",
    "Jaipur", "Ahmedabad", "Surat", "Indore", "Bhopal", "Lucknow",
    "Patna", "Ranchi", "Kolkata", "Bhubaneswar", "Nagpur", "Nashik",
    "Mysuru", "Coimbatore", "Kochi", "Madurai", "Chandigarh", "Amritsar",
    "Dehradun", "Guwahati", "Varanasi", "Prayagraj", "Kanpur", "Udaipur",
    "Jodhpur", "Vadodara", "Visakhapatnam", "Vijayawada"
];

// Real National Highways, weighted toward the ones that cross the friendlier
// Radio Safar corridors (NH 48 and NH 44 are the classic highway-music routes).
export const NATIONAL_HIGHWAYS = [
    "NH 48", "NH 44", "NH 48", "NH 16", "NH 19", "NH 27",
    "NH 30", "NH 65", "NH 66", "NH 53", "NH 52", "NH 75",
    "NH 275", "NH 544", "NH 60", "NH 21", "NH 46"
];

// Geographically plausible start→destination pairs with a sensible NH for each.
// Both directions are included so the generator can flip a route freely.
export const ROUTE_PAIRS = [
    { start: "Bengaluru", end: "Coimbatore", nh: "NH 544" },
    { start: "Coimbatore", end: "Bengaluru", nh: "NH 544" },
    { start: "Mumbai", end: "Pune", nh: "NH 48" },
    { start: "Pune", end: "Mumbai", nh: "NH 48" },
    { start: "Mumbai", end: "Surat", nh: "NH 48" },
    { start: "Surat", end: "Mumbai", nh: "NH 48" },
    { start: "Delhi", end: "Jaipur", nh: "NH 48" },
    { start: "Jaipur", end: "Delhi", nh: "NH 48" },
    { start: "Delhi", end: "Chandigarh", nh: "NH 44" },
    { start: "Chandigarh", end: "Delhi", nh: "NH 44" },
    { start: "Hyderabad", end: "Vijayawada", nh: "NH 65" },
    { start: "Vijayawada", end: "Hyderabad", nh: "NH 65" },
    { start: "Chennai", end: "Bengaluru", nh: "NH 48" },
    { start: "Bengaluru", end: "Chennai", nh: "NH 48" },
    { start: "Lucknow", end: "Kanpur", nh: "NH 27" },
    { start: "Kanpur", end: "Lucknow", nh: "NH 27" },
    { start: "Bengaluru", end: "Mysuru", nh: "NH 275" },
    { start: "Mysuru", end: "Bengaluru", nh: "NH 275" },
    { start: "Jaipur", end: "Udaipur", nh: "NH 48" },
    { start: "Udaipur", end: "Jaipur", nh: "NH 48" },
    { start: "Pune", end: "Nashik", nh: "NH 60" },
    { start: "Nashik", end: "Pune", nh: "NH 60" },
    { start: "Ahmedabad", end: "Vadodara", nh: "NH 48" },
    { start: "Vadodara", end: "Ahmedabad", nh: "NH 48" },
    { start: "Nagpur", end: "Bhopal", nh: "NH 46" },
    { start: "Bhopal", end: "Nagpur", nh: "NH 46" }
];

export const BOARDING_VARIANTS = [
    "Central Bus Stand",
    "City Bus Terminal",
    "Main Bus Stand",
    "Railway Road Bus Stand",
    "Radio Safar Travels Boarding Point"
];

export const PLATFORMS = ["A1", "A2", "B1", "B2", "C1", "C2", "D1", "D2"];

export const SEATS = [
    "11 Window — Upper Deck",
    "19 Window — Upper Deck",
    "23 Aisle — Lower Deck",
    "27 Window — Lower Deck",
    "09 Window — Upper Deck",
    "31 Window — Lower Deck"
];

// Evening/night departures first — they fit the Radio Safar highway atmosphere.
export const DEPARTURE_TIMES = [
    "19:30 Hrs.", "21:00 Hrs.", "21:30 Hrs.", "22:15 Hrs.",
    "23:30 Hrs.", "00:30 Hrs.", "06:15 Hrs.", "07:00 Hrs."
];

export const REFRESH_STOPS = [
    { name: "Mitthu Dhaba", time: "02:30 HRS" },
    { name: "Highway Chai Point", time: "01:15 HRS" },
    { name: "Kamat Yatrinivas", time: "03:00 HRS" },
    { name: "Highway Food Plaza", time: "02:00 HRS" },
    { name: "Safar Chai Stop", time: "01:45 HRS" }
];

export const FARES = [499, 599, 649, 733, 749, 833, 999];

export function randomOf(list) {
    return list[Math.floor(Math.random() * list.length)];
}

export function nhForPair(start, dest) {
    const entry = ROUTE_PAIRS.find(p => p.start === start && p.end === dest);
    return entry ? entry.nh : null;
}