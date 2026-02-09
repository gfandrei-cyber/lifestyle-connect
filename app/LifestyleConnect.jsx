'use client';
import React, { useState, useEffect, useCallback } from 'react';
import {
  Heart, MessageCircle, Shield, Check, Calendar, MapPin,
  Users, Activity, ChevronRight, Lock, Unlock, Award, UserCheck,
  Coffee, Sparkles, X, ArrowRight, Bookmark,
  Star, ChevronDown, Pencil, Plane
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// CONSTANTS — FREE vs PREMIUM limits live here.
// Premium extends capacity.  It never bypasses a gate.
// ─────────────────────────────────────────────────────────────
// Premium extends TIME only.  It never increases outbound volume (interests, pending
// actions) — that would convert coordination capacity into social pressure.
const SHARED_LIMITS = { INTEREST_LIMIT: 5 };
const FREE  = { ...SHARED_LIMITS, MSG_TTL_MS: 72*60*60*1000,  RSVP_TTL_MS: 48*60*60*1000  }; // 3 d / 2 d
const PREM  = { ...SHARED_LIMITS, MSG_TTL_MS: 168*60*60*1000, RSVP_TTL_MS: 96*60*60*1000  }; // 7 d / 4 d
const TICK_MS = 5000;

// ─────────────────────────────────────────────────────────────
// FOUNDING COUPLES ACCESS — stewardship, not promotion.
// foundingAccess overrides premium checks.  It is granted only after
// eligibility conditions are met AND a valid invite token was used at signup.
// No badges.  No UI artifacts.  One private acknowledgment, then silence.
// ─────────────────────────────────────────────────────────────
const FOUNDING_CAP         = 30;               // hard ceiling.  Once hit, tokens stop validating.
const FOUNDING_TENURE_DAYS = 30;              // production: server checks account age ≥ this.  Prototype: noted only.
const FOUNDING_TOKENS      = new Set(['fc_a1b2c3','fc_d4e5f6','fc_g7h8i9']); // static pool.  Each used once.
let   FOUNDING_GRANTED     = 0;               // mutable counter — resets on page reload (prototype).

// Consume a token.  Returns true only if the token is valid AND the cap hasn't been reached.
// Side-effect: removes the token from the pool.  Idempotent on invalid input.
const consumeFoundingToken = (token) => {
  if (!token || FOUNDING_GRANTED >= FOUNDING_CAP) return false;
  if (!FOUNDING_TOKENS.has(token)) return false;
  FOUNDING_TOKENS.delete(token);
  return true;
};

// Pure eligibility check.  Both conditions must be true for access to activate.
// In production, a third condition (account age ≥ FOUNDING_TENURE_DAYS) would be
// enforced server-side.  The prototype cannot simulate elapsed time, so it is
// documented here but not blocked on.
const checkFoundingEligibility = (pendingActions, interestsSent) => {
  let hasConfirmed = false;
  pendingActions.forEach(action => { if (action.status === 'confirmed') hasConfirmed = true; });
  const hasEngaged = interestsSent.size > 0;
  return hasConfirmed && hasEngaged;
};

// ─────────────────────────────────────────────────────────────
// LOCATION — static region model.  No coordinates.  No geocoding.  No maps.
// City + State  →  region.   Region  →  adjacency ring.   Density  →  default scope width.
// ─────────────────────────────────────────────────────────────
const REGION_MAP = {
  'Austin, TX':         { region: 'Austin Metro',      country: 'US', density: 'moderate' },
  'Round Rock, TX':     { region: 'Austin Metro',      country: 'US', density: 'moderate' },
  'San Marcos, TX':     { region: 'Austin Metro',      country: 'US', density: 'moderate' },
  'San Antonio, TX':    { region: 'San Antonio Metro', country: 'US', density: 'moderate' },
  'Houston, TX':        { region: 'Houston Metro',     country: 'US', density: 'dense'    },
  'Dallas, TX':         { region: 'Dallas Metro',      country: 'US', density: 'dense'    },
  'Fort Worth, TX':     { region: 'Dallas Metro',      country: 'US', density: 'dense'    },
  'Los Angeles, CA':    { region: 'LA Metro',          country: 'US', density: 'dense'    },
  'San Francisco, CA':  { region: 'SF Bay Area',       country: 'US', density: 'dense'    },
  'Oakland, CA':        { region: 'SF Bay Area',       country: 'US', density: 'dense'    },
  'Toronto, ON':        { region: 'Toronto Metro',     country: 'CA', density: 'dense'    },
  'Ottawa, ON':         { region: 'Ottawa Metro',      country: 'CA', density: 'moderate' },
  'Montreal, QC':       { region: 'Montreal Metro',    country: 'CA', density: 'dense'    },
  'Vancouver, BC':      { region: 'Vancouver Metro',   country: 'CA', density: 'dense'    },
};

// Regions reachable at each scope tier.  'local' = same region (+ one neighbor if sparse).
// 'nearby' = same + first adjacency ring.  'travel' = country-wide (border checked separately).
const ADJACENCY = {
  'Austin Metro':        ['San Antonio Metro'],
  'San Antonio Metro':   ['Austin Metro'],
  'Houston Metro':       ['Dallas Metro'],
  'Dallas Metro':        ['Houston Metro'],
  'LA Metro':            [],
  'SF Bay Area':         [],
  'Toronto Metro':       ['Ottawa Metro'],
  'Ottawa Metro':        ['Toronto Metro','Montreal Metro'],
  'Montreal Metro':      ['Ottawa Metro'],
  'Vancouver Metro':     [],
};

const SCOPE_LABELS = { local: 'Local area', nearby: "Within a few hours' drive", travel: 'Travel-friendly' };

// Derive a full location record from signup inputs.  Returns a usable object even if
// the city isn't in REGION_MAP — region will be null and the filter will let everything through.
const deriveLocation = (city, state) => {
  const key   = `${city.trim()}, ${state.trim()}`;
  const match = REGION_MAP[key];
  return match
    ? { city: city.trim(), state: state.trim(), region: match.region, country: match.country }
    : { city: city.trim(), state: state.trim(), region: null, country: 'US' };
};

// Turn a profile's location string (e.g. 'Austin, TX') into { region, country }.
const resolveProfileLocation = (locationStr) => {
  const match = REGION_MAP[locationStr];
  return match ? { region: match.region, country: match.country } : { region: null, country: 'US' };
};

// Core filter.  Pure.  No side effects.  Called before rendering profiles.
const isInScope = (userLoc, profileLoc, scope, crossBorder) => {
  if (!userLoc?.region || !profileLoc?.region) return true; // unknown region → don't filter out

  // Country boundary is a hard default.  Only drops when crossBorder is explicitly true.
  if (userLoc.country !== profileLoc.country && !crossBorder) return false;

  if (scope === 'travel') return true; // travel = country-wide; border already checked above

  const userRegion    = userLoc.region;
  const profileRegion = profileLoc.region;
  const neighbors     = ADJACENCY[userRegion] || [];
  const userDensity   = REGION_MAP[`${userLoc.city}, ${userLoc.state}`]?.density || 'moderate';

  if (scope === 'local') {
    if (profileRegion === userRegion) return true;
    // Sparse regions auto-include one neighbor so the feed isn't empty
    if (userDensity === 'sparse' && neighbors.includes(profileRegion)) return true;
    return false;
  }

  if (scope === 'nearby') {
    if (profileRegion === userRegion)          return true;
    if (neighbors.includes(profileRegion))     return true;
    return false;
  }

  return false;
};

// Event visibility.  Each event carries a type field.  Virtual = always visible.
// Travel = always visible but labeled.  Local = filtered by user scope like profiles.
const isEventVisible = (event, userLoc, scope, crossBorder) => {
  if (event.type === 'virtual') return true;
  if (event.type === 'travel')  return true; // visible but will be labeled
  // 'local' — check whether the event's city is within scope
  const eventLoc = resolveProfileLocation(event.location);
  return isInScope(userLoc, eventLoc, scope, crossBorder);
};

const INTENT_OPTIONS = [
  { id: 'social',       label: 'Friendship & social',  icon: Coffee,    color: 'from-blue-400 to-cyan-400' },
  { id: 'conversation', label: 'Conversation',         icon: Sparkles,  color: 'from-purple-400 to-pink-400' },
  { id: 'meeting',      label: 'Open to meeting',      icon: Heart,     color: 'from-rose-400 to-amber-400' }
];


const LOUNGE_DATA = [
  {
    id: 1, name: 'Travel Couples', members: 124, activity: 'Very Active',
    topics: ['Europe trip planning','Best couples resorts'], vibe: 'Adventurous & curious',
    whyJoin: 'People here plan trips together and share what actually works.',
    prompts: [
      'What kind of trip brought you closest as a couple?',
      'How do you handle different travel styles between partners?',
      'What\'s one place you\'d go back to without hesitation?'
    ],
    activitySignal: '4 new conversations this week',
    weeklyPrompt: 'What kind of trip brought you closest as a couple?',
    seedResponses: [
      { id: 'seed1', text: 'We spent two weeks in Portugal with no plan. Just wandering. It forced us to check in constantly and we learned how to flow together.', timestamp: Date.now() - 2*24*60*60*1000 },
      { id: 'seed2', text: 'A week in a cabin with no wifi. We had to actually talk to each other about what we wanted from the trip, and from us.', timestamp: Date.now() - 4*24*60*60*1000 },
      { id: 'seed3', text: 'Road trip through the Southwest. Long drives gave us space to talk about things we avoid at home. No pressure, just time.', timestamp: Date.now() - 5*24*60*60*1000 }
    ]
  },
  {
    id: 2, name: 'New to ENM', members: 203, activity: 'Very Active',
    topics: ['First steps','Communication tools'], vibe: 'Supportive & learning-focused',
    whyJoin: 'A place to ask questions without judgment. Everyone here started somewhere.',
    prompts: [
      'What helped you feel more confident in the early months?',
      'How do you handle pacing differences between partners?',
      'What does a good check-in look like for your couple?'
    ],
    activitySignal: '6 new conversations this week',
    weeklyPrompt: 'What helped you feel more confident in the early months?',
    seedResponses: [
      { id: 'seed4', text: 'Reading about other couples\' experiences helped us realize we weren\'t broken. We just needed better tools.', timestamp: Date.now() - 1*24*60*60*1000 },
      { id: 'seed5', text: 'Knowing we could pause anytime. That took the pressure off and let us actually explore instead of forcing it.', timestamp: Date.now() - 3*24*60*60*1000 },
      { id: 'seed6', text: 'Finding one couple who moved at our speed. It made everything feel less theoretical and more real.', timestamp: Date.now() - 6*24*60*60*1000 }
    ]
  },
  {
    id: 3, name: 'Social-Only', members: 156, activity: 'Very Active',
    topics: ['Game night ideas','Book club suggestions'], vibe: 'Warm & platonic',
    whyJoin: 'For couples who want connection without any romantic pressure. Genuinely fun.',
    prompts: [
      'What makes a first meeting feel comfortable to you?',
      'Best board game for a group of couples?',
      'How do you keep social life feeling easy, not obligatory?'
    ],
    activitySignal: '3 new conversations this week',
    weeklyPrompt: 'What makes a first meeting feel comfortable to you?',
    seedResponses: [
      { id: 'seed7', text: 'When it\'s clear from the start that nobody owes anyone anything. Just see if we enjoy each other\'s company.', timestamp: Date.now() - 2*24*60*60*1000 },
      { id: 'seed8', text: 'Public place, daylight, casual activity. Coffee or a walk. Nothing that feels like an audition.', timestamp: Date.now() - 4*24*60*60*1000 }
    ]
  },
  {
    id: 4, name: 'Parents in ENM', members: 89, activity: 'Active',
    topics: ['Scheduling strategies','Balance tips'], vibe: 'Practical & judgment-free',
    whyJoin: 'Logistics are real. This is where people share what actually works with kids in the picture.',
    prompts: [
      'How do you explain things to your kids in age-appropriate ways?',
      'What scheduling approach has worked best for your family?',
      'Where do you draw the line between honesty and simplicity?'
    ],
    activitySignal: '2 new conversations this week',
    weeklyPrompt: 'What scheduling approach has worked best for your family?',
    seedResponses: [
      { id: 'seed9', text: 'We calendar everything two weeks out. Sounds rigid but it actually reduces stress because everyone knows what to expect.', timestamp: Date.now() - 3*24*60*60*1000 },
      { id: 'seed10', text: 'One weekend night a month, planned ahead, with backup plans. Keeps it manageable and means we don\'t overcommit.', timestamp: Date.now() - 5*24*60*60*1000 }
    ]
  },
  {
    id: 5, name: 'Art & Culture', members: 67, activity: 'Moderate',
    topics: ['Upcoming exhibitions','Theater season'], vibe: 'Sophisticated & curious',
    whyJoin: 'Great excuse to get out of the house. Couples here care about experiences over status.',
    prompts: [
      'What\'s the last piece of art that genuinely moved you?',
      'How do you find events worth attending in your city?',
      'Do you prefer intimate galleries or big museum nights?'
    ],
    activitySignal: '1 new conversation this week',
    weeklyPrompt: 'Do you prefer intimate galleries or big museum nights?',
    seedResponses: [
      { id: 'seed11', text: 'Small galleries. You can actually talk about what you\'re seeing without feeling like you\'re in the way.', timestamp: Date.now() - 4*24*60*60*1000 },
      { id: 'seed12', text: 'Big museums but on quiet weekday afternoons. Get the scale without the crowds. Best of both.', timestamp: Date.now() - 6*24*60*60*1000 }
    ]
  }
];

const EVENT_DATA = [
  {
    id: 1, title: 'Wine & Dine Evening', host: 'Sarah & Michael', type: 'local',
    date: 'Feb 8, 2026', time: '7:00 PM', venue: 'The Mansion Restaurant', location: 'Austin, TX',
    description: 'Elegant evening of wine tasting and gourmet dining. Cocktail attire. Limited to 6 couples.',
    maxAttendees: 12, loungeOrigin: 'Social-Only',
    existingRSVPs: ['Sarah & Michael','Jennifer & David'],
    paid: false, price: null
  },
  {
    id: 2, title: 'ENM Communication Workshop', host: 'Connect Community', type: 'virtual',
    date: 'Feb 12, 2026', time: '2:00 PM', venue: 'Zoom', location: 'Virtual',
    description: 'Facilitator-led workshop on communication strategies. All experience levels.',
    maxAttendees: 30, loungeOrigin: 'New to ENM',
    existingRSVPs: [],
    paid: false, price: null
  },
  {
    id: 3, title: 'Art Gallery Opening', host: 'Amanda & Chris', type: 'local',
    date: 'Feb 15, 2026', time: '6:30 PM', venue: 'Contemporary Austin', location: 'Downtown Austin',
    description: 'Private viewing followed by cocktails and conversation.',
    maxAttendees: 16, loungeOrigin: 'Art & Culture',
    existingRSVPs: ['Amanda & Chris','Sarah & Michael'],
    paid: false, price: null
  },
  {
    id: 4, title: 'Private Dinner: Italian Night', host: 'Connect Curated', type: 'local',
    date: 'Feb 22, 2026', time: '7:30 PM', venue: 'Rosewood Private Dining', location: 'Austin, TX',
    description: 'An intimate, curated dinner for 4 couples. Menu by a guest chef. A quieter evening.',
    maxAttendees: 8, loungeOrigin: 'Social-Only',
    existingRSVPs: [],
    paid: true, price: 85  // per couple
  }
];

const PLACES_DATA = [
  {
    id: 1, name: 'Weather Up', city: 'Austin', state: 'TX',
    category: 'Cocktail bar', vibe: ['Social','Low-key','Weekday-friendly'],
    description: 'Craft cocktails in a quieter setting. Good for conversation.',
    likedCount: 12, presenceCountToday: 1, presenceCountTonight: 3
  },
  {
    id: 2, name: 'The Roosevelt Room', city: 'Austin', state: 'TX',
    category: 'Cocktail bar', vibe: ['Intimate','Date night','Weekend'],
    description: 'Upscale cocktail lounge. Tends to get busy after 9.',
    likedCount: 18, presenceCountToday: 0, presenceCountTonight: 2
  },
  {
    id: 3, name: 'Justine\'s Brasserie', city: 'Austin', state: 'TX',
    category: 'Restaurant', vibe: ['Romantic','Outdoor seating','Social'],
    description: 'French bistro with a patio. Casual but elevated.',
    likedCount: 23, presenceCountToday: 2, presenceCountTonight: 4
  },
  {
    id: 4, name: 'The Contemporary Austin', city: 'Austin', state: 'TX',
    category: 'Gallery', vibe: ['Cultural','Quiet','Weekday-friendly'],
    description: 'Art museum with rotating exhibitions. Often quiet on weekdays.',
    likedCount: 15, presenceCountToday: 3, presenceCountTonight: 1
  },
  {
    id: 5, name: 'Meanwhile Brewing Co.', city: 'Austin', state: 'TX',
    category: 'Social space', vibe: ['Casual','Group-friendly','Outdoor'],
    description: 'Brewery with a relaxed backyard vibe. Good for groups.',
    likedCount: 19, presenceCountToday: 4, presenceCountTonight: 2
  },
  {
    id: 6, name: 'Barton Springs Pool', city: 'Austin', state: 'TX',
    category: 'Outdoor space', vibe: ['Daytime','Active','Casual'],
    description: 'Natural spring-fed pool. Popular on weekends.',
    likedCount: 31, presenceCountToday: 5, presenceCountTonight: 0
  },
  {
    id: 7, name: 'Fareground', city: 'Austin', state: 'TX',
    category: 'Food hall', vibe: ['Casual','Social','Group-friendly'],
    description: 'Downtown food hall. Easy for different tastes.',
    likedCount: 14, presenceCountToday: 2, presenceCountTonight: 3
  }
];

const PROFILE_DATA = [
  {
    id: 1, names: 'Sarah & Michael',
    partnerA: { age: 32 }, partnerB: { age: 34 },
    location: 'Austin, TX',
    bio: 'Cultured professionals who appreciate fine wine, art gallery openings, and intellectually stimulating conversation. We value slow, intentional connections.',
    interests: ['Travel','Food & dining','Art & culture','Deep conversation','Reading together'],
    trustLevel: 4,
    trustSignals: { id: true, relationship: true, alignment: true, community: true },
    reputation: ['Frequently respected boundaries','Consistently clear communicators'],
    relationshipStructure: 'ENM', experienceLevel: 'Established',
    pacePreference: 'Very slow', autonomyStance: 'Mixed, discussed intentionally',
    primaryIntent: 'Friendship & social connection',
    sharedLounges: ['Travel Couples','Social-Only'],
    sharedEvents: ['Wine & Dine Evening'],
    softSignals: ['Often joins Social lounges','Prefers slow pacing']
  },
  {
    id: 2, names: 'Jennifer & David',
    partnerA: { age: 29 }, partnerB: { age: 31 },
    location: 'Austin, TX',
    bio: 'Tech professionals passionate about good food and genuine connections. We prefer social-first approaches and take our time getting to know people.',
    interests: ['Art & culture','Food & dining','Live music','Deep conversation'],
    trustLevel: 3,
    trustSignals: { id: true, relationship: true, alignment: true, community: true },
    reputation: ['Community-engaged couple'],
    relationshipStructure: 'Open', experienceLevel: 'Some experience',
    pacePreference: 'Social-first', autonomyStance: 'Autonomy-forward',
    primaryIntent: 'Conversation & getting to know each other',
    sharedLounges: ['Social-Only'],
    sharedEvents: ['Wine & Dine Evening'],
    softSignals: ['Active in Social-Only','Enjoys group settings']
  },
  {
    id: 3, names: 'Amanda & Chris',
    partnerA: { age: 36 }, partnerB: { age: 38 },
    location: 'Austin, TX',
    bio: 'Empty nesters rediscovering ourselves. We value deep conversations, weekend getaways, and authentic relationships built slowly over time.',
    interests: ['Fitness & wellness','Travel','Food & dining','Reading together','Outdoor adventures'],
    trustLevel: 4,
    trustSignals: { id: true, relationship: true, alignment: true, community: true },
    reputation: ['Frequently respected boundaries','Community-engaged couple'],
    relationshipStructure: 'Poly-leaning', experienceLevel: 'New',
    pacePreference: 'Very slow', autonomyStance: 'Couple-first',
    primaryIntent: 'Friendship & social connection',
    sharedLounges: ['Travel Couples','New to ENM'],
    sharedEvents: ['Art Gallery Opening'],
    softSignals: ['New to the community','Prefers slow pacing']
  }
];

// ─────────────────────────────────────────────────────────────
export default function LifestyleConnect() {
  const [view, setView]                           = useState('landing');
  const [selectedProfileId, setSelectedProfileId] = useState(null);
  const [selectedEventId, setSelectedEventId]     = useState(null);
  const [selectedLoungeId, setSelectedLoungeId]   = useState(null);

  const [accountActive, setAccountActive]         = useState(false);
  const [myProfile, setMyProfile]                 = useState(null); // null until profile is built
  const [isPremium, setIsPremium]                 = useState(false);
  const [hasCoordinated, setHasCoordinated]       = useState(false); // monetization trigger
  const [premiumDismissed, setPremiumDismissed]   = useState(false); // user dismissed the banner

  // ── FOUNDING ACCESS STATE ──
  // foundingEligible: token was valid at signup.  Access not yet active.
  // foundingAccess:   eligibility conditions met → premium checks bypassed.
  // foundingAcknowledged: the one-time private message has been shown.
  const [foundingEligible, setFoundingEligible]   = useState(false);
  const [foundingAccess, setFoundingAccess]       = useState(false);
  const [foundingAcknowledged, setFoundingAcknowledged] = useState(false);

  const [loungesJoined, setLoungesJoined]         = useState(new Set());
  const [interestsSent, setInterestsSent]         = useState(new Map());
  const [pendingActions, setPendingActions]       = useState(new Map());
  const [bookmarks, setBookmarks]                 = useState(new Set()); // premium: saved conversations
  const [capFlash, setCapFlash]                   = useState(null);      // profileId currently flashing "for today"

  // ── LOUNGE PARTICIPATION ──
  // Minimal viable participation: anonymous responses to weekly prompts.
  // loungeResponses: Map<loungeId, Array<{ id, text, partner1, partner2, timestamp }>>
  // loungeDrafts:    Map<loungeId, { text, draftedBy }> — pending partner confirmation
  const [loungeResponses, setLoungeResponses]     = useState(new Map());
  const [loungeDrafts, setLoungeDrafts]           = useState(new Map());

  // ── PLACES & PRESENCE ──
  // Ambient social awareness: "might be there" presence signals, not coordination.
  // placeLikes:           Set<placeId> — user has marked this place as a favorite
  // placePresence:        Map<placeId, { slot: 'today'|'tonight', partner1, partner2, timestamp }> — confirmed presence
  // placePendingPresence: Map<placeId, { slot, draftedBy }> — pending partner confirmation
  const [placeLikes, setPlaceLikes]               = useState(new Set());
  const [placePresence, setPlacePresence]         = useState(new Map());
  const [placePendingPresence, setPlacePendingPresence] = useState(new Map());

  // ── LOCATION STATE ──
  // userLocation: set during signup. Defaults to Austin so the prototype demo works
  // without forcing real input. scope and crossBorder control discovery width.
  const [userLocation, setUserLocation]           = useState({ city: 'Austin', state: 'TX', region: 'Austin Metro', country: 'US' });
  const [scope, setScope]                         = useState('local');
  const [crossBorder, setCrossBorder]             = useState(false);

  // ── AGE FILTERING ──
  // Global age range filter (25-75). Matching logic: each partner must fall within ±5 years of corresponding partner.
  const [ageFilterMin, setAgeFilterMin]           = useState(25);
  const [ageFilterMax, setAgeFilterMax]           = useState(75);

  // Pure age match check: returns true if both partners are within ±5 years of user's corresponding partners
  const isAgeCompatible = (userProfile, targetProfile) => {
    if (!userProfile?.partnerA?.age || !userProfile?.partnerB?.age) return true; // user hasn't set ages yet
    if (!targetProfile?.partnerA?.age || !targetProfile?.partnerB?.age) return true; // target hasn't set ages
    
    const userA = userProfile.partnerA.age;
    const userB = userProfile.partnerB.age;
    const targetA = targetProfile.partnerA.age;
    const targetB = targetProfile.partnerB.age;

    // Each partner must be within ±5 years of the other couple's corresponding partner
    const partnerAMatch = Math.abs(userA - targetA) <= 5;
    const partnerBMatch = Math.abs(userB - targetB) <= 5;

    return partnerAMatch && partnerBMatch;
  };

  // ── TRAVEL WINDOW ──
  // When active, user's profile shows a "Visiting X · dates" badge and they appear
  // in that city's discovery results.  Never overrides gates.  Never enables messaging.
  const [travelWindow, setTravelWindow]           = useState(null);
  // { city, state, arrival, departure } or null

  // Derived limits based on plan.  foundingAccess grants current premium TTLs without billing.
  const limits = (isPremium || foundingAccess) ? PREM : FREE;

  // Full profile list: seed data + user's own profile (if created).
  // Everything that reads profiles uses this.  Browse filters it; detail looks up by id.
  const allProfiles = myProfile ? [...PROFILE_DATA, myProfile] : PROFILE_DATA;

  // Fires a brief micro-feedback flash on the intent row for the given profile.
  // Auto-clears after 600 ms so it reads as a momentary pulse, not a persistent state.
  const fireCapFlash = (profileId) => {
    setCapFlash(profileId);
    setTimeout(() => setCapFlash(null), 600);
  };

  // ─── EXPIRY TICKER (unchanged logic, silent) ───
  const expirePending = useCallback(() => {
    const now = Date.now();
    setPendingActions(prev => {
      let changed = false;
      const next = new Map(prev);
      next.forEach((action, key) => {
        if (action.status === 'pending' && (now - action.createdAt) > action.ttlMs) {
          next.set(key, { ...action, status: 'expired' });
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, []);

  useEffect(() => {
    const interval = setInterval(expirePending, TICK_MS);
    return () => clearInterval(interval);
  }, [expirePending]);

  // ─── COORDINATION TRACKER ───
  // Flips hasCoordinated on first confirmed RSVP or first unlocked conversation.
  // This is the ONLY trigger for monetization to become visible.
  useEffect(() => {
    if (hasCoordinated) return;
    pendingActions.forEach(action => {
      if (action.status === 'confirmed') setHasCoordinated(true);
    });
  }, [pendingActions, hasCoordinated]);

  // ─── FOUNDING ACKNOWLEDGMENT AUTO-DISMISS ───
  // The one-time message disappears after 8 s even if the user doesn't tap ×.
  useEffect(() => {
    if (!foundingAccess || foundingAcknowledged) return;
    const timer = setTimeout(() => setFoundingAcknowledged(true), 8000);
    return () => clearTimeout(timer);
  }, [foundingAccess, foundingAcknowledged]);

  // ─── FOUNDING ACCESS ACTIVATION ───
  // Watches for the moment an eligible couple meets the engagement threshold.
  // Fires once.  After that, foundingAccess is true and this effect is a no-op.
  useEffect(() => {
    if (!foundingEligible || foundingAccess) return;
    if (checkFoundingEligibility(pendingActions, interestsSent)) {
      setFoundingAccess(true);
      FOUNDING_GRANTED += 1;
    }
  }, [foundingEligible, foundingAccess, pendingActions, interestsSent]);
  const getAction = (id) => pendingActions.get(id) || null;

  const getMessagingGate = (profile) => {
    const profileLoc       = resolveProfileLocation(profile.location);
    const locationCompatible = isInScope(userLocation, profileLoc, scope, crossBorder);
    const weSent           = interestsSent.has(profile.id);
    const theyHaveInterest = profile.id === 2 || profile.id === 3;
    const mutualInterest   = weSent && theyHaveInterest;
    const sharedContext    = profile.sharedLounges.length > 0 || profile.sharedEvents.length > 0;
    const action           = getAction(`msg-${profile.id}`);
    const dualConfirmed    = action !== null && action.status === 'confirmed';
    return { locationCompatible, mutualInterest, sharedContext, dualConfirmed, unlocked: locationCompatible && mutualInterest && sharedContext && dualConfirmed };
  };

  // ─── ACTIONS ───
  // Returns true if the interest was set/toggled, false if the cap blocked it.
  const handleInterest = (profileId, intentId) => {
    if (interestsSent.get(profileId) === intentId) {
      setInterestsSent(prev => { const n = new Map(prev); n.delete(profileId); return n; });
      return true; // retraction always succeeds
    }
    if (!interestsSent.has(profileId) && interestsSent.size >= limits.INTEREST_LIMIT) return false;
    setInterestsSent(prev => { const n = new Map(prev); n.set(profileId, intentId); return n; });
    return true;
  };

  const confirmDualAction = (actionId, type, targetId, partner, ttlMs) => {
    setPendingActions(prev => {
      const next  = new Map(prev);
      let action  = next.get(actionId);

      if (!action) {
        action = {
          id: actionId, type, targetId, initiator: partner,
          partner1: partner === 'partner1',
          partner2: partner === 'partner2',
          status: 'pending', createdAt: Date.now(), ttlMs
        };
      } else {
        if (action[partner]) {
          // Retract
          action = { ...action, [partner]: false };
          if (!action.partner1 && !action.partner2) { next.delete(actionId); return next; }
          action.status = 'pending';
        } else {
          action = { ...action, [partner]: true };
        }
      }
      action.status = (action.partner1 && action.partner2) ? 'confirmed' : 'pending';
      next.set(actionId, action);
      return next;
    });
  };

  const toggleLounge  = (id) => setLoungesJoined(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleBookmark = (profileId) => {
    if (!isPremium && !foundingAccess) return; // silently blocked — the UI already shows the lock
    setBookmarks(prev => { const n = new Set(prev); n.has(profileId) ? n.delete(profileId) : n.add(profileId); return n; });
  };

  // ── LOUNGE PARTICIPATION ACTIONS ──
  const draftLoungeResponse = (loungeId, text, partner) => {
    setLoungeDrafts(prev => {
      const n = new Map(prev);
      n.set(loungeId, { text, draftedBy: partner });
      return n;
    });
  };

  const confirmLoungeResponse = (loungeId, partner) => {
    const draft = loungeDrafts.get(loungeId);
    if (!draft) return;

    // Post the response — anonymous, timestamped, non-threaded
    setLoungeResponses(prev => {
      const n = new Map(prev);
      const existing = n.get(loungeId) || [];
      const newResponse = {
        id: `r${Date.now()}`,
        text: draft.text,
        partner1: draft.draftedBy === 'partner1' || partner === 'partner1',
        partner2: draft.draftedBy === 'partner2' || partner === 'partner2',
        timestamp: Date.now()
      };
      n.set(loungeId, [...existing, newResponse]);
      return n;
    });

    // Clear the draft
    setLoungeDrafts(prev => {
      const n = new Map(prev);
      n.delete(loungeId);
      return n;
    });
  };

  const cancelLoungeDraft = (loungeId) => {
    setLoungeDrafts(prev => {
      const n = new Map(prev);
      n.delete(loungeId);
      return n;
    });
  };

  // ── PLACES & PRESENCE ACTIONS ──
  const togglePlaceLike = (placeId) => {
    setPlaceLikes(prev => {
      const n = new Set(prev);
      n.has(placeId) ? n.delete(placeId) : n.add(placeId);
      return n;
    });
  };

  const draftPlacePresence = (placeId, slot, partner) => {
    setPlacePendingPresence(prev => {
      const n = new Map(prev);
      n.set(placeId, { slot, draftedBy: partner });
      return n;
    });
  };

  const confirmPlacePresence = (placeId, partner) => {
    const draft = placePendingPresence.get(placeId);
    if (!draft) return;

    // Mark presence — fuzzy, aggregate, auto-expires at end of time window
    setPlacePresence(prev => {
      const n = new Map(prev);
      n.set(placeId, {
        slot: draft.slot,
        partner1: draft.draftedBy === 'partner1' || partner === 'partner1',
        partner2: draft.draftedBy === 'partner2' || partner === 'partner2',
        timestamp: Date.now()
      });
      return n;
    });

    // Clear draft
    setPlacePendingPresence(prev => {
      const n = new Map(prev);
      n.delete(placeId);
      return n;
    });
  };

  const cancelPlacePresenceDraft = (placeId) => {
    setPlacePendingPresence(prev => {
      const n = new Map(prev);
      n.delete(placeId);
      return n;
    });
  };

  // ─────────────────────────────────────────────────────────
  // SHARED COMPONENTS
  // ─────────────────────────────────────────────────────────

  const TrustDots = ({ level, compact }) => (
    <div className="flex gap-1">
      {[0,1,2,3].map(i => (
        <div key={i} className={`rounded-full ${compact ? 'w-1.5 h-1.5' : 'w-2 h-2'} ${i < level ? 'bg-amber-400' : 'bg-slate-700'}`} />
      ))}
    </div>
  );

  // ── DUAL CONFIRM: minimal. ──
  // Default state: two small pill buttons side by side. No label. No countdown.
  // After first partner taps: the other pill softly highlights ("your turn").
  // After both tap: disappears, replaced by a ✓ line.
  // Expired: shows nothing — the parent simply re-renders as if no action exists.
  const DualConfirm = ({ actionId, type, targetId, ttlMs }) => {
    const action = getAction(actionId);

    // CONFIRMED → single quiet confirmation line
    if (action?.status === 'confirmed') {
      return (
        <div className="s-in flex items-center gap-2 py-2 px-3 border-l-2 border-amber-400/50">
          <Check size={13} className="text-amber-400" />
          <span className="text-xs text-slate-500 font-light">Both partners confirmed</span>
        </div>
      );
    }

    // EXPIRED or no action → show two neutral pills (ready for first tap)
    // PENDING  → show two pills, the un-tapped one is gently highlighted
    const p1 = action?.partner1 || false;
    const p2 = action?.partner2 || false;
    const showHighlight = action?.status === 'pending'; // one has tapped, other hasn't

    return (
      <div className="flex gap-2">
        {['partner1','partner2'].map((p, i) => {
          const done   = action?.[p] || false;
          const active = showHighlight && !done; // this is the one that needs to tap
          return (
            <button key={p} onClick={() => confirmDualAction(actionId, type, targetId, p, ttlMs)}
              className={`flex-1 py-2 rounded text-xs font-light transition-all flex items-center justify-center gap-1.5 ${
                done
                  ? 'bg-amber-400/15 text-amber-400 border border-amber-400/25'
                  : active
                    ? 'bg-slate-800 text-white border border-slate-600 ring-1 ring-amber-400/30'
                    : 'bg-slate-900/60 text-slate-500 border border-slate-800 hover:border-slate-700'
              }`}
            >
              <UserCheck size={12} />
              {done ? 'Confirmed' : `Partner ${i+1}`}
            </button>
          );
        })}
      </div>
    );
  };

  // ── MESSAGING STATUS: one line. ──
  // Answers exactly one question. Expandable only on tap for the confirm widget.
  const MsgStatus = ({ profile }) => {
    const gate     = getMessagingGate(profile);
    const actionId = `msg-${profile.id}`;
    const action   = getAction(actionId);
    const [expanded, setExpanded] = useState(false);

    if (gate.unlocked) {
      return (
        <div className="s-in border-l-2 border-amber-400/50 pl-3">
          <button onClick={() => setView('messages')}
            className="w-full bg-gradient-to-r from-amber-400 to-rose-400 text-slate-950 py-3 rounded text-sm font-medium flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-amber-500/15 transition-all">
            <Unlock size={15} /> Message
          </button>
        </div>
      );
    }

    // Determine the single status line.  Location is checked first — no point surfacing
    // interest prompts for someone the user can't message anyway.
    let statusText, canExpand = false;
    if (!gate.locationCompatible) statusText = 'Not in your area';
    else if (!gate.mutualInterest)       statusText = 'Start with interest';
    else if (!gate.sharedContext)    statusText = 'A shared space helps first';
    else if (!gate.dualConfirmed) {
      statusText = (action?.status === 'pending')
        ? `Waiting on Partner ${!action.partner1 ? '1' : '2'}`
        : 'Both partners need to be on board';
      canExpand = true;
    }

    return (
      <div className={`rounded-md overflow-hidden border-t border-r border-b border-slate-800/60 ${canExpand && action?.status === 'pending' ? 'border-l-2 border-l-amber-400/50' : 'border-l border-l-slate-800/60'}`}>
        <button onClick={() => canExpand && setExpanded(!expanded)}
          className={`w-full flex items-center justify-between px-4 py-3 ${canExpand ? 'hover:bg-slate-900/40 cursor-pointer' : 'cursor-default'} transition-colors`}
        >
          <div className="flex items-center gap-2.5">
            <Lock size={13} className="text-slate-600" />
            <span key={statusText} className="s-in text-xs text-slate-400 font-light">{statusText}</span>
          </div>
          {canExpand && <ChevronDown size={13} className={`text-slate-600 transition-transform ${expanded ? 'rotate-180' : ''}`} />}
        </button>

        {/* Expanded confirm widget — only when user taps */}
        {expanded && canExpand && (
          <div className="px-4 pb-4 border-t border-slate-800/40 pt-3">
            <DualConfirm actionId={actionId} type="messaging" targetId={profile.id} ttlMs={limits.MSG_TTL_MS} />
          </div>
        )}
      </div>
    );
  };

  // ── PREMIUM BANNER ──
  // Surfaces ONLY after hasCoordinated === true and user hasn't dismissed.
  // Appears as a quiet card at the bottom of the relevant view.
  // Never interrupts flow. Fully dismissible. No pressure language.
  const PremiumBanner = () => {
    if (!hasCoordinated || isPremium || foundingAccess || premiumDismissed) return null;
    return (
      <div className="mt-8 bg-slate-900/40 border border-slate-800/50 rounded-md p-5">
        <div className="flex justify-between items-start mb-3">
          <div className="flex items-center gap-2">
            <Star size={14} className="text-amber-400" strokeWidth={1.5} />
            <span className="text-xs text-amber-400 font-light tracking-wide">CONNECT PLUS</span>
          </div>
          <button onClick={() => setPremiumDismissed(true)} className="text-slate-600 hover:text-slate-400 transition-colors"><X size={14} /></button>
        </div>
        <p className="text-slate-400 text-sm font-light leading-relaxed mb-4">
          Want a little more room to plan and coordinate?
        </p>
        <div className="flex flex-wrap gap-2 mb-4">
          {['Longer message windows','Save conversations','Shared couple notes','Extended event visibility'].map((f,i) => (
            <span key={i} className="bg-slate-950/50 border border-slate-800 text-slate-500 px-2.5 py-1 rounded text-xs font-light">{f}</span>
          ))}
        </div>
        <button onClick={() => { setIsPremium(true); setPremiumDismissed(true); }}
          className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 py-2.5 rounded text-xs font-light tracking-wide transition-colors">
          See what's included
        </button>
      </div>
    );
  };

  // ── BOOKMARK PILL (profile detail, premium only) ──
  const BookmarkPill = ({ profileId }) => {
    const saved = bookmarks.has(profileId);
    if (isPremium || foundingAccess) {
      return (
        <button onClick={() => toggleBookmark(profileId)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-light transition-all ${
            saved ? 'bg-amber-400/15 text-amber-400 border border-amber-400/25' : 'bg-slate-900/50 text-slate-500 border border-slate-800 hover:border-slate-700'
          }`}>
          {saved ? <Bookmark size={13} fill="currentColor" /> : <Bookmark size={13} />}
          {saved ? 'Saved' : 'Save'}
        </button>
      );
    }
    // Free: show a muted lock pill. One tap → triggers premium banner if not already shown.
    return (
      <button onClick={() => setPremiumDismissed(false)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-light bg-slate-900/30 text-slate-600 border border-slate-800/50 cursor-default">
        <Lock size={11} /> Save
      </button>
    );
  };

  // ════════════════════════════════════════════════════════════
  // VIEWS
  // ════════════════════════════════════════════════════════════

  // ── LANDING ──
  const LandingPage = () => (
    <div className="min-h-screen bg-slate-950">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600&family=Inter:wght@300;400;500;600&display=swap');
        
        * { 
          font-family: 'Inter', sans-serif;
        }
        
        h1, h2, h3 { 
          font-family: 'Cormorant Garamond', serif;
          letter-spacing: -0.02em;
        }
        
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-4px); }
        }
        
        .s-in { 
          animation: fadeUp 400ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        
        .glass {
          background: rgba(15, 23, 42, 0.4);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(148, 163, 184, 0.1);
        }
        
        .glass-strong {
          background: rgba(15, 23, 42, 0.6);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(148, 163, 184, 0.15);
        }
        
        .gradient-text {
          background: linear-gradient(135deg, #fbbf24 0%, #fb923c 50%, #fbbf24 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        
        .gradient-border {
          position: relative;
        }
        
        .gradient-border::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: 1px;
          background: linear-gradient(135deg, rgba(251, 191, 36, 0.3), rgba(251, 146, 60, 0.3));
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
        }
        
        .btn-primary {
          background: linear-gradient(135deg, #fbbf24 0%, #fb923c 50%, #fbbf24 100%);
          background-size: 200% auto;
          transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
          box-shadow: 0 4px 20px rgba(251, 191, 36, 0.3), 0 0 40px rgba(251, 191, 36, 0.1);
        }
        
        .btn-primary:hover {
          background-position: right center;
          box-shadow: 0 6px 30px rgba(251, 191, 36, 0.4), 0 0 60px rgba(251, 191, 36, 0.15);
          transform: translateY(-1px);
        }
        
        .card-elevated {
          background: linear-gradient(135deg, rgba(30, 41, 59, 0.4) 0%, rgba(15, 23, 42, 0.6) 100%);
          backdrop-filter: blur(16px);
          border: 1px solid rgba(148, 163, 184, 0.08);
          box-shadow: 
            0 1px 3px rgba(0, 0, 0, 0.3),
            0 20px 40px rgba(0, 0, 0, 0.2),
            inset 0 1px 0 rgba(255, 255, 255, 0.03);
          transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }
        
        .card-elevated:hover {
          transform: translateY(-2px);
          box-shadow: 
            0 2px 6px rgba(0, 0, 0, 0.3),
            0 30px 60px rgba(0, 0, 0, 0.3),
            inset 0 1px 0 rgba(255, 255, 255, 0.05);
          border-color: rgba(251, 191, 36, 0.15);
        }
      `}</style>

      <header className="glass-strong sticky top-0 z-50 border-b border-slate-800/30">
        <div className="max-w-6xl mx-auto px-8 py-6 flex justify-between items-center">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 bg-gradient-to-br from-amber-400 via-rose-400 to-amber-500 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/20" style={{ animation: 'float 3s ease-in-out infinite' }}>
              <Heart className="text-slate-950" size={20} fill="currentColor" strokeWidth={0} />
            </div>
            <span className="text-xl font-light tracking-[0.15em] text-white">CONNECT</span>
          </div>
          <button onClick={() => setView('signup')} className="group relative px-6 py-2.5 rounded-lg border border-amber-400/20 text-amber-400 hover:bg-amber-400/5 transition-all text-xs tracking-[0.1em] font-medium overflow-hidden">
            <span className="relative z-10">JOIN</span>
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-400/10 to-transparent translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-1000"></div>
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-8 py-40 text-center">
        <div className="s-in mb-8">
          <h1 className="text-7xl md:text-8xl font-light text-white mb-8 leading-[0.95]" style={{ letterSpacing: '-0.03em' }}>
            Connection at<br />
            <span className="gradient-text italic font-normal">your own pace</span>
          </h1>
        </div>
        <div className="s-in mb-6" style={{ animationDelay: '100ms' }}>
          <p className="text-xl text-slate-300 mb-5 max-w-2xl mx-auto font-light leading-relaxed">
            A space for intentional ENM couples who value coordination over speed.
          </p>
        </div>
        <div className="s-in mb-16" style={{ animationDelay: '200ms' }}>
          <p className="text-base text-slate-400 max-w-xl mx-auto font-light leading-loose">
            Create your couple profile, join lounges, discover local places, and connect with others when you're both ready.
          </p>
        </div>
        <div className="s-in" style={{ animationDelay: '300ms' }}>
          <button onClick={() => setView('signup')} className="btn-primary text-slate-950 px-12 py-4 rounded-xl text-sm font-semibold tracking-[0.08em] inline-flex items-center gap-2">
            CREATE YOUR PROFILE
            <ChevronRight className="transition-transform group-hover:translate-x-1" size={16} />
          </button>
        </div>
      </div>

      {/* How it works — elegant three-step visual */}
      <div className="max-w-4xl mx-auto px-8 py-24 border-t border-slate-800/20">
        <div className="text-center mb-16">
          <p className="text-xs text-slate-500 font-medium mb-3 tracking-[0.2em]">HOW IT WORKS</p>
          <div className="w-12 h-px bg-gradient-to-r from-transparent via-amber-400/30 to-transparent mx-auto"></div>
        </div>
        <div className="space-y-6">
          {[
            { n: '01', title: 'Create your couple profile',    body: 'Enter both partners\' ages, pick your interests, and describe what you\'re open to. Takes about 3 minutes. You can edit it anytime.' },
            { n: '02', title: 'Join lounges & browse', body: 'Explore topic lounges like "Travel Couples" or "New to ENM". Browse other couples. Check out local places. Move at your own pace.' },
            { n: '03', title: 'Connect when you\'re both ready', body: 'When something feels right, express interest. Once you share a lounge or event, both partners confirm to unlock messaging.' }
          ].map((step, i) => (
            <div key={i} className="card-elevated rounded-2xl p-8 flex gap-8 items-start group">
              <div className="flex-shrink-0">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-400/10 to-rose-400/10 border border-amber-400/20 flex items-center justify-center group-hover:border-amber-400/40 transition-all">
                  <span className="text-2xl font-light text-amber-400" style={{ fontFamily: 'Cormorant Garamond, serif' }}>{step.n}</span>
                </div>
              </div>
              <div className="flex-1 pt-2">
                <h3 className="text-xl font-light text-white mb-3" style={{ fontFamily: 'Cormorant Garamond, serif', letterSpacing: '-0.01em' }}>{step.title}</h3>
                <p className="text-slate-400 text-sm font-light leading-loose">{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Three feelings, not features */}
      <div className="max-w-6xl mx-auto px-8 py-24 border-t border-slate-800/20">
        <div className="grid md:grid-cols-3 gap-8">
          {[
            { title: 'Together',   body: 'Every step involves both of you. Nothing happens alone.' },
            { title: 'Unhurried',  body: 'Things move when you\'re both ready. No pressure, no deadlines.' },
            { title: 'Low stakes', body: 'Browse, join spaces, take your time. Nothing commits you to anything.' }
          ].map((c,i) => (
            <div key={i} className="glass rounded-2xl p-8 text-center group hover:bg-slate-900/30 transition-all">
              <div className="w-1 h-12 bg-gradient-to-b from-amber-400/60 to-transparent mx-auto mb-6"></div>
              <h3 className="text-2xl font-light text-white mb-4" style={{ fontFamily: 'Cormorant Garamond, serif', letterSpacing: '-0.01em' }}>{c.title}</h3>
              <p className="text-slate-400 text-sm font-light leading-loose">{c.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Texture — a glimpse of what's inside */}
      <div className="max-w-5xl mx-auto px-8 py-16 border-t border-slate-800/30">
        <h2 className="text-2xl font-light text-white mb-3 text-center">Spaces to explore</h2>
        <p className="text-slate-500 text-sm font-light text-center mb-10 max-w-md mx-auto leading-relaxed">Topic lounges where couples with shared interests gather. Low-key, no obligations.</p>
        <div className="grid md:grid-cols-3 gap-4">
          {[
            { name: 'Travel Couples',   vibe: 'Adventurous & curious',        topics: ['Trip planning','Best couples resorts'] },
            { name: 'Social-Only',      vibe: 'Warm & platonic',              topics: ['Game nights','Book club'] },
            { name: 'Art & Culture',    vibe: 'Sophisticated & curious',      topics: ['Gallery openings','Theater season'] }
          ].map((l, i) => (
            <div key={i} className="bg-slate-900/15 border border-slate-800/25 rounded-md p-5">
              <h3 className="text-sm font-light text-white mb-1">{l.name}</h3>
              <p className="text-slate-600 text-xs font-light mb-3">{l.vibe}</p>
              <div className="flex flex-wrap gap-1.5">
                {l.topics.map((t, j) => <span key={j} className="bg-slate-950/50 border border-slate-800 text-slate-500 px-2 py-0.5 rounded text-xs font-light">{t}</span>)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <footer className="border-t border-slate-800/30 mt-8">
        <p className="text-center text-slate-600 text-xs font-light tracking-widest py-10">© 2026 CONNECT</p>
      </footer>
    </div>
  );

  // ── SIGNUP ──
  const SignupView = () => {
    const [city, setCity]   = useState('');
    const [state, setState] = useState('');
    // Token arrives via URL param in production.  Prototype: simulated via hidden state.
    // Users never see this field.  No prompt.  No explanation.
    const [token, setToken] = useState('');
    const ready = city.trim().length > 0 && state.length > 0;

    const handleSignup = () => {
      setUserLocation(deriveLocation(city, state));
      // If a token was provided, attempt to consume it.  Silent on failure.
      if (token.trim()) {
        const valid = consumeFoundingToken(token.trim());
        if (valid) setFoundingEligible(true);
      }
      setAccountActive(true);
      setView('profile-setup');
    };

    const US_STATES = [
      'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
      'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
      'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
      'VA','WA','WV','WI','WY'
    ];
    const CA_PROVINCES = ['AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT'];
    const ALL_STATES = [...US_STATES, ...CA_PROVINCES];

    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900/30 border border-slate-800/50 rounded-md p-10 text-center">
          <div className="w-14 h-14 bg-gradient-to-br from-amber-400 via-rose-400 to-amber-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <Heart className="text-slate-950" size={22} fill="currentColor" strokeWidth={0} />
          </div>
          <h2 className="text-2xl font-light text-white mb-3">Create your profile</h2>
          <p className="text-slate-500 text-sm font-light leading-relaxed mb-8">
            First, let us know where you're based. Then we'll help you set up your couple profile together.
          </p>

          {/* Location — quiet. One label, two inputs. No explanation. */}
          <div className="text-left mb-6">
            <p className="text-xs text-slate-600 font-light mb-2">Where are you based?</p>
            <div className="flex gap-2">
              <input type="text" placeholder="City" value={city} onChange={e => setCity(e.target.value)}
                className="flex-1 bg-slate-900/60 border border-slate-800 rounded px-3 py-2.5 text-sm text-white placeholder-slate-600 font-light focus:outline-none focus:border-slate-600 transition-colors" />
              <select value={state} onChange={e => setState(e.target.value)}
                className="w-20 bg-slate-900/60 border border-slate-800 rounded px-2 py-2.5 text-sm text-white font-light focus:outline-none focus:border-slate-600 transition-colors appearance-none cursor-pointer"
                style={{ backgroundImage: 'none' }}>
                <option value="" disabled className="bg-slate-900 text-slate-500">State</option>
                {ALL_STATES.map(s => <option key={s} value={s} className="bg-slate-900 text-slate-300">{s}</option>)}
              </select>
            </div>
          </div>

          {/* Invite token — invisible in production (URL param).  Shown here only for prototype testability. */}
          <div className="text-left mb-4">
            <p className="text-xs text-slate-600 font-light mb-1">Invite code <span className="text-slate-700">(optional)</span></p>
            <input type="text" placeholder="If you have one" value={token} onChange={e => setToken(e.target.value)}
              className="w-full bg-slate-900/40 border border-slate-800/60 rounded px-3 py-2 text-xs text-slate-400 placeholder-slate-700 font-light focus:outline-none focus:border-slate-600 transition-colors" />
          </div>

          <button onClick={handleSignup}
            disabled={!ready}
            className={`w-full py-3 rounded text-sm font-medium tracking-wide transition-all ${
              ready
                ? 'bg-gradient-to-r from-amber-400 to-rose-400 text-slate-950'
                : 'bg-slate-800/50 text-slate-600 cursor-default'
            }`}>
            Get Started
          </button>
          <button onClick={() => setView('landing')} className="block w-full mt-3 text-slate-600 hover:text-slate-400 text-xs font-light transition-colors">← Back</button>
        </div>
      </div>
    );
  };

  // ── PROFILE SETUP (multi-step guided flow) ──
  const ProfileSetupView = () => {
    const [step, setStep] = useState(1);
    const [names, setNames]       = useState(myProfile?.names || '');
    const [ageA, setAgeA]         = useState(myProfile?.partnerA?.age || '');
    const [ageB, setAgeB]         = useState(myProfile?.partnerB?.age || '');
    const [bio, setBio]           = useState(myProfile?.bio || '');
    const [structure, setStructure] = useState(myProfile?.relationshipStructure || '');
    const [experience, setExperience] = useState(myProfile?.experienceLevel || '');
    const [pace, setPace]         = useState(myProfile?.pacePreference || '');
    const [autonomy, setAutonomy] = useState(myProfile?.autonomyStance || '');
    const [intent, setIntent]     = useState(myProfile?.primaryIntent || '');
    const [interests, setInterests] = useState(new Set(myProfile?.interests || []));

    // Travel window local state
    const [showTravel, setShowTravel]       = useState(!!travelWindow);
    const [travelCity, setTravelCity]       = useState(travelWindow?.city || '');
    const [travelState, setTravelState]     = useState(travelWindow?.state || '');
    const [travelArrival, setTravelArrival] = useState(travelWindow?.arrival || '');
    const [travelDepart, setTravelDepart]   = useState(travelWindow?.departure || '');

    const STRUCTURES   = ['Open','ENM','Poly-leaning','Exploring'];
    const EXPERIENCES  = ['New','Some experience','Established'];
    const PACES        = ['Very slow','Social-first','Open to meeting'];
    const AUTONOMIES   = ['Couple-first','Mixed, discussed intentionally','Autonomy-forward'];

    const INTEREST_GROUPS = [
      { label: 'Social & Lifestyle', items: ['Travel','Live music','Art & culture','Food & dining','Hosting dinners'] },
      { label: 'Outdoor & Active',   items: ['Outdoor adventures','Fitness & wellness','Cycling','Swimming','Golf'] },
      { label: 'Connection & Time',  items: ['Deep conversation','Reading together','Board games','Museums & art','Wellness'] },
    ];
    const INTEREST_CAP = 7;

    const toggleInterest = (i) => setInterests(prev => {
      const n = new Set(prev);
      if (n.has(i)) { n.delete(i); return n; }
      if (n.size >= INTEREST_CAP) return prev;
      n.add(i);
      return n;
    });

    const handleSave = () => {
      const loc = userLocation ? `${userLocation.city}, ${userLocation.state}` : '';
      setMyProfile({
        id: 999,
        names: names || 'Your names',
        partnerA: { age: parseInt(ageA) || 0 },
        partnerB: { age: parseInt(ageB) || 0 },
        location: loc,
        bio,
        interests: [...interests],
        trustLevel: 1,
        trustSignals: { id: false, relationship: true, alignment: !!structure, community: false },
        reputation: [],
        relationshipStructure: structure,
        experienceLevel: experience,
        pacePreference: pace,
        autonomyStance: autonomy,
        primaryIntent: intent,
        sharedLounges: [],
        sharedEvents: [],
        isOwn: true,
        softSignals: ['New to the community']
      });
      if (showTravel && travelCity.trim() && travelArrival && travelDepart) {
        setTravelWindow({ city: travelCity.trim(), state: travelState, arrival: travelArrival, departure: travelDepart });
      } else {
        setTravelWindow(null);
      }
      setView('browse');
    };

    const stepReady = {
      1: names.trim().length > 0,
      2: true, // all optional
      3: true, // all optional
      4: true  // preview — always ready
    };

    // ── STEP COPY ──
    const STEP_META = [
      { title: 'About you',           sub: 'The basics. Nothing here commits you to anything.' },
      { title: 'What you\'re open to', sub: 'This just helps others understand how you move through connection.' },
      { title: 'Interests & vibes',   sub: 'Pick what feels right. You can always change this later.' },
      { title: 'Take a look',         sub: 'This is how others will see your profile.' }
    ];

    // ── PROGRESS BAR ──
    const ProgressBar = () => (
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-slate-600 font-light">Step {step} of 4</span>
          {step > 1 && <button onClick={() => setStep(s => s - 1)} className="text-xs text-slate-500 hover:text-slate-300 font-light transition-colors">← Back</button>}
        </div>
        <div className="flex gap-1">
          {[1,2,3,4].map(n => (
            <div key={n} className={`h-0.5 flex-1 rounded-full transition-all ${n <= step ? 'bg-amber-400/60' : 'bg-slate-800'}`} />
          ))}
        </div>
      </div>
    );

    // ── NEXT BUTTON ──
    const NextButton = ({ label, onClick, disabled }) => (
      <button onClick={onClick} disabled={disabled}
        className={`w-full py-3 rounded text-sm font-medium tracking-wide transition-all ${
          !disabled ? 'bg-gradient-to-r from-amber-400 to-rose-400 text-slate-950' : 'bg-slate-800/50 text-slate-600 cursor-default'
        }`}>
        {label}
      </button>
    );

    // ════════════════
    // STEP 1: ABOUT YOU
    // ════════════════
    const Step1 = () => (
      <div>
        <div className="mb-6">
          <label className="text-xs text-slate-500 font-light mb-2 block">Couple names <span className="text-amber-400/60">*</span></label>
          <input type="text" placeholder="e.g. Alex & Jordan" value={names} onChange={e => setNames(e.target.value)}
            className="w-full bg-slate-900/60 border border-slate-800 rounded px-4 py-3 text-sm text-white placeholder-slate-600 font-light focus:outline-none focus:border-slate-600 transition-colors" />
        </div>

        <div className="mb-6">
          <label className="text-xs text-slate-500 font-light mb-2 block">Ages</label>
          <div className="flex gap-3 items-center">
            <input type="number" placeholder="28" min="25" max="75" value={ageA} onChange={e => setAgeA(e.target.value)}
              className="flex-1 bg-slate-900/60 border border-slate-800 rounded px-4 py-2.5 text-sm text-white placeholder-slate-600 font-light focus:outline-none focus:border-slate-600 transition-colors" />
            <span className="text-slate-600 text-sm font-light">&</span>
            <input type="number" placeholder="30" min="25" max="75" value={ageB} onChange={e => setAgeB(e.target.value)}
              className="flex-1 bg-slate-900/60 border border-slate-800 rounded px-4 py-2.5 text-sm text-white placeholder-slate-600 font-light focus:outline-none focus:border-slate-600 transition-colors" />
          </div>
        </div>

        <div className="mb-6">
          <label className="text-xs text-slate-500 font-light mb-2 block">About you</label>
          <textarea placeholder="A few sentences about who you are. No pressure to say everything." value={bio} onChange={e => setBio(e.target.value)} rows={3}
            className="w-full bg-slate-900/60 border border-slate-800 rounded px-4 py-3 text-sm text-white placeholder-slate-600 font-light leading-relaxed resize-none focus:outline-none focus:border-slate-600 transition-colors" />
          <p className="text-xs text-slate-700 font-light mt-1">{bio.length}/500</p>
        </div>

        <div className="mb-6">
          <label className="text-xs text-slate-500 font-light mb-3 block">A little about your relationship</label>
          <div className="space-y-3">
            {[
              ['Relationship style', STRUCTURES, structure, setStructure],
              ['Experience level',   EXPERIENCES, experience, setExperience],
              ['Pace preference',    PACES,       pace,       setPace],
            ].map(([label, options, value, setter]) => (
              <div key={label}>
                <p className="text-xs text-slate-600 font-light mb-1">{label}</p>
                <select value={value} onChange={e => setter(e.target.value)}
                  className="w-full bg-slate-900/60 border border-slate-800 rounded px-3 py-2.5 text-sm text-white font-light focus:outline-none focus:border-slate-600 transition-colors appearance-none cursor-pointer"
                  style={{ backgroundImage: 'none' }}>
                  <option value="" disabled className="bg-slate-900 text-slate-500">Select…</option>
                  {options.map(o => <option key={o} value={o} className="bg-slate-900 text-slate-300">{o}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>

        {/* Travel window — opt-in, quiet, at bottom of step 1 */}
        <div className="mb-6 pt-5 border-t border-slate-800/40">
          <button onClick={() => setShowTravel(!showTravel)}
            className="w-full flex items-center justify-between text-left">
            <div className="flex items-center gap-2.5">
              <Plane size={14} className={showTravel ? 'text-amber-400' : 'text-slate-600'} />
              <span className={`text-xs font-light ${showTravel ? 'text-slate-300' : 'text-slate-500'}`}>Planning a visit?</span>
            </div>
            <ChevronDown size={13} className={`text-slate-600 transition-transform ${showTravel ? 'rotate-180' : ''}`} />
          </button>
          <p className="text-xs text-slate-600 font-light mt-1 ml-6">Let people know you'll be around ahead of time.</p>
          {showTravel && (
            <div className="mt-4 space-y-3">
              <div className="flex gap-2">
                <input type="text" placeholder="City" value={travelCity} onChange={e => setTravelCity(e.target.value)}
                  className="flex-1 bg-slate-900/60 border border-slate-800 rounded px-3 py-2 text-xs text-white placeholder-slate-600 font-light focus:outline-none focus:border-slate-600 transition-colors" />
                <select value={travelState} onChange={e => setTravelState(e.target.value)}
                  className="w-16 bg-slate-900/60 border border-slate-800 rounded px-2 py-2 text-xs text-white font-light focus:outline-none focus:border-slate-600 transition-colors appearance-none cursor-pointer"
                  style={{ backgroundImage: 'none' }}>
                  <option value="" disabled className="bg-slate-900 text-slate-500">St</option>
                  {['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT'].map(s => <option key={s} value={s} className="bg-slate-900 text-slate-300">{s}</option>)}
                </select>
              </div>
              <div className="flex gap-2 items-center">
                <input type="date" value={travelArrival} onChange={e => setTravelArrival(e.target.value)}
                  className="flex-1 bg-slate-900/60 border border-slate-800 rounded px-3 py-2 text-xs text-white font-light focus:outline-none focus:border-slate-600 transition-colors" />
                <span className="text-slate-600 text-xs">→</span>
                <input type="date" value={travelDepart} onChange={e => setTravelDepart(e.target.value)}
                  className="flex-1 bg-slate-900/60 border border-slate-800 rounded px-3 py-2 text-xs text-white font-light focus:outline-none focus:border-slate-600 transition-colors" />
              </div>
            </div>
          )}
        </div>

        <NextButton label={stepReady[1] ? 'Continue' : 'Add your names to continue'} onClick={() => setStep(2)} disabled={!stepReady[1]} />
      </div>
    );

    // ════════════════════════
    // STEP 2: WHAT YOU'RE OPEN TO
    // ════════════════════════
    const Step2 = () => (
      <div>
        {/* Intent framing */}
        <div className="mb-8">
          <label className="text-xs text-slate-500 font-light mb-1 block">What are you open to right now?</label>
          <p className="text-xs text-slate-600 font-light mb-4">This helps show you people who are aligned. Nothing is locked in — you can change it anytime.</p>
          <div className="space-y-2">
            {[
              { value: 'Friendship & social connection',            icon: Coffee,   desc: 'Lounges, events, hanging out' },
              { value: 'Conversation & getting to know each other', icon: Sparkles, desc: 'Getting to know each other first' },
              { value: 'Open to meeting in person',                 icon: Heart,    desc: 'When the time feels right' }
            ].map(opt => {
              const Icon = opt.icon;
              const sel = intent === opt.value;
              return (
                <button key={opt.value} onClick={() => setIntent(opt.value)}
                  className={`w-full flex items-center gap-3 p-3 rounded border text-left transition-all ${
                    sel ? 'bg-amber-400/10 border-amber-400/30' : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
                  }`}>
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${sel ? 'bg-amber-400/20' : 'bg-slate-800'}`}>
                    <Icon size={16} className={sel ? 'text-amber-400' : 'text-slate-500'} />
                  </div>
                  <div>
                    <p className={`text-xs font-light ${sel ? 'text-white' : 'text-slate-300'}`}>{opt.value}</p>
                    <p className="text-xs text-slate-600 font-light">{opt.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Autonomy stance */}
        <div className="mb-6">
          <label className="text-xs text-slate-500 font-light mb-1 block">How do you navigate autonomy as a couple?</label>
          <p className="text-xs text-slate-600 font-light mb-3">No wrong answer. This just helps us show you compatible profiles.</p>
          <div className="space-y-2">
            {AUTONOMIES.map(opt => {
              const sel = autonomy === opt;
              return (
                <button key={opt} onClick={() => setAutonomy(opt)}
                  className={`w-full text-left px-4 py-3 rounded border transition-all ${
                    sel ? 'bg-amber-400/10 border-amber-400/30' : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
                  }`}>
                  <p className={`text-xs font-light ${sel ? 'text-white' : 'text-slate-300'}`}>{opt}</p>
                </button>
              );
            })}
          </div>
        </div>

        <NextButton label="Continue" onClick={() => setStep(3)} disabled={false} />
      </div>
    );

    // ════════════════════════
    // STEP 3: INTERESTS & VIBES
    // ════════════════════════
    const Step3 = () => (
      <div>
        <div className="mb-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-slate-500 font-light block">Pick what resonates</label>
            <span className={`text-xs font-light ${interests.size >= INTEREST_CAP ? 'text-amber-400/50' : 'text-slate-600'}`}>
              {interests.size}/{INTEREST_CAP}
            </span>
          </div>
          <p className="text-xs text-slate-600 font-light mt-1 mb-5">Choose up to 7. These help others see if you'd enjoy time together.</p>
        </div>
        <div className="space-y-5 mb-8">
          {INTEREST_GROUPS.map(group => (
            <div key={group.label}>
              <p className="text-xs text-slate-600 font-light mb-2">{group.label}</p>
              <div className="flex flex-wrap gap-2">
                {group.items.map(i => {
                  const sel = interests.has(i);
                  const atCap = interests.size >= INTEREST_CAP && !sel;
                  return (
                    <button key={i} onClick={() => toggleInterest(i)}
                      className={`px-3 py-1.5 rounded text-xs font-light transition-all ${
                        sel ? 'bg-amber-400/15 text-amber-400 border border-amber-400/25'
                            : atCap ? 'bg-slate-900/30 text-slate-600 border border-slate-800/50 cursor-default'
                            : 'bg-slate-900/50 text-slate-500 border border-slate-800 hover:border-slate-700'
                      }`}>{i}</button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <NextButton label="Continue" onClick={() => setStep(4)} disabled={false} />
      </div>
    );

    // ════════════════════════
    // STEP 4: PREVIEW
    // ════════════════════════
    const Step4 = () => {
      const loc = userLocation ? `${userLocation.city}, ${userLocation.state}` : '';
      const previewProfile = {
        names: names || 'Your names',
        partnerA: { age: parseInt(ageA) || 0 },
        partnerB: { age: parseInt(ageB) || 0 },
        location: loc, bio,
        interests: [...interests], pacePreference: pace, experienceLevel: experience,
        relationshipStructure: structure, primaryIntent: intent, autonomyStance: autonomy,
        trustLevel: 1, trustSignals: { id: false, relationship: true, alignment: !!structure, community: false },
        reputation: []
      };
      
      const ageDisplay = (previewProfile.partnerA.age && previewProfile.partnerB.age)
        ? `${previewProfile.partnerA.age} & ${previewProfile.partnerB.age}`
        : '';

      return (
        <div>
          <p className="text-xs text-slate-600 font-light mb-6 text-center">This is exactly how other couples will see you.</p>

          {/* Preview card — mirrors browse card layout precisely */}
          <div className="bg-slate-900/25 border border-amber-400/20 rounded-md overflow-hidden mb-8">
            <div className="bg-gradient-to-br from-slate-800 to-slate-900 h-40 flex items-center justify-center relative">
              <span className="text-5xl opacity-15">👫</span>
              <div className="absolute top-3 right-3"><TrustDots level={previewProfile.trustLevel} compact /></div>
            </div>
            <div className="p-5">
              <h3 className="text-sm font-light text-white mb-0.5">{previewProfile.names}</h3>
              <p className="text-slate-600 text-xs font-light mb-3">
                {[ageDisplay, previewProfile.location, previewProfile.pacePreference, previewProfile.experienceLevel].filter(Boolean).join(' · ')}
              </p>
              {previewProfile.bio && <p className="text-slate-500 text-xs font-light leading-loose mb-3">{previewProfile.bio}</p>}
              {previewProfile.interests.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {previewProfile.interests.map((i,idx) => <span key={idx} className="bg-slate-950/50 border border-slate-800 text-slate-500 px-2 py-0.5 rounded text-xs font-light">{i}</span>)}
                </div>
              )}
              {/* Alignment summary line */}
              <div className="pt-3 border-t border-slate-800/30 mt-2">
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {previewProfile.relationshipStructure && <p className="text-xs text-slate-600 font-light"><span className="text-slate-700">Style</span> · {previewProfile.relationshipStructure}</p>}
                  {previewProfile.primaryIntent && <p className="text-xs text-slate-600 font-light"><span className="text-slate-700">Open to</span> · {previewProfile.primaryIntent}</p>}
                </div>
              </div>
            </div>
          </div>

          {/* Travel badge preview if set */}
          {showTravel && travelCity.trim() && (
            <div className="flex items-center gap-1.5 mb-4 px-2">
              <Plane size={11} className="text-amber-400/70" />
              <span className="text-xs text-amber-400/70 font-light">Visiting {travelCity.trim()} · {travelArrival || '?'} – {travelDepart || '?'}</span>
            </div>
          )}

          <NextButton label="Looks good. Start browsing." onClick={handleSave} disabled={false} />
        </div>
      );
    };

    // ════════════════════════
    // MAIN RENDER
    // ════════════════════════
    return (
      <div className="min-h-screen bg-slate-950">
        <div className="max-w-xl mx-auto px-6 py-12">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-12 h-12 bg-gradient-to-br from-amber-400 via-rose-400 to-amber-500 rounded-full flex items-center justify-center mx-auto mb-5">
              <Heart className="text-slate-950" size={20} fill="currentColor" strokeWidth={0} />
            </div>
            <h2 className="text-2xl font-light text-white mb-1">{STEP_META[step-1].title}</h2>
            <p className="text-slate-500 text-sm font-light leading-relaxed max-w-sm mx-auto">
              {STEP_META[step-1].sub}
            </p>
          </div>

          <ProgressBar />

          {step === 1 && <Step1 />}
          {step === 2 && <Step2 />}
          {step === 3 && <Step3 />}
          {step === 4 && <Step4 />}

          {/* Skip — only on step 1, quiet */}
          {step === 1 && (
            <button onClick={() => {
              setMyProfile({ id: 999, names: '', partnerA: { age: 0 }, partnerB: { age: 0 }, location: userLocation ? `${userLocation.city}, ${userLocation.state}` : '', bio: '', interests: [], trustLevel: 1, trustSignals: { id: false, relationship: false, alignment: false, community: false }, reputation: [], relationshipStructure: '', experienceLevel: '', pacePreference: '', autonomyStance: '', primaryIntent: '', sharedLounges: [], sharedEvents: [], isOwn: true, softSignals: [] });
              setView('browse');
            }}
              className="w-full mt-3 py-2.5 text-slate-500 hover:text-slate-300 text-xs font-light transition-colors">
              Skip for now
            </button>
          )}
        </div>
      </div>
    );
  };

  // ── BROWSE ──
  const BrowseView = () => {
    const [tab, setTab] = useState('lounges');

    if (!accountActive) {
      return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
          <div className="max-w-md bg-slate-900/30 border border-slate-800/50 rounded-md p-10 text-center">
            <Lock className="text-amber-400 mx-auto mb-5" size={32} strokeWidth={1} />
            <h2 className="text-xl font-light text-white mb-6">Set up your account first</h2>
            <button onClick={() => setView('signup')} className="bg-gradient-to-r from-amber-400 to-rose-400 text-slate-950 px-6 py-2.5 rounded text-sm font-medium">Continue</button>
          </div>
        </div>
      );
    }

    // Account active but profile not yet built → nudge them there
    if (!myProfile) {
      return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
          <div className="max-w-md bg-slate-900/30 border border-slate-800/50 rounded-md p-10 text-center">
            <Users className="text-amber-400 mx-auto mb-5" size={32} strokeWidth={1} />
            <h2 className="text-xl font-light text-white mb-3">One more thing</h2>
            <p className="text-slate-500 text-sm font-light mb-6">Build your profile so other couples can find you.</p>
            <button onClick={() => setView('profile-setup')} className="bg-gradient-to-r from-amber-400 to-rose-400 text-slate-950 px-6 py-2.5 rounded text-sm font-medium">Set up profile</button>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-slate-950">
        <header className="glass-strong sticky top-0 z-50 border-b border-slate-800/20">
          <div className="max-w-6xl mx-auto px-8 py-6">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 bg-gradient-to-br from-amber-400 via-rose-400 to-amber-500 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/20" style={{ animation: 'float 3s ease-in-out infinite' }}>
                  <Heart className="text-slate-950" size={20} fill="currentColor" strokeWidth={0} />
                </div>
                <span className="text-xl font-light tracking-[0.15em] text-white">CONNECT</span>
              </div>
              <div className="flex items-center gap-5">
                <span className={`text-xs font-medium transition-colors ${interestsSent.size >= limits.INTEREST_LIMIT ? 'text-amber-400/50' : 'text-slate-500'}`}>
                  {interestsSent.size}/{limits.INTEREST_LIMIT}
                </span>
                <button onClick={() => { setSelectedProfileId(999); setView('profile'); }}
                  className="flex items-center gap-2 text-slate-400 hover:text-white transition-all group">
                  <Pencil size={15} strokeWidth={1.5} className="group-hover:rotate-12 transition-transform" />
                  <span className="text-xs font-light">Profile</span>
                </button>
                <button onClick={() => setView('messages')} className="relative text-slate-400 hover:text-white transition-colors">
                  <MessageCircle size={22} strokeWidth={1.5} />
                </button>
              </div>
            </div>
            <div className="flex gap-8 border-b border-slate-800/30">
              {['lounges','events','places','profiles'].map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`pb-4 text-xs font-medium tracking-[0.12em] transition-all relative ${
                    tab === t ? 'text-white' : 'text-slate-500 hover:text-slate-300'
                  }`}>
                  {t.toUpperCase()}
                  {tab === t && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-amber-400 to-rose-400 rounded-full"></div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="max-w-6xl mx-auto px-8 py-10">

          {/* ─── FOUNDING ACKNOWLEDGMENT (one-time, private, auto-dismissing) ─── */}
          {foundingAccess && !foundingAcknowledged && (
            <div className="s-in mb-6 flex items-center justify-between py-3 px-4 bg-slate-900/40 border border-slate-800/50 rounded-md">
              <p className="text-slate-400 text-xs font-light">
                Thanks for helping shape the early community. You have full access to coordination features.
              </p>
              <button onClick={() => setFoundingAcknowledged(true)} className="text-slate-600 hover:text-slate-400 transition-colors flex-shrink-0 ml-4">
                <X size={13} />
              </button>
            </div>
          )}

          {/* ─── LOUNGES ─── */}
          {tab === 'lounges' && (
            <div>
              <h2 className="text-xl font-light text-white mb-2">Lounges</h2>
              <p className="text-slate-500 text-xs font-light leading-loose mb-6">Everything here is opt-in. Browse quietly, join spaces, and move only when you're both ready.</p>
              <div className="space-y-3">
                {LOUNGE_DATA.map(lounge => {
                  const joined = loungesJoined.has(lounge.id);
                  return (
                    <div key={lounge.id} onClick={() => { setSelectedLoungeId(lounge.id); setView('lounge'); }}
                      className="bg-slate-900/25 border border-slate-800/40 rounded-md p-5 hover:border-amber-400/20 transition-all cursor-pointer">
                      <div className="flex justify-between items-center">
                        <div className="flex-1 pr-4">
                          <div className="flex items-center gap-3 mb-1">
                            <h3 className="text-base font-light text-white">{lounge.name}</h3>
                            <span className="text-xs text-slate-600 font-light">{lounge.vibe}</span>
                          </div>
                          <div className="flex gap-3 text-xs text-slate-600">
                            <span className="flex items-center gap-1"><Users size={11} />{lounge.members}</span>
                            <span className="flex items-center gap-1"><Activity size={11} />{lounge.activity}</span>
                          </div>
                          <p className="text-xs text-slate-700 font-light mt-1">{lounge.activitySignal}</p>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); toggleLounge(lounge.id); }}
                          className={`px-4 py-1.5 rounded text-xs font-light transition-all whitespace-nowrap ${
                            joined ? 'bg-amber-400/15 text-amber-400 border border-amber-400/25' : 'bg-slate-950/50 text-slate-500 border border-slate-800 hover:border-slate-700'
                          }`}>
                          {joined ? 'Joined' : 'Join'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <PremiumBanner />
            </div>
          )}

          {/* ─── EVENTS ─── */}
          {tab === 'events' && (
            <div>
              <h2 className="text-xl font-light text-white mb-2">Events</h2>
              <p className="text-slate-500 text-xs font-light leading-loose mb-6">Attend together when you're both ready. Nothing commits you until both partners confirm.</p>
              {EVENT_DATA.filter(event => isEventVisible(event, userLocation, scope, crossBorder)).length === 0 && (
                <div className="bg-slate-900/20 border border-slate-800/30 rounded-md p-8 text-center">
                  <p className="text-slate-600 text-sm font-light mb-1">No events near you yet.</p>
                  <p className="text-slate-700 text-xs font-light">That's normal. Most connections here start in lounges.</p>
                </div>
              )}
              <div className="space-y-3">
                {EVENT_DATA
                  .filter(event => isEventVisible(event, userLocation, scope, crossBorder))
                  .map(event => {
                  const actionId  = `rsvp-${event.id}`;
                  const action    = getAction(actionId);
                  const confirmed = action?.status === 'confirmed';
                  return (
                    <div key={event.id} onClick={() => { setSelectedEventId(event.id); setView('event'); }}
                      className="bg-slate-900/25 border border-slate-800/40 rounded-md p-5 hover:border-amber-400/20 transition-all cursor-pointer">
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="text-base font-light text-white">{event.title}</h3>
                        <div className="flex items-center gap-2">
                          {event.type === 'travel' && <span className="bg-slate-800/60 border border-slate-700 text-slate-400 px-2 py-0.5 rounded text-xs font-light">Travel event</span>}
                          {event.paid && <span className="bg-amber-400/10 border border-amber-400/25 text-amber-400 px-2 py-0.5 rounded text-xs font-light">Ticketed · ${event.price}</span>}
                          {confirmed && <Check size={14} className="text-amber-400" />}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-slate-600 mb-2">
                        <span className="flex items-center gap-1"><Calendar size={11} />{event.date} {event.time}</span>
                        <span className="flex items-center gap-1"><MapPin size={11} />{event.venue}</span>
                        <span className="flex items-center gap-1"><Users size={11} />{event.existingRSVPs.length}/{event.maxAttendees}</span>
                      </div>
                      <p className="text-slate-500 text-xs font-light leading-loose line-clamp-1">{event.description}</p>
                      {event.existingRSVPs.length > 0 && (
                        <p className="text-xs text-slate-700 font-light mt-1.5">Couples like you are attending</p>
                      )}
                    </div>
                  );
                })}
              </div>
              <PremiumBanner />
            </div>
          )}

          {/* ─── PLACES ─── */}
          {tab === 'places' && (
            <div>
              <h2 className="text-xl font-light text-white mb-2">Places</h2>
              <p className="text-slate-500 text-xs font-light leading-loose mb-6">Some couples like knowing where others tend to gather. Others just browse.</p>

              <div className="space-y-3">
                {PLACES_DATA
                  .filter(place => place.city === userLocation.city && place.state === userLocation.state)
                  .map(place => {
                    const liked = placeLikes.has(place.id);
                    const presence = placePresence.get(place.id);
                    const pendingPresence = placePendingPresence.get(place.id);

                    // Auto-filter expired presence (crude: assume "today" expires at 6pm, "tonight" expires at 3am next day)
                    const now = new Date();
                    const currentHour = now.getHours();
                    const todayExpired = presence?.slot === 'today' && currentHour >= 18;
                    const tonightExpired = presence?.slot === 'tonight' && currentHour >= 3 && currentHour < 18;
                    const presenceActive = presence && !todayExpired && !tonightExpired;

                    // Calculate fuzzy counts (baseline + user presence if active)
                    const todayCount = place.presenceCountToday + (presenceActive && presence.slot === 'today' ? 1 : 0);
                    const tonightCount = place.presenceCountTonight + (presenceActive && presence.slot === 'tonight' ? 1 : 0);

                    return (
                      <div key={place.id} className="bg-slate-900/25 border border-slate-800/40 rounded-md p-5">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex-1">
                            <h3 className="text-base font-light text-white mb-0.5">{place.name}</h3>
                            <p className="text-slate-600 text-xs font-light mb-2">{place.category} · {place.city}</p>
                          </div>
                          <button onClick={() => togglePlaceLike(place.id)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-light transition-all ${
                              liked ? 'bg-amber-400/15 text-amber-400 border border-amber-400/25' : 'bg-slate-950/50 text-slate-500 border border-slate-800 hover:border-slate-700'
                            }`}>
                            <Star size={11} className={liked ? 'fill-amber-400' : ''} />
                            {liked ? 'Liked' : 'Like'}
                          </button>
                        </div>

                        <p className="text-slate-500 text-xs font-light leading-relaxed mb-3">{place.description}</p>

                        {/* Vibe tags */}
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          {place.vibe.map((v,i) => <span key={i} className="bg-slate-950/50 border border-slate-800 text-slate-600 px-2 py-0.5 rounded text-xs font-light">{v}</span>)}
                        </div>

                        {/* Ambient counts — fuzzy, aggregate, no "now" language */}
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs text-slate-700 font-light">
                          {place.likedCount > 0 && <span>{place.likedCount} couples like this place</span>}
                          {todayCount > 0 && <span>{todayCount} {todayCount === 1 ? 'couple' : 'couples'} might be there today</span>}
                          {tonightCount > 0 && <span>{tonightCount} {tonightCount === 1 ? 'couple' : 'couples'} might be there tonight</span>}
                        </div>

                        {/* Presence actions — lightweight dual-partner flow */}
                        {!presenceActive && !pendingPresence && (
                          <div className="flex gap-2">
                            <button onClick={() => draftPlacePresence(place.id, 'today', 'partner1')}
                              className="flex-1 py-2 rounded text-xs font-light bg-slate-950/40 text-slate-500 border border-slate-800 hover:border-slate-700 transition-all">
                              We might be there today
                            </button>
                            <button onClick={() => draftPlacePresence(place.id, 'tonight', 'partner1')}
                              className="flex-1 py-2 rounded text-xs font-light bg-slate-950/40 text-slate-500 border border-slate-800 hover:border-slate-700 transition-all">
                              We might be there tonight
                            </button>
                          </div>
                        )}

                        {/* Pending partner confirmation */}
                        {pendingPresence && (
                          <div className="s-in flex items-center justify-between py-2 px-3 bg-slate-950/40 border-l-2 border-l-amber-400/50 border-t border-r border-b border-slate-800/40 rounded">
                            <span className="text-xs text-slate-500 font-light">Waiting on partner · {pendingPresence.slot}</span>
                            <div className="flex gap-2">
                              <button onClick={() => confirmPlacePresence(place.id, pendingPresence.draftedBy === 'partner1' ? 'partner2' : 'partner1')}
                                className="px-3 py-1 rounded text-xs font-light bg-amber-400/15 text-amber-400 border border-amber-400/25 transition-all">
                                Looks good
                              </button>
                              <button onClick={() => cancelPlacePresenceDraft(place.id)}
                                className="px-3 py-1 rounded text-xs text-slate-600 hover:text-slate-400 font-light transition-colors">
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Active presence indicator */}
                        {presenceActive && (
                          <div className="s-in flex items-center gap-2 py-2 px-3 bg-amber-400/8 border-t border-r border-b border-amber-400/20 border-l-2 border-l-amber-400/50 rounded-md">
                            <Check size={13} className="text-amber-400" />
                            <span className="text-xs text-amber-400 font-light">You might be there {presence.slot}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
              <PremiumBanner />
            </div>
          )}

          {/* ─── PROFILES ─── */}
          {tab === 'profiles' && (
            <div>
              {/* Scope selector — quiet single line. Only on profiles, not lounges or events. */}
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xl font-light text-white">Couples</h2>
                <select value={scope} onChange={e => { setScope(e.target.value); if (e.target.value !== 'travel') setCrossBorder(false); }}
                  className="bg-slate-900/50 border border-slate-800 rounded px-3 py-1.5 text-xs text-slate-400 font-light focus:outline-none focus:border-slate-600 transition-colors appearance-none cursor-pointer"
                  style={{ backgroundImage: 'none' }}>
                  {Object.entries(SCOPE_LABELS).map(([k,v]) => <option key={k} value={k} className="bg-slate-900 text-slate-300">{v}</option>)}
                </select>
              </div>
              <p className="text-slate-500 text-xs font-light leading-loose mb-4">Browse at your own pace. Express interest only when something feels right — nothing happens until you're both ready.</p>
              {/* Cross-border opt-in — only surfaces when travel is active */}
              {scope === 'travel' && (
                <div className="flex items-center gap-2.5 mb-5">
                  <button onClick={() => setCrossBorder(!crossBorder)}
                    className={`w-8 h-4.5 rounded-full relative transition-colors flex-shrink-0 ${crossBorder ? 'bg-amber-400/40' : 'bg-slate-800'}`}>
                    <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-slate-300 shadow transition-transform ${crossBorder ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                  <span className="text-xs text-slate-500 font-light">Include couples across the border</span>
                </div>
              )}

              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Own profile — shown first if names have been set */}
                {myProfile && myProfile.names && (
                  <div onClick={() => setView('profile-setup')}
                    className="bg-slate-900/25 border border-amber-400/20 rounded-md overflow-hidden hover:border-amber-400/40 transition-all cursor-pointer relative">
                    <div className="absolute top-3 left-3 z-10">
                      <span className="bg-slate-950/80 border border-amber-400/30 text-amber-400 px-2 py-0.5 rounded text-xs font-light">You</span>
                    </div>
                    <div className="bg-gradient-to-br from-slate-800 to-slate-900 h-40 flex items-center justify-center relative">
                      <span className="text-5xl opacity-15">👫</span>
                      <div className="absolute top-3 right-3"><TrustDots level={myProfile.trustLevel} compact /></div>
                    </div>
                    <div className="p-4">
                      <h3 className="text-sm font-light text-white mb-0.5">{myProfile.names}</h3>
                      <p className="text-slate-600 text-xs font-light mb-2">
                        {[myProfile.location, myProfile.pacePreference].filter(Boolean).join(' · ')}
                      </p>
                      {/* Travel badge */}
                      {travelWindow && (
                        <div className="flex items-center gap-1.5 mb-2">
                          <Plane size={11} className="text-amber-400/70" />
                          <span className="text-xs text-amber-400/70 font-light">Visiting {travelWindow.city} · {travelWindow.arrival} – {travelWindow.departure}</span>
                        </div>
                      )}
                      {myProfile.bio && <p className="text-slate-500 text-xs font-light leading-loose mb-3 line-clamp-2">{myProfile.bio}</p>}
                      <div className="flex items-center gap-1.5 text-xs text-slate-600 font-light">
                        <span className="text-slate-500">Tap to edit</span>
                      </div>
                    </div>
                  </div>
                )}

                {allProfiles
                  .filter(p => !p.isOwn)
                  .filter(profile => isInScope(userLocation, resolveProfileLocation(profile.location), scope, crossBorder))
                  .filter(profile => isAgeCompatible(myProfile, profile))
                  .map(profile => {
                  const intent = interestsSent.get(profile.id);
                  const gate   = getMessagingGate(profile);
                  const atCap  = interestsSent.size >= limits.INTEREST_LIMIT && !interestsSent.has(profile.id);

                  return (
                    <div key={profile.id} onClick={() => { setSelectedProfileId(profile.id); setView('profile'); }}
                      className="bg-slate-900/25 border border-slate-800/40 rounded-md overflow-hidden hover:border-amber-400/20 transition-all cursor-pointer">
                      <div className="bg-gradient-to-br from-slate-800 to-slate-900 h-40 flex items-center justify-center relative">
                        <span className="text-5xl opacity-15">👫</span>
                        <div className="absolute top-3 right-3"><TrustDots level={profile.trustLevel} compact /></div>
                      </div>
                      <div className="p-4">
                        <h3 className="text-sm font-light text-white mb-0.5">{profile.names}</h3>
                        {/* Richer subtitle: location · pace · experience */}
                        <p className="text-slate-600 text-xs font-light mb-2">
                          {[profile.location, profile.pacePreference, profile.experienceLevel].filter(Boolean).join(' · ')}
                        </p>

                        <p className="text-slate-500 text-xs font-light leading-loose mb-3 line-clamp-2">{profile.bio}</p>

                        {/* Soft activity signals — informational only, non-clickable */}
                        {profile.softSignals && profile.softSignals.length > 0 && (
                          <div className="flex flex-wrap gap-x-3 mb-3">
                            {profile.softSignals.map((s,si) => (
                              <p key={si} className="text-xs text-slate-700 font-light">{s}</p>
                            ))}
                          </div>
                        )}

                        {/* Intent row: compact, icon-only. Dims at cap; brief flash on tap. */}
                        <div className="flex gap-1.5 mb-1">
                          {INTENT_OPTIONS.map(opt => {
                            const Icon = opt.icon;
                            const sel  = intent === opt.id;
                            return (
                              <button key={opt.id} onClick={(e) => {
                                e.stopPropagation();
                                const ok = handleInterest(profile.id, opt.id);
                                if (!ok) fireCapFlash(profile.id);
                              }}
                                className={`flex-1 py-1.5 rounded flex items-center justify-center transition-all ${
                                  sel ? `bg-gradient-to-r ${opt.color} text-slate-950` : atCap ? 'bg-slate-950/30 text-slate-700 border border-slate-800/50 cursor-default' : 'bg-slate-950/40 text-slate-500 border border-slate-800 hover:border-slate-700'
                                }`}>
                                <Icon size={13} />
                              </button>
                            );
                          })}
                        </div>
                        {/* Micro-feedback: visible for 600 ms after a capped tap */}
                        <div className={`overflow-hidden transition-all duration-300 ${capFlash === profile.id ? 'max-h-5 opacity-100 mb-2' : 'max-h-0 opacity-0'}`}>
                          <p className="text-xs text-amber-400/50 font-light">That's all for today</p>
                        </div>

                        {/* Single-line status — re-keys on change so each new state animates in */}
                        {(() => {
                          const statusStr = gate.unlocked ? 'unlocked'
                            : !gate.mutualInterest ? 'Start with interest'
                            : !gate.sharedContext ? 'A shared space helps first'
                            : 'Waiting on confirmation';
                          return (
                            <div key={statusStr} className="s-in flex items-center gap-1.5 text-xs text-slate-600 font-light">
                              {gate.unlocked ? <><Unlock size={11} className="text-amber-400" /><span className="text-amber-400">Ready to message</span></>
                                : <><Lock size={11} /><span>{statusStr}</span></>
                              }
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>
              <PremiumBanner />
            </div>
          )}

          {/* ─── RE-ENGAGEMENT HOOK ─── 
              One quiet suggestion. Shows only when profile exists but no lounges joined yet.
              Disappears the moment they join one. No notifications. No streaks. */}
          {myProfile && myProfile.names && loungesJoined.size === 0 && (
            <div className="mt-8 pt-6 border-t border-slate-800/25">
              <p className="text-slate-600 text-xs font-light text-center">Most people start by joining one lounge. There's no pressure — just a good place to begin.</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── LOUNGE DETAIL ──
  const LoungeView = () => {
    const lounge = LOUNGE_DATA.find(l => l.id === selectedLoungeId);
    if (!lounge) return null;
    const joined = loungesJoined.has(lounge.id);

    // Gather all responses: seed + user-submitted, filter expired (>7 days), no timestamps shown
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const allResponses = [
      ...(lounge.seedResponses || []),
      ...(loungeResponses.get(lounge.id) || [])
    ].filter(r => (now - r.timestamp) < SEVEN_DAYS);

    const draft = loungeDrafts.get(lounge.id);
    const [draftText, setDraftText] = useState('');
    const [showDraftArea, setShowDraftArea] = useState(false);

    const MAX_DRAFT_LENGTH = 300; // ~3 sentences

    return (
      <div className="min-h-screen bg-slate-950">
        <div className="max-w-3xl mx-auto px-8 py-10">
          <button onClick={() => setView('browse')} className="text-slate-500 hover:text-slate-300 text-xs font-light mb-8 flex items-center gap-1.5 transition-colors">← Lounges</button>
          <div className="bg-slate-900/30 border border-slate-800/40 rounded-md p-8">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h1 className="text-2xl font-light text-white mb-1">{lounge.name}</h1>
                <p className="text-slate-600 text-xs font-light">{lounge.vibe}</p>
              </div>
              <button onClick={() => toggleLounge(lounge.id)}
                className={`px-5 py-2 rounded text-xs font-light transition-all ${
                  joined ? 'bg-amber-400/15 text-amber-400 border border-amber-400/25' : 'bg-slate-950/50 text-slate-500 border border-slate-800 hover:border-slate-700'
                }`}>
                {joined ? 'Joined' : 'Join'}
              </button>
            </div>

            <div className="flex gap-4 text-xs text-slate-600 mb-2">
              <span className="flex items-center gap-1"><Users size={12} />{lounge.members} members</span>
              <span className="flex items-center gap-1"><Activity size={12} />{lounge.activity}</span>
            </div>
            <p className="text-xs text-slate-700 font-light mb-6">{lounge.activitySignal}</p>

            {/* Why people join */}
            <div className="mb-6 pb-6 border-b border-slate-800/30">
              <p className="text-slate-400 text-sm font-light leading-relaxed">{lounge.whyJoin}</p>
            </div>

            {/* Weekly Prompt — quiet card at top */}
            <div className="mb-6 pb-6 border-b border-slate-800/30">
              <p className="text-xs text-slate-600 font-light mb-3 tracking-wide">THIS WEEK'S QUESTION</p>
              <p className="text-slate-300 text-sm font-light leading-relaxed mb-4">{lounge.weeklyPrompt}</p>
              <p className="text-xs text-slate-700 font-light">Some couples share a thought here. Others just read. There's no expectation to respond.</p>
            </div>

            {/* Anonymous Responses — index cards on a table, equal visual weight */}
            {allResponses.length > 0 && (
              <div className="mb-6 space-y-3">
                {allResponses.map(response => (
                  <div key={response.id} className="bg-slate-950/30 border border-slate-800/40 rounded p-4">
                    <p className="text-slate-400 text-sm font-light leading-relaxed">{response.text}</p>
                    <p className="text-xs text-slate-700 font-light mt-2">Shared by both partners</p>
                  </div>
                ))}
              </div>
            )}

            {/* Draft Area — only shows when tapped, lightweight dual-partner flow */}
            {!draft && !showDraftArea && (
              <button onClick={() => setShowDraftArea(true)}
                className="w-full py-3 rounded border border-slate-800/40 text-slate-600 hover:text-slate-400 hover:border-slate-700 text-xs font-light transition-all">
                Add your voice
              </button>
            )}

            {showDraftArea && !draft && (
              <div className="s-in bg-slate-950/40 border border-slate-800/40 rounded p-4">
                <textarea
                  value={draftText}
                  onChange={e => setDraftText(e.target.value)}
                  placeholder="A sentence or two. Keep it conversational."
                  rows={3}
                  maxLength={MAX_DRAFT_LENGTH}
                  className="w-full bg-slate-900/60 border border-slate-800 rounded px-4 py-3 text-sm text-white placeholder-slate-600 font-light leading-relaxed resize-none focus:outline-none focus:border-slate-600 transition-colors mb-2"
                />
                <p className="text-xs text-slate-700 font-light mb-3">{draftText.length}/{MAX_DRAFT_LENGTH}</p>
                <div className="flex gap-2">
                  <button onClick={() => {
                    if (draftText.trim().length < 10) return; // quietly enforce minimum
                    draftLoungeResponse(lounge.id, draftText.trim(), 'partner1');
                    setDraftText('');
                    setShowDraftArea(false);
                  }}
                    disabled={draftText.trim().length < 10}
                    className={`flex-1 py-2 rounded text-xs font-light transition-all ${
                      draftText.trim().length >= 10 ? 'bg-amber-400/15 text-amber-400 border border-amber-400/25' : 'bg-slate-950/30 text-slate-700 border border-slate-800/50 cursor-default'
                    }`}>
                    Draft for partner review
                  </button>
                  <button onClick={() => { setDraftText(''); setShowDraftArea(false); }}
                    className="px-4 py-2 rounded text-xs text-slate-600 hover:text-slate-400 font-light transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Draft Pending Confirmation — single-tap "Looks good" */}
            {draft && (
              <div className="s-in bg-slate-950/40 border-l-2 border-l-amber-400/50 border-t border-r border-b border-slate-800/40 rounded p-4">
                <p className="text-xs text-slate-600 font-light mb-2">Waiting on partner confirmation</p>
                <p className="text-slate-400 text-sm font-light leading-relaxed mb-4">{draft.text}</p>
                <div className="flex gap-2">
                  <button onClick={() => confirmLoungeResponse(lounge.id, draft.draftedBy === 'partner1' ? 'partner2' : 'partner1')}
                    className="flex-1 py-2 rounded bg-amber-400/15 text-amber-400 border border-amber-400/25 text-xs font-light transition-all">
                    Looks good
                  </button>
                  <button onClick={() => cancelLoungeDraft(lounge.id)}
                    className="px-4 py-2 rounded text-xs text-slate-600 hover:text-slate-400 font-light transition-colors">
                    Discard
                  </button>
                </div>
              </div>
            )}

            {/* Topics */}
            <div className="mt-6 pt-6 border-t border-slate-800/30">
              <p className="text-xs text-slate-600 font-light mb-2 tracking-wide">RECENT TOPICS</p>
              <div className="flex flex-wrap gap-2">
                {lounge.topics.map((t,i) => <span key={i} className="bg-slate-950/50 border border-slate-800 text-slate-500 px-3 py-1 rounded text-xs font-light">{t}</span>)}
              </div>
            </div>

            {/* Sample discussion prompts — static, read-only */}
            <div className="pt-6 border-t border-slate-800/30 mt-6">
              <p className="text-xs text-slate-600 font-light mb-3 tracking-wide">THINGS PEOPLE TALK ABOUT</p>
              <div className="space-y-3">
                {lounge.prompts.map((prompt, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <span className="text-slate-800 text-xs mt-0.5 flex-shrink-0">›</span>
                    <p className="text-slate-500 text-xs font-light leading-relaxed">{prompt}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ── EVENT DETAIL ──
  const EventView = () => {
    const event  = EVENT_DATA.find(e => e.id === selectedEventId);
    if (!event) return null;
    const actionId  = `rsvp-${event.id}`;
    const action    = getAction(actionId);
    const confirmed = action?.status === 'confirmed';

    return (
      <div className="min-h-screen bg-slate-950">
        <div className="max-w-3xl mx-auto px-8 py-10">
          <button onClick={() => setView('browse')} className="text-slate-500 hover:text-slate-300 text-xs font-light mb-8 flex items-center gap-1.5 transition-colors">← Events</button>
          <div className="bg-slate-900/30 border border-slate-800/40 rounded-md p-8">
            <div className="flex justify-between items-start mb-3">
              <h1 className="text-2xl font-light text-white">{event.title}</h1>
              {event.paid && <span className="bg-amber-400/10 border border-amber-400/25 text-amber-400 px-3 py-1 rounded text-xs font-light">Ticketed · ${event.price} per couple</span>}
            </div>
            <p className="text-slate-500 text-xs font-light mb-4">
              Hosted by {event.host} · {event.loungeOrigin}
            </p>
            <div className="flex flex-wrap gap-3 text-xs text-slate-600 mb-4">
              <span className="flex items-center gap-1"><Calendar size={12} />{event.date} {event.time}</span>
              <span className="flex items-center gap-1"><MapPin size={12} />{event.venue}, {event.location}</span>
              <span className="flex items-center gap-1"><Users size={12} />{event.existingRSVPs.length}/{event.maxAttendees}</span>
            </div>
            <p className="text-slate-400 text-sm font-light leading-loose mb-6">{event.description}</p>

            {confirmed && (
              <div className="s-in flex items-center gap-2 mb-4 py-2 px-3 bg-amber-400/8 border-t border-r border-b border-amber-400/20 border-l-2 border-l-amber-400/50 rounded-md">
                <Check size={14} className="text-amber-400" />
                <span className="text-xs text-amber-400 font-light">You're going</span>
              </div>
            )}

            {!confirmed && (
              <p className="text-xs text-slate-600 font-light mb-2">Tap to attend</p>
            )}
            <DualConfirm actionId={actionId} type="rsvp" targetId={event.id} ttlMs={limits.RSVP_TTL_MS} />
          </div>
        </div>
      </div>
    );
  };

  // ── PROFILE DETAIL ──
  const ProfileView = () => {
    const profile = allProfiles.find(p => p.id === selectedProfileId);
    if (!profile) return null;
    const intent = interestsSent.get(profile.id);
    const gate   = getMessagingGate(profile);

    return (
      <div className="min-h-screen bg-slate-950">
        <div className="max-w-3xl mx-auto px-8 py-10">
          <button onClick={() => setView('browse')} className="text-slate-500 hover:text-slate-300 text-xs font-light mb-8 flex items-center gap-1.5 transition-colors">← Couples</button>
          <div className="bg-slate-900/30 border border-slate-800/40 rounded-md overflow-hidden">
            <div className="bg-gradient-to-br from-slate-800 to-slate-900 h-56 flex items-center justify-center relative">
              <span className="text-7xl opacity-15">👫</span>
              <div className="absolute top-4 left-4 bg-slate-900/80 backdrop-blur-sm px-3 py-2 rounded border border-slate-800">
                <TrustDots level={profile.trustLevel} />
              </div>
              <div className="absolute top-4 right-4 flex gap-1.5">
                {profile.trustSignals.id        && <div className="bg-amber-400/90 text-slate-950 p-1.5 rounded"><UserCheck size={12} strokeWidth={2.5} /></div>}
                {profile.trustSignals.relationship && <div className="bg-amber-400/90 text-slate-950 p-1.5 rounded"><Users size={12} strokeWidth={2.5} /></div>}
                {profile.trustSignals.alignment && <div className="bg-amber-400/90 text-slate-950 p-1.5 rounded"><Shield size={12} strokeWidth={2.5} /></div>}
                {profile.trustSignals.community && <div className="bg-amber-400/90 text-slate-950 p-1.5 rounded"><Award size={12} strokeWidth={2.5} /></div>}
              </div>
            </div>

            <div className="p-8">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h1 className="text-2xl font-light text-white mb-0.5">{profile.names}</h1>
                  <p className="text-slate-500 text-sm font-light">{[profile.location, profile.pacePreference, profile.experienceLevel].filter(Boolean).join(' · ')}</p>
                </div>
                <BookmarkPill profileId={profile.id} />
              </div>

              {/* Reputation — subtle, no header */}
              {profile.reputation.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-6">
                  {profile.reputation.map((r,i) => (
                    <span key={i} className="bg-amber-400/6 border border-amber-400/15 text-amber-400/70 px-2.5 py-1 rounded text-xs font-light flex items-center gap-1.5">
                      <Check size={10} />{r}
                    </span>
                  ))}
                </div>
              )}

              {/* ── About ── */}
              <div className="mb-7">
                <p className="text-xs text-slate-600 font-light mb-3 tracking-wide">ABOUT</p>
                <p className="text-slate-400 text-sm font-light leading-loose">{profile.bio || 'No bio yet.'}</p>
                {/* Soft signals */}
                {profile.softSignals && profile.softSignals.length > 0 && (
                  <div className="flex flex-wrap gap-x-3 mt-3">
                    {profile.softSignals.map((s,si) => (
                      <p key={si} className="text-xs text-slate-700 font-light">{s}</p>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Alignment ── */}
              <div className="mb-7 pb-6 border-b border-slate-800/30">
                <p className="text-xs text-slate-600 font-light mb-3 tracking-wide">ALIGNMENT</p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  {[['Pace','pacePreference'],['Intent','primaryIntent'],['Style','relationshipStructure'],['Autonomy','autonomyStance']].map(([l,k]) => (
                    <div key={k}>
                      <p className="text-xs text-slate-600 mb-0.5">{l}</p>
                      <p className="text-slate-300 text-xs font-light">{profile[k] || '—'}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Shared Interests ── */}
              <div className="mb-7">
                <p className="text-xs text-slate-600 font-light mb-3 tracking-wide">INTERESTS</p>
                <div className="flex flex-wrap gap-1.5">
                  {profile.interests.map((i,idx) => <span key={idx} className="bg-slate-950/50 border border-slate-800 text-slate-500 px-2.5 py-0.5 rounded text-xs font-light">{i}</span>)}
                </div>
              </div>

              {/* Intent selection + messaging — only for other people's profiles */}
              {!profile.isOwn && (
                <>
                  <div className="mb-6">
                    <p className="text-xs text-slate-500 font-light mb-1">What are you open to right now?</p>
                    <p className="text-xs text-slate-600 font-light mb-3">Nothing is locked in — you can change this anytime.</p>
                    {(() => {
                      const atCap = interestsSent.size >= limits.INTEREST_LIMIT && !interestsSent.has(profile.id);
                      return (
                        <>
                          <div className="grid grid-cols-3 gap-2">
                            {INTENT_OPTIONS.map(opt => {
                              const Icon = opt.icon;
                              const sel  = intent === opt.id;
                              return (
                                <button key={opt.id} onClick={() => {
                                  const ok = handleInterest(profile.id, opt.id);
                                  if (!ok) fireCapFlash(profile.id);
                                }}
                                  className={`p-3 rounded border transition-all text-center ${
                                    sel ? `bg-gradient-to-r ${opt.color} text-slate-950 border-transparent`
                                        : atCap ? 'bg-slate-950/25 border-slate-800/40 cursor-default'
                                        : 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
                                  }`}>
                                  <Icon size={20} className={`mx-auto mb-1.5 ${sel ? 'text-slate-950' : atCap ? 'text-slate-700' : 'text-slate-400'}`} />
                                  <p className={`text-xs font-light ${sel ? 'text-slate-950' : atCap ? 'text-slate-600' : 'text-slate-400'}`}>{opt.label}</p>
                                </button>
                              );
                            })}
                          </div>
                          {/* Micro-feedback: visible for 600 ms after a capped tap */}
                          <div className={`overflow-hidden transition-all duration-300 ${capFlash === profile.id ? 'max-h-5 opacity-100 mt-2' : 'max-h-0 opacity-0'}`}>
                            <p className="text-xs text-amber-400/50 font-light">That's all for today</p>
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {/* Messaging status — single line, expandable */}
                  <MsgStatus profile={profile} />
                </>
              )}

              {/* Own profile: edit button instead */}
              {profile.isOwn && (
                <button onClick={() => setView('profile-setup')}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded border border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-300 text-xs font-light transition-all">
                  <Pencil size={13} /> Edit profile
                </button>
              )}

              <PremiumBanner />
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ── MESSAGES ──
  const MessagesView = () => {
    const unlockedProfiles = allProfiles.filter(p => !p.isOwn && getMessagingGate(p).unlocked);
    const pendingProfiles  = allProfiles.filter(p => { if (p.isOwn) return false; const g = getMessagingGate(p); return !g.unlocked && g.mutualInterest; });

    return (
      <div className="min-h-screen bg-slate-950">
        <div className="max-w-3xl mx-auto px-8 py-10">
          <button onClick={() => setView('browse')} className="text-slate-500 hover:text-slate-300 text-xs font-light mb-8 flex items-center gap-1.5 transition-colors">← Back</button>
          <h1 className="text-xl font-light text-white mb-6">Conversations</h1>

          {unlockedProfiles.length === 0 && pendingProfiles.length === 0 && (
            <div className="bg-slate-900/20 border border-slate-800/30 rounded-md p-8 text-center">
              <p className="text-slate-600 text-sm font-light mb-1">No conversations yet.</p>
              <p className="text-slate-700 text-xs font-light">Conversations only open when everyone is ready. Most people start by joining a lounge.</p>
            </div>
          )}

          {unlockedProfiles.map(profile => (
            <div key={profile.id} className="bg-slate-900/25 border border-slate-800/40 rounded-md p-4 mb-2">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center flex-shrink-0"><span className="text-lg opacity-30">👫</span></div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-light text-white">{profile.names}</p>
                    <Unlock size={11} className="text-amber-400" />
                  </div>
                  <p className="text-xs text-slate-600 font-light">Open</p>
                </div>
                <div className="flex items-center gap-2">
                  <BookmarkPill profileId={profile.id} />
                  <ArrowRight size={14} className="text-slate-600" />
                </div>
              </div>
            </div>
          ))}

          {pendingProfiles.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-slate-600 mb-2">Pending</p>
              {pendingProfiles.map(profile => (
                <div key={profile.id} className="bg-slate-900/15 border border-slate-800/25 rounded-md p-4 mb-2">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-9 h-9 bg-slate-800 rounded-full flex items-center justify-center flex-shrink-0"><span className="text-sm opacity-25">👫</span></div>
                    <p className="text-sm font-light text-slate-400">{profile.names}</p>
                  </div>
                  <MsgStatus profile={profile} />
                </div>
              ))}
            </div>
          )}
          <PremiumBanner />
        </div>
      </div>
    );
  };

  // ── ROUTER ──
  const routes = { landing: LandingPage, signup: SignupView, 'profile-setup': ProfileSetupView, browse: BrowseView, lounge: LoungeView, event: EventView, profile: ProfileView, messages: MessagesView };
  const Page = routes[view] || LandingPage;
  return <Page />;
}
