---
title: "Building an Offline-First Android App for Field Operations with GeoPackage and Jetpack Compose"
description: "How I built a native Android app for field teams: offline spatial queries with GeoPackage, real-time GPS tracking, and sync with PostgreSQL."
pubDate: "2026-02-01"
updatedDate: "2026-09-12"
image: "/assets/blog/offline-first-android.webp"
tags: ["android", "kotlin", "geopackage", "jetpack-compose", "offline-first"]
author: "Asier Ortiz"
draft: false
---

Some apps are built for ideal conditions: fast Wi-Fi, stable connections, users sitting at desks. This is not one of those apps.

This article covers the architecture and technical challenges behind a native Android application I built for the **field operations teams** of the Provincial Council of Álava, who work on roads and highways. These teams patrol infrastructure, report incidents, manage emergencies, and log everything, often in areas with **zero cellular coverage**.

All I had to start with was a document briefly describing what the client needed: their field workers were filling out **paper forms** during road patrols, then manually entering the data into a web portal back at the office. They wanted to digitize and automate the entire process. That single document was my roadmap for the next several months.

Let's break down how it all came together.

*Updated August 2026: the app has since shipped to production. I've revised the sections on maps, sync, and security to reflect how the system actually works today, including a couple of places where the original approach didn't survive contact with reality.*

---

## 📋 Table of Contents

<div class="not-prose mb-8 rounded-lg border border-base-700 bg-base-900 p-4">
  <ul class="flex flex-col gap-2">
    <li><a href="#1-the-challenge" class="text-base-300 hover:text-primary-400 transition-colors duration-300">1. The Challenge</a></li>
    <li><a href="#2-offline-first-architecture" class="text-base-300 hover:text-primary-400 transition-colors duration-300">2. Offline-First Architecture</a></li>
    <li><a href="#3-geopackage-for-offline-spatial-queries" class="text-base-300 hover:text-primary-400 transition-colors duration-300">3. GeoPackage for Offline Spatial Queries</a></li>
    <li><a href="#4-taming-gps-drift-with-kalman-filters" class="text-base-300 hover:text-primary-400 transition-colors duration-300">4. Taming GPS Drift with Kalman Filters</a></li>
    <li><a href="#5-real-time-gps-tracking-with-maplibre" class="text-base-300 hover:text-primary-400 transition-colors duration-300">5. Real-Time GPS Tracking with MapLibre</a></li>
    <li><a href="#6-hands-free-operation-with-voice-commands" class="text-base-300 hover:text-primary-400 transition-colors duration-300">6. Hands-Free Operation with Voice Commands</a></li>
    <li><a href="#7-postgresql-as-the-api-layer" class="text-base-300 hover:text-primary-400 transition-colors duration-300">7. PostgreSQL as the API Layer</a></li>
    <li><a href="#8-designing-ux-for-field-workers" class="text-base-300 hover:text-primary-400 transition-colors duration-300">8. Designing UX for Field Workers</a></li>
    <li><a href="#9-security-encryption-and-biometric-access" class="text-base-300 hover:text-primary-400 transition-colors duration-300">9. Security: Encryption and Biometric Access</a></li>
    <li><a href="#10-sync-strategy" class="text-base-300 hover:text-primary-400 transition-colors duration-300">10. Sync Strategy</a></li>
    <li><a href="#11-lessons-learned" class="text-base-300 hover:text-primary-400 transition-colors duration-300">11. Lessons Learned</a></li>
  </ul>
</div>

---

## 1. The Challenge

The requirements were straightforward on paper:

- Field teams drive along roads, performing surveillance patrols
- They need to **report incidents** (debris, animals, road damage) with exact location
- They manage **emergencies** with timestamps, assigned staff, photos, and detailed records
- Everything must work **without internet**, syncing when back in range
- Location data must be precise: which road, which kilometer marker, which direction
- Patrols where **nothing is found** should be logged automatically, with no manual input needed

The hard part? Making all of this feel fast, reliable, and simple for users who are not tech-savvy, often operating the app one-handed while standing on the side of a highway. Or worse: while driving.

That last point kept me up at night. These workers use the app **in a vehicle**. Touching a screen while driving is a safety problem I couldn't ignore.

---

## 2. Offline-First Architecture

"Offline-first" is not just caching API responses. It means the **local database is the source of truth**, and the server is something you sync with when you can.

### Room as the Local Database

The app uses **Room** (Android's SQLite abstraction) as its primary data store. Every entity (patrols, incidents, emergencies, photos) lives locally first.

```kotlin
@Entity(tableName = "emergencies")
data class EmergencyEntity(
    @PrimaryKey val uuid: String,
    val roadId: Int?,
    val km: Double?,
    val direction: String?,
    val status: String,
    val synced: Boolean = false,
    // ... more fields
)
```

### UUIDs Everywhere

Since records are created offline on multiple devices, auto-increment IDs would collide. Every record gets a **UUID** at creation time, which serves as the primary key. The server accepts these UUIDs and uses them for deduplication; on first upload it returns its own numeric ID, which the app stores alongside the UUID for subsequent updates. Relations between records (an incident belongs to a patrol) also use UUIDs, so records can be created and linked to each other entirely offline.

There's no deduplication table or idempotency header behind any of this: the UNIQUE constraint on the UUID column is the mechanism. A duplicate upload trips PostgreSQL's unique-violation error, and the server responds with the existing ID and a success status instead of an error, so the app marks its copy as synced rather than retrying forever.

```kotlin
val newEmergency = EmergencyEntity(
    uuid = UUID.randomUUID().toString(),
    status = "ACTIVE",
    synced = false,
    // ...
)
```

### The `synced` Flag

Every entity has a `synced` boolean. When a record is created or modified locally, it's marked as `synced = false`. The sync process picks up all unsynced records and pushes them to the server. On success, the flag flips to `true`.

This pattern is simple but effective. It handles the common case (create offline, sync later) without the complexity of conflict resolution frameworks like CRDTs.

<img src="/assets/blog/field-ops-system-map.svg" alt="On the device, a WorkManager sync runs after every save, on app open and every fifteen minutes, with one strategy per entity type in the order patrols, incidents, emergencies, photos, each in its own try/catch. Room (SQLite) is the source of truth, holding patrols, tracks, incidents, emergencies, photos and reference caches with UUID primary keys, a synced flag and the server id. A foreground tracking service feeds fused GPS through a Kalman filter and, during patrols, an HMM map matcher. A roads GeoPackage opened with the NGA SDK provides offline road and kilometre attribution through an R-tree over the official network. Map tiles in an MBTiles file are served by a local HTTP server to MapLibre. VOSK speech recognition uses a small Spanish model downloaded once, with a closed grammar and spoken feedback. Credentials live in EncryptedSharedPreferences behind a biometric prompt with silent re-login on 401. The Jetpack Compose UI keeps one task per screen. On the server, an Express API in TypeScript checks a JWT and a server-side session and makes one parameterised call per operation into PostgreSQL PL/pgSQL functions, where the business logic lives and the patrol upload is one transaction. A JVM matcher worker running GraphHopper map matching on OpenStreetMap polls the patrol table as a queue. Offline data downloads serve the tiles and the roads GeoPackage with a SHA-256 signature. Photo files are stored on the server filesystem with their metadata in the database." data-zoomable />

---

## 3. GeoPackage for Offline Spatial Queries

This was the most technically challenging part of the project, and honestly the one that gave me the most headaches.

### The Problem

When a field worker reports an incident, they need to specify:
- **Which road** they're on
- **The kilometer marker** (KM point)
- **The direction** of travel

Doing this manually from a dropdown of hundreds of roads is impractical. The app needs to figure out this information **automatically from GPS coordinates**, and it needs to do it **offline**.

### Why Not a Geocoding API?

Services like Google's Geocoding API or Mapbox require an internet connection. These teams work in areas where that's not guaranteed. We needed the spatial data **on the device**.

### Enter GeoPackage

**GeoPackage** is an OGC standard for storing geospatial data in a SQLite container. It can hold vector features (points, lines, polygons) with their geometries and attributes, all in a single `.gpkg` file.

I'd never worked with GeoPackage before this project. The documentation is sparse, the Android community around it is tiny, and most examples I found online were either outdated or focused on desktop GIS tools. I spent days just figuring out how to properly query geometries and compute distances along road segments. There were moments where I questioned whether this was even the right approach, but the alternative (requiring internet for geocoding) was a non-starter.

The road network data (every road segment with its geometry, name, and kilometer markers) is packaged into a GeoPackage file that the app downloads during onboarding and keeps current by checking a version signature against the server. It's a heavy download, so the app never fetches it over mobile data without explicit confirmation.

### How It Works

1. **Load the GeoPackage** on app start using the [NGA GeoPackage Android SDK](https://github.com/ngageoint/geopackage-android):

```kotlin
val manager = GeoPackageFactory.getManager(context)
val geoPackage = manager.openExternal(geoPackageFile)
```

2. **Query by proximity**. Given GPS coordinates, find nearby candidate segments through the GeoPackage's R-Tree spatial index, with a search radius in metres converted to degrees:

```kotlin
val featureDao = geoPackage.getFeatureDao("road_segments")
val indexManager = FeatureIndexManager(context, geoPackage, featureDao)
val envelope = GeometryEnvelope(
    lng - lonDelta, lat - latDelta,
    lng + lonDelta, lat + latDelta
)
val results = indexManager.query(envelope)
```

3. **Calculate the kilometer marker**. The GPS point is projected onto the candidate segment's geometry. An early version then computed the KM by measuring the distance along the line from the road's origin; today the network ships pre-cut into short segments that each carry their official starting KM as an attribute, so the app projects the point onto the closest segment and reads that segment's marker straight from the data, with no offset along it. Authoritative values beat on-device arithmetic: faster, and immune to the subtle errors that creep into distance calculations over reprojected geometries.

4. **Ask for the direction**. It is picked from a two-option dialog rather than inferred; GPS heading against segment bearing is only used inside the patrol map matcher, to filter candidates.

<img src="/assets/blog/field-ops-road-attribution.svg" alt="Single lookup, used by the incident form and run on every fix while the form is open: a raw fused GPS fix at about one per second; a search window whose radius in metres is converted to degrees, 500 metres for the form and 50 by default; an R-tree query over the GeoPackage returning candidate sections of the official network; the point projected onto every vertex pair of each candidate with the parameter clamped to the segment and the distance measured by haversine; the best candidate is the minimum distance with a 3 metre penalty for slip roads. The kilometre marker is the matched section's starting KM and metre attributes read from the data, with no offset along the section; the road name comes from the section id looked up in the cached road catalogue, with link roads flagged separately; the form is filled with road and KM, the direction is picked by hand, and with no candidate the fields are left for manual entry. During a patrol the same GeoPackage feeds a different decision, one fix per second: a Kalman-filtered fix with adaptive noise by speed and an innovation gate, candidates within a radius of three times the GPS accuracy clamped to 35 to 50 metres, an HMM Viterbi matcher over the road graph with heading-versus-bearing filters, a confirmation step with a 40 metre cutoff and hysteresis that returns null off-road rather than the nearest road, and a direction derived from the kilometre at entry versus exit." data-zoomable />

### The Result

The user taps "Report Incident," and the app **instantly** fills in the road name and KM, computed locally from GPS + GeoPackage data. No internet required. The spatial query runs in milliseconds.

This ended up being the feature that impressed everyone the most during demos. What previously required manually looking up road markers and typing values now happened automatically. The first time I showed it to the field workers, their reaction alone made all the frustration worth it.

---

## 4. Taming GPS Drift with Kalman Filters

Raw GPS data is messy. On a highway, the reported position can jump around by 10-20 meters between readings, especially near tunnels, bridges, or tall structures. When you're drawing a real-time route on a map and computing kilometer markers, those jumps are a problem.

The polyline would zigzag across lanes. The KM calculation would fluctuate. The user would see their marker bouncing around erratically.

### The Solution: Kalman Filtering

I implemented a **Kalman filter** to smooth GPS readings. The filter maintains a prediction of the device's position and velocity, and corrects it with each new GPS reading, weighting the prediction vs. the measurement based on their respective uncertainties.

```kotlin
class KalmanFilter {
    private var lat: Double = 0.0
    private var lng: Double = 0.0
    private var variance: Float = -1f

    fun process(newLat: Double, newLng: Double, accuracy: Float, timestamp: Long) {
        if (variance < 0) {
            // First reading: initialize
            lat = newLat
            lng = newLng
            variance = accuracy * accuracy
        } else {
            // Predict + correct
            val duration = (timestamp - lastTimestamp) / 1000.0
            variance += duration * speedVariance
            val gain = variance / (variance + accuracy * accuracy)
            lat += gain * (newLat - lat)
            lng += gain * (newLng - lng)
            variance *= (1 - gain)
        }
    }
}
```

The GPS `accuracy` field reported by the device is key here: it lets the filter automatically trust high-accuracy readings more and discount noisy ones.

The difference was dramatic. The polyline went from a jittery mess to a smooth line that actually followed the road. KM calculations became stable. It was one of those changes where the before/after was immediately obvious.

The filter has since grown an **innovation gate**: readings that deviate too far from the prediction (the classic signature of multipath reflections near tunnels and overpasses) get rejected outright instead of merely down-weighted. And filtering turned out to be only the first stage of the pipeline. Snapping a smoothed position to the *correct* road, not just the nearest one (think parallel carriageways or an overpass crossing the road you're actually on), eventually required full map matching with a Hidden Markov Model and Viterbi decoding. That's a story big enough to deserve its own article.

---

## 5. Real-Time GPS Tracking with MapLibre

The app includes a map view that tracks the user's patrol in real time, drawing the route as a polyline.

### MapLibre for Offline Maps

We use **MapLibre GL** (the open-source fork of Mapbox GL) for map rendering, with the route and incident markers drawn as GeoJSON layers on top. Getting the base map offline, however, took two attempts.

The first approach used MapLibre's built-in `OfflineRegion` API to pre-download tiles. It worked in testing and fell apart at real scale: covering the full patrol area fired over 4,500 individual tile requests, downloads stalled constantly, and regions routinely ended up 97% incomplete with no clean way to resume.

The replacement is simpler and far more robust. The entire tile set ships as a single **MBTiles** file of around 160 MB: one SQLite database containing every tile. The app runs a tiny embedded HTTP server (NanoHTTPD) bound to `127.0.0.1` and points MapLibre's style at it. MapLibre believes it's talking to a remote tile server; in reality every request is answered from local disk in microseconds. One file to download, one file to swap atomically on updates, zero partial states.

### Drawing the Route

As filtered GPS updates arrive, each coordinate is appended to a `LineString` geometry and the polyline source is updated:

```kotlin
locationCallback = object : LocationCallback() {
    override fun onLocationResult(result: LocationResult) {
        val location = result.lastLocation ?: return
        kalmanFilter.process(location)
        val point = Point.fromLngLat(kalmanFilter.lng, kalmanFilter.lat)

        routeCoordinates.add(point)
        updatePolylineSource(routeCoordinates)
        updateMarkerPosition(point)
    }
}
```

One detail that matters more than it looks: the position marker is fed the filtered, road-matched position rather than raw GPS, through a custom `LocationEngine` that MapLibre consumes as if it were the device's own. The puck you see is the position the app believes, not the noise the antenna reports.

### Camera Behavior

One subtle UX challenge: the map camera should follow the user's position during a patrol, but the user should also be able to pan around freely to inspect the map. If you lock the camera, it feels restrictive. If you don't, they lose their position.

The solution: **auto snap-back**. If the user pans away, the camera stays free. But when they stop interacting and the camera comes to rest near their own position marker, tracking mode kicks back in automatically after a short delay, confirmed by a subtle haptic tick. The distance threshold scales with the zoom level, so "near" means the same thing on screen whether you're inspecting an intersection or looking at half the province. This gives users freedom without losing context.

### Battery Optimization

Continuous GPS tracking is a battery killer. These patrols can last hours, and a dead phone means no incident reporting. The position pipeline needs a high-accuracy fix every second to work well, so degrading GPS quality was never really an option. The app attacks the problem from other angles instead: it asks to be exempted from the manufacturer's battery optimizations so the tracking service isn't killed mid-patrol (with per-vendor instructions, because every manufacturer hides that setting somewhere different), it raises a notification when the battery runs low during an active patrol suggesting the worker finish or plug in, and the pure-black theme cuts screen power on OLED panels during long night shifts.

---

## 6. Hands-Free Operation with Voice Commands

Here's something I didn't anticipate when I started: the app would be used **while driving**. Field workers patrol roads in vehicles, and asking them to pull over every time they spot debris or a dead animal on the road isn't realistic.

I needed a way to interact with the app **without touching the screen**.

### VOSK for Offline Speech Recognition

Online services like Google Speech API weren't an option: again, no guaranteed connectivity. I integrated **[VOSK](https://alphacephei.com/vosk/)**, an open-source speech recognition toolkit that runs entirely on-device.

VOSK uses lightweight ML models (~50MB); the Spanish one is downloaded once, over Wi-Fi unless the user allows mobile data. It processes audio locally with decent accuracy for a focused vocabulary set.

The vocabulary is deliberately tiny. In driving mode, the app listens for one action with two accepted phrasings, "nueva incidencia" and "registrar incidencia", which opens an incident report with the location already filled in. Vosk runs with a closed grammar: those phrases plus an unknown-word token, nothing else.

The voice recognition doesn't need to be perfect: matching a couple of known phrases against a closed grammar keeps accuracy high even with road noise and regional accents, in a way free-form dictation never could.

Recognition alone isn't enough while driving, though: the driver can't glance at the screen to confirm the command registered. So the app answers back with text-to-speech, closing the whole loop by ear.

This was another feature born from listening to the actual users. In a meeting room, the touchscreen UI seemed fine. But they told me that on a highway at 80 km/h it would be a liability. Voice commands turned a safety problem into a solved problem.

---

## 7. PostgreSQL as the API Layer

The backend uses **PostgreSQL** with **PL/pgSQL functions** as the primary API interface: no ORM, no query builder.

### Functions as Endpoints

Every operation the mobile app needs maps to a PostgreSQL function:

```sql
CREATE OR REPLACE FUNCTION insert_emergency(
    p_uuid VARCHAR(50),
    p_road_id INTEGER,
    p_km NUMERIC(7,3),
    p_direction VARCHAR(20),
    p_status VARCHAR(20),
    -- ... more parameters
) RETURNS VOID AS $$
BEGIN
    INSERT INTO emergencies (uuid, road_id, km, direction, status)
    VALUES (p_uuid, p_road_id, p_km, p_direction, p_status);
END;
$$ LANGUAGE plpgsql;
```

The example above is simplified; the real functions follow a numbered naming convention inherited from the legacy system this platform replaced, and some of the ported procedures take over thirty positional arguments.

A thin **Node.js/Express** layer sits in front, handling authentication and calling these functions via parameterized queries. The Express layer is deliberately minimal: it validates the request, calls the function, and returns the result. The one place it earns its keep is the patrol upload, where the header, the GPS track, and the road assignments are committed in a single transaction. A header without its track would look like a perfectly valid patrol while the actual route got lost forever the moment the device marked it as synced.

### Why This Approach?

- **Performance**: No ORM overhead. Queries are optimized at the database level.
- **Consistency**: Business logic lives in one place. Whether data comes from the app, a web dashboard, or a future integration, the same rules apply.
- **Simplicity**: The Node.js layer stays thin and easy to maintain.

### The Trade-offs

- **Harder to test**: Unit testing PL/pgSQL functions requires a running database.
- **Vendor lock-in**: The logic is tightly coupled to PostgreSQL.
- **Developer experience**: Not every developer is comfortable writing and debugging stored procedures.

For this project, the trade-offs were acceptable. The data model is stable, the team is small, and performance matters more than portability.

---

## 8. Designing UX for Field Workers

Building for field workers is fundamentally different from building for office users. I learned this the hard way.

### The Context

- Users operate the app **outdoors**, often in rain or direct sunlight
- They may be wearing **gloves**
- They're standing on a highway shoulder with **traffic passing by**
- They are **not tech-savvy**: the app replaced paper forms they'd used for years
- They need to log information **quickly** and get back to work

The transition from paper to digital was never going to be smooth. Some of these workers have been filling out the same paper forms for a decade. The app has to be **easier than paper**, not just "also digital." If it adds friction, they'll go back to the clipboard.

### Design Decisions

**Large touch targets**: Every button, every interactive element is oversized. Standard Material Design sizing is too small for gloved fingers on a bumpy highway shoulder.

**Minimal required fields**: When creating an emergency, the app lets you save with almost no data. Fill in the basics, get back to the situation, and complete the details later. This came directly from feedback during early demos: field workers pointed out that being forced to fill mandatory fields during an actual highway incident would be a liability. They were right.

**Haptic feedback**: Subtle vibrations confirm actions, with a short pulse when saving and a double pulse when completing a task. On a noisy highway, visual feedback alone isn't enough. I spent time tuning the vibration patterns on different devices, because what felt right in a quiet office would feel completely different with traffic noise and adrenaline.

```kotlin
object HapticFeedback {
    fun confirm(context: Context) {
        vibrate(context, 50) // Short confirmation
    }

    fun success(context: Context) {
        // Double pulse for completion
        vibratePattern(context, longArrayOf(0, 50, 100, 50))
    }
}
```

**Automatic data population**: As described in the GeoPackage section, the app fills in location data automatically. Every field the user doesn't have to type is time saved and errors avoided. Automated patrols with no incidents detected get logged with zero manual input: just start the patrol, drive, and end it.

**Adaptive layout for tablets and phones**: The primary devices are **tablets** mounted in vehicles, but field workers may also need to use their personal phones for off-shift emergencies. The UI adapts to both form factors: larger touch targets and multi-column layouts on tablets, a more compact single-column flow on phones. Building adaptive layouts in Jetpack Compose made this manageable, with a small window-size helper that buckets widths into compact, medium, and expanded at the usual 600 and 840 dp breakpoints, but it still meant testing every screen at multiple form factors. Foldables get the same treatment for free: unfolding promotes the layout to the wider bucket, and since the app absorbs the configuration change instead of recreating the screen, nothing in progress is lost mid-fold. Orientation follows the hardware too: free rotation on tablets, portrait-locked on phones.

**Accessibility as a setting, not an afterthought**: The app ships with selectable typefaces (including Atkinson Hyperlegible and OpenDyslexic) plus adjustable text scaling, a dark theme, and a pure-black AMOLED variant for night patrols. Not every field worker has perfect eyesight, and a font option costs very little to build compared to what it gives back.

**State machines, not free-form flows**: Emergencies follow a strict lifecycle: Active, En Route, On Site, Finalized, and Canceled. The UI adapts to each state, showing only relevant actions and preventing invalid transitions.

---

## 9. Security: Encryption and Biometric Access

The app handles sensitive operational data: incident locations, emergency details, staff assignments, photos of road conditions. This data can't just sit unprotected on a device that might be lost or stolen.

### Encrypted Credentials

The username and password kept for biometric login are stored using Android's **EncryptedSharedPreferences** with AES-256-GCM encryption, backed by the **Android Keystore**, so they are encrypted at rest with hardware-backed keys. Even if someone extracts the app's data from the device, the credentials are unreadable without the Keystore.

Passwords are also hashed with SHA-256 for offline login validation, so the app can authenticate users even without a server connection.

### Biometric Authentication

The app supports **biometric authentication** (fingerprint or face recognition) for quick access. After a successful login, users can enable biometric unlock so they don't have to type credentials every time.

The implementation uses Android's **BiometricPrompt API**, which handles the variety of biometric hardware across manufacturers gracefully. It detects the available biometric type on the device and adapts accordingly: fingerprint, face, or both.

If a phone is left unattended in a vehicle (which happens), the session and credentials remain protected behind the device's biometric lock.

### Shared Devices, Separate Users

The tablets are shared: shifts rotate, and the same device serves different users over time. When a new user logs in, the app wipes the previous user's local data (records, photos, session) in a single transaction, warning first if anything is still unsynced. The subtle part is that the wipe must include the stored biometric credentials: leave them behind, and the next user would unlock straight into the previous user's account with their own fingerprint. Device-level data (maps, catalogs, theme) survives the handoff.

### Silent Re-Login

Token expiry is handled without bothering the user. An OkHttp `Authenticator` intercepts 401 responses, refreshes the token (falling back to the stored credentials if the refresh fails) and retries the original request, tagged so a second 401 can't trigger an infinite loop. A field worker never gets kicked to a login screen mid-patrol because a token quietly expired.

---

## 10. Sync Strategy

The sync process is the bridge between the offline-first local database and the central server.

### How It Works

1. **Detect connectivity**: The app monitors network state. When a connection comes back, it pushes whatever is pending; the full push-and-pull runs on app open and from the list screens. A process-wide mutex prevents two syncs from running concurrently, and the app-open sync respects a ten-minute cooldown that a manual "sync now" is allowed to skip.

2. **Push local changes**: Records with `synced = false` are sent to the server (patrols only once finished or cancelled). What started as one monolithic sync function evolved into a **Strategy pattern**: one sync strategy per entity type, each isolated in its own try/catch so a failure in one category never aborts the rest. Order matters: photos always go last, because they reference their parent record's UUID and that record must already exist server-side.

3. **Pull server updates**: Sync became genuinely bidirectional over time. Reference data (road lists, staff directories, configuration) refreshes on its own daily cycle, and the app downloads the worker's own records created on another device within a 7-day window, matching the local retention policy, so a device never holds more history than it needs.

4. **Mark as synced**: On successful push, records are flagged as `synced = true`. The "last synced" timestamp updates even when there was nothing to upload: a device that's up to date is synced too.

<img src="/assets/blog/field-ops-sync.svg" alt="Four things start a sync: the network coming back pushes pending records only, with no pull and no cooldown; opening the app or a list screen runs a full push and pull, skipped if the last success was under ten minutes ago; Sync now in Settings runs a full sync ignoring the cooldown; and a WorkManager job runs every fifteen minutes when the battery is not low. One process-wide mutex keeps runs from overlapping. The push goes in order, each type and each record in its own try/catch: patrols, only once finished or cancelled; incidents, holding back drafts without a type; emergencies, created or updated by server id; photos always last, one multipart upload each, with a missing local file marked by a tombstone path. A record with a server id goes up as an update and one without as a creation, except patrols, which are only created or cancelled; a duplicate UUID trips a unique violation and the server answers 200 with the existing id; on success the record is marked synced with its server id and the last-sync stamp is updated even when nothing was uploaded. After the push, the pull inserts the worker's own records created on another device in the last seven days if missing by UUID, never overwrites except for a cancellation pushed by the server, deletes synced records older than seven days with their tracks and photos, and reference catalogues refresh on a separate daily cycle. At patrol end the inverted flow uploads the header, the raw track and the road windows in one transaction with no matched coordinates; the matcher worker claims the pending row with SKIP LOCKED, polling every thirty seconds with three attempts; GraphHopper snaps the track to OpenStreetMap and writes the matched coordinates back; the detail screen fetches them once per open, matched by timestamp, showing the raw track until then." data-zoomable />

### Photo Sync

Photos deserve special mention. They're captured offline and stored locally as files with metadata in Room. During sync, each photo is uploaded individually (they can be several MB each), and only marked as synced on successful upload.

```kotlin
suspend fun syncPhotos() {
    val unsyncedPhotos = photoDao.getUnsynced()

    for (photo in unsyncedPhotos) {
        try {
            val file = File(photo.localPath)
            apiService.uploadPhoto(photo.uuid, photo.registryUuid, file)
            photoDao.markSynced(photo.uuid)
        } catch (e: Exception) {
            // Will retry on next sync cycle
        }
    }
}
```

One edge case earned dedicated handling: photos whose local file has vanished (cleared cache, deleted from the gallery). Retrying those forever would clog every future sync, so they're marked as synced with a sentinel path instead. A tombstone in a sync queue beats an immortal failure.

### Conflict Handling

The original plan was **last-write-wins** at the record level, with the server merging non-null fields for the rare concurrent edit. What ended up in production is more boring, and better: **avoiding conflicts by design**. Downloads only insert records that don't exist locally (matched by UUID) and never overwrite local data; the one change the server is allowed to push over a local record is a cancellation. In the other direction, an incident or emergency with a server ID goes up as an update and one without as a creation; a patrol is only ever created or cancelled. Since field workers operate in different zones, genuine concurrent edits of the same record essentially don't occur, and the architecture no longer needs to resolve what it structurally prevents.

### When the Device Is the Wrong Place to Compute

The biggest architectural change since launch came not from a design insight but from an Android platform limit. When a patrol ends, the raw GPS track gets re-matched against the road network as a whole, a global cleanup pass that produces the polished route shown in the history. That job originally ran on-device in a background worker, and reality intervened: Android's JobScheduler kills background work after roughly ten minutes, and long urban patrols never finished processing.

The fix inverted the flow. The track now uploads immediately when the patrol ends, raw, with the matched coordinates left empty, and the server computes the re-match. The app fetches the result the next time the patrol is opened; if the server hasn't finished yet, it simply shows the raw track, which is perfectly usable, and tries again on the next open. No spinner, no error state.

The division of labor is deliberate. The device still computes the official attribution (which road, which KM) live during the patrol, because that's the business data the worker needs on the spot. What moved to the server is the cosmetic pass that aligns the drawn route with the map, handled by a small worker process running GraphHopper's map matching over OpenStreetMap data, polling the patrol table as its job queue.

There's a lesson in that for offline-first dogma. The doctrine says "compute locally," but what it really means is "degrade gracefully." Uploading raw data eagerly and treating the polished version as a progressive enhancement turned out to be more offline-friendly than insisting the device do everything itself.

---

## 11. Lessons Learned

After months of development and real-world deployment, here are the key takeaways:

### GeoPackage is underrated and under-documented

For Android apps that need offline spatial data, GeoPackage is a hidden gem. But be prepared to struggle. The documentation is sparse, the community is small, and there's very little practical content about it online. I spent more time reading source code than documentation. That said, the technology itself is solid. Being able to run spatial queries locally on a phone, with sub-millisecond response times, was a game changer once I got it working.

### Offline-first is a mindset, not a feature

You can't bolt offline support onto an app designed for connectivity. It has to be the foundation. Every screen, every flow, every data model must assume the network doesn't exist. When you design this way, the online case becomes trivially easy: it's just sync.

### The office is not the field

The most valuable feedback didn't come from meetings or design reviews. It came from the field workers themselves, starting with the early demos. Features I thought were intuitive weren't. Buttons I thought were big enough were too small. They told me the screen would be unreadable in direct sunlight. The vibrations I'd tuned in a quiet room would be imperceptible next to a highway. Those sessions reshaped entire flows before launch, and the pattern held afterward: now that the app is in production, the most useful bug reports and feature requests still come from the road, not the office.

### A single document can be enough, if you listen carefully

The entire project started from a brief document describing the client's pain points. No detailed specs, no wireframes, no user stories. Understanding what they actually needed (vs. what they literally wrote) required reading between the lines and asking a lot of questions. The document said "digitize forms." What they really needed was "eliminate manual data entry entirely."

### Simple sync beats clever sync

I initially considered more sophisticated sync strategies: operational transforms, vector clocks, conflict resolution UIs. What made it to production is `synced = false`, UUID-keyed idempotent uploads, and a data flow that prevents conflicts instead of resolving them. Months of real-world usage haven't produced a single case that needed more. Don't over-engineer sync unless you have evidence of actual conflicts.

### PostgreSQL functions are polarizing but effective

The "functions as API" approach wasn't my choice: it was already the established pattern at the company when I joined the project. I'll admit I was skeptical at first. But after working with it for months, I came to appreciate its strengths: excellent performance, business logic centralized in one place, and a very thin backend layer. It's not what I'd pick for every project, but for a stable schema with a small team, it works well. I wouldn't recommend it for a team of 20 with a rapidly changing data model, though.

### Jetpack Compose changes everything

Coming from the XML/View system, building complex UIs with Compose was dramatically faster. State management with `StateFlow`, reactive UIs that update automatically, and the ability to create reusable components made the entire development experience more enjoyable. The learning curve is real, but the productivity gains are worth it.

---

## Final Thoughts

Building this app pushed me into territory I hadn't explored before: geospatial computing, offline architecture, GPS signal processing, on-device ML for voice recognition, hardware integration with haptics. It's the kind of project that doesn't fit neatly into a "frontend" or "backend" box.

I'll be honest: there were moments where I felt completely out of my depth. Staring at GeoPackage geometry calculations at 2 AM, wondering if I'd chosen the wrong approach entirely. Debugging GPS drift on a highway shoulder in the rain. Trying to translate vague requirements into concrete features when the client knew they wanted *something* digital but wasn't sure exactly *what*.

But piece by piece, it came together. And the first time I watched a full patrol run start to finish, zero manual input, all data logged automatically, I knew the hard parts were worth it.

If you're working on something similar (an app that needs to work in harsh conditions, offline, with spatial data) I hope this breakdown gives you useful starting points. The stack (Kotlin + Jetpack Compose + Room + GeoPackage + MapLibre + PostgreSQL + VOSK) proved to be robust and capable.

The app has been in production since mid-2026, distributed as a self-hosted APK rather than through Google Play (a deliberate choice for a closed fleet of managed devices), with **Firebase Crashlytics** watching for issues in the field. The paper forms are gone. Patrols that used to end with manual data entry back at the office now end when the driver parks the vehicle. That's the kind of impact that makes the technical challenges worth it.

---

**Thanks for reading. If you found this useful, feel free to share it with anyone tackling similar challenges.**
