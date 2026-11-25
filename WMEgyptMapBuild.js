// ==UserScript==
// @name         WMEgypt Map Build
// @namespace    WMEgypt.Map.Build
// @version      3.11.0
// @description  Draws the roads that OpenStreetMap has and WME is missing: mark an area, check the count, draw. Nothing is saved automatically.
// @author       WMEgypt Map Build
// @match        https://www.waze.com/*/editor*
// @match        https://www.waze.com/editor*
// @match        https://waze.com/*/editor*
// @match        https://waze.com/editor*
// @updateURL    https://gist.githubusercontent.com/1boosh/75a9c8d1a75f742ed988e69adb13976b/raw/wmegypt-map-build.user.js
// @downloadURL  https://gist.githubusercontent.com/1boosh/75a9c8d1a75f742ed988e69adb13976b/raw/wmegypt-map-build.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_info
// @grant        unsafeWindow
// @connect      overpass.nextgis.com
// @connect      api.openstreetmap.org
// @connect      overpass.private.coffee
// @connect      maps.mail.ru
// @connect      overpass.osm.ch
// @connect      overpass-api.de
// @run-at       document-idle
// ==/UserScript==

/* ======================================================================
   GUIDE — READ THIS FIRST
   This block is the map of the whole script. It is written for whoever
   edits the script next: the owner, or an AI assistant in a new
   conversation that has never seen this code before.
   ======================================================================

   CURRENT STATE (written at 3.10.4, 2026-10-07) - READ THIS BLOCK FIRST
   ----------------------------------------------------------------------
   The guide below was written at 3.8.0. Versions 3.8.1 to 3.10.3 were
   made as small patches, and not every paragraph of the guide and of
   the section headers was brought up to date. WHERE THIS BLOCK AND THE
   TEXT BELOW DISAGREE, THIS BLOCK IS RIGHT. Every change since 3.8.0
   has a dated comment ("3.9.2: ...") at the place where it was made;
   search for a version number to find it. 3.10.4 itself only added
   this block. The first job of the next full pass over the file: fold
   this block into the guide and the section headers, then delete it.

   A. What the guide below gets wrong today
     1. Marking the area does NOT start the scan (since 3.9.0).
        finishSelection() (Section 9) clears the old result and waits;
        the editor presses Start (button act 'scan', Section 10).
     2. Decision D4 is now the editor's choice per run.
        BATCH.TOUCH_EXISTING_ROADS is a getter that reads localStorage
        'wmb-touch-existing', set by the tick box under the Draw button
        (off by default; createUI case 'touch-existing'). When it is on,
        build step h calls connectToExistingSafely() (Section 7h). The
        rules agreed with the owner are in the comment above that
        function, with two later exceptions marked 1b and 2b inside it.
        batchConnectToExisting, tryConnectEndpoint and
        collectDanglingEndpoints are DEAD CODE kept for reference. Do
        not call them: they can shorten and move existing roads.
     3. D12: "a WME point within 40 m of the centre" only counts when a
        WME road also runs ALONG the OSM road (NEAR_ALONG_M and
        NEAR_ALONG_SHARE, Section 1; step 2b in scanArea).
     4. Road types (Section 6) follow the owner's ladder: residential 1,
        tertiary 2, secondary 7, primary 6, trunk 3, motorway 3.
        Pedestrian types are never read (NOT_DRAWN_ROAD_TYPES).
     5. The OpenStreetMap answer is cached (Section 3: sessionStorage,
        48 hours, a box padded by about 80 m). The first scan of an area
        may use it; "Scan again" never does (forceFreshOsm).
     6. batchCross (7g) writes the shape of the four pieces back after
        every crossing; the clean-up of Section 8 also removes shape
        points within NODE_CLEAR_M of a junction. See part B for why.
     7. The run log starts with the scan decisions, one line per
        OpenStreetMap road (comparisonData.report, built in scanArea).
     8. Numbers that are NOT in Section 1 yet: OSM_CACHE_* and the two
        cache variables (Section 3); the constants at the top of and
        inside connectToExistingSafely (Section 7h).
     9. The "CHANGES TO THIS SECTION" lists stop at 3.8.1.

   B. Facts about WME, its SDK and its server (each one cost at least
      one refused save; do not lose them)
     * The SDK hands out the shape of an UNSAVED segment rounded to 6
       decimals, apparently with equal neighbouring points dropped;
       nodes keep their full position. Writing a shape that was read
       back moves the ends off their nodes: server error 705 "segment
       is connected to node, but has a different coordinate at edge".
       wmeSegments() (Section 4) therefore puts both ends on the nodes
       in every updateSegment that carries a geometry. Never call
       sdk.DataModel.Segments.updateSegment with a geometry directly.
     * A shape point a few centimetres from a node cannot be seen
       through the SDK before the save. It appears when two lines cross
       on a shape point they share (WME rounds the node position). The
       server answers with warning 2006. Cured by the rewrite in
       batchCross. WME's own "drag a node onto a segment" leaves the
       same thing behind; that one is not ours.
     * updateSegment(geometry) on a segment that one of its end nodes
       does not list makes WME hang that end on a brand-new node at the
       same place. Check that both nodes list the segment first.
     * A SAVED segment that was split or deleted in the session is
       still returned by Segments.getAll(), with both node ids null,
       until the save. allSegments() (Section 4) drops those.
     * A new segment is a Street first (D6) and the server refuses to
       turn it into a pedestrian type: error 745.
     * "Segment is too short (might be a point)": zero-length legs and
       segments of about 1 m. See SPLIT_CLEAR_M, SHORT_SEGMENT_M and
       cleanCreatedGeometry.
     * Save warnings, where the editor may press "Save anyway":
       2000 possible disconnection; 2003 and 2009 isolated segment (all
       turns from it / into it are closed); 2006 intersecting segments
       with the same elevation.
     * Save size: about 70 roads (3,000 actions) took 150 s; 111 roads
       (4,500 actions) ended in a 504 after 5 minutes. Keep one save
       under about 70 roads.
     * The SDK cannot merge two nodes; all of Section 7 follows from
       that. Still left to the editor: a road end that must join a node
       which already joins other roads (a fifth road at a crossing
       gives "splitNode is null"), and any meeting closer than 3 m to a
       node of an existing road.
     * The lock test in connectToExistingSafely assumes that the SDK's
       user rank and lockRank both count from 0. Not verified.

   C. Temporary diagnostics still in the code
     * runLog.add (Section 8): a topology audit after every OK / FAIL /
       WARN line ("first seen after the step above"), about 0.1 s each.
     * connectEndpointByOvershoot (7d): the T-DEBUG block.
     * repairBrokenNewSegments (Section 8): the BROKEN lines.
     They exist for ONE open bug: in one area (around 30.9179, 30.2970)
     three T-junctions left the new node not listing the road that had
     just been joined to it, on every run with 3.8.4 to 3.8.6. The
     segment is deleted and reported (D14). It has not shown up in any
     other area and the cause is unknown. A run log with T-DEBUG lines
     is the data that is missing. Once it is solved, remove all three.

   D. Not tested when this was written
     3.10.2: scan decisions in the run log; warning for an existing
             dead end beside a new road.
     3.10.3: joining an existing dead end that touches a new road (1b);
             removing the shape point left beside a new junction on an
             existing road (2b).
     3.10.1 ran once: six ends joined to existing roads, audit clean;
     the answer to its save is not in the logs. The save of 3.10.0 was
     accepted. Without the tick box, the last save seen accepted with
     no warning at all was 3.9.2.

   E. Noted or agreed, not done
     * a list of its own in the panel for the "Check:" lines (they are
       in the warnings list for now)
     * showing the scan decisions without having to draw
     * removing the mid-line nodes of D8 once the junctions exist (the
       owner merges them by hand after every save today)
     * a warning when the build queue is large (save size)
     * pedestrian paths (they need their own type from the start)
     * one function instead of runsAlong (scanArea) and
       wayCoverageByExisting

   F. The companion script and the way of working
     "WMEgypt Save Monitor" is a separate userscript of the owner (not
     in the Gist). It logs every save request, the server's answer, the
     actions that mention the refused objects, and edit and selection
     events; it has a "Check new segments" button. Every server rule in
     part B was found with it. What worked: the owner draws a SMALL
     area, sends the run log and the Save Monitor log, one fix per
     round. When a save is refused or something looks wrong on the map,
     ask for both logs before changing anything.

   WHAT THE SCRIPT DOES
   --------------------
   A Tampermonkey userscript for the Waze Map Editor (WME). The editor
   marks an area on the map. The script asks OpenStreetMap (through the
   Overpass API) for the roads in that area, compares them with the roads
   WME already has, and draws the missing ones as unsaved WME edits:
   geometry, junctions between the new roads, road type, direction,
   speed, lanes, street name and city. The editor checks the result and
   presses Save in WME himself.

   HOW IT IS DISTRIBUTED
   ---------------------
   One file in a GitHub Gist. Colleagues install it once from the raw
   link; Tampermonkey then checks @updateURL about once a day and
   installs a newer copy when the @version number in the header above is
   HIGHER than the installed one. So:

     * @version in the header is the ONLY version number in the file.
       SCRIPT_VERSION (Section 1) reads it through GM_info. Never write
       a version number anywhere else.
     * Every published change must raise @version, or nobody gets it.

   THE SECTIONS
   ------------
   The file is ONE function (an IIFE) cut into 12 sections. A section
   starts at its banner line (a line of block characters with the
   section name) and ends on the line before the next banner.

     1  CONFIG     Every number and switch, and the state shared by
                   several sections.
     2  CORE       Small helpers and pure geometry (distances, crossings,
                   clipping). Knows nothing about WME, OSM or the panel.
     3  OSM        Reading roads from OpenStreetMap: servers, query,
                   parsing, reading tags (name, city...).
     4  WME        Talking to the editor: SDK start-up, map view,
                   segments, nodes, and the list of what this script drew.
     5  SCAN       Deciding which OSM roads are missing from WME.
     6  PROPS      Turning OSM tags into WME values: road type,
                   direction, speed, lanes, flags, name, city.
     7  JUNCTIONS  Turning roads into WME segments that are joined to
                   each other. The hardest part of the script.
     8  BUILD      The "Draw" button: what to draw for each road, the
                   order of the steps, the checks, the run log.
     9  SELECT     Marking the area on the map (box or free shape) and
                   showing its outline.
    10  UI         The panel: steps, buttons, texts, result, log window.
    11  STYLE      The CSS: colours and layout of the panel.
    12  START      init(): the only code that runs when the file loads.

   WHERE A REQUEST USUALLY LANDS
   -----------------------------
     "change a number / a limit / a default"        -> 1
     "add or remove an Overpass server"             -> 1 (list), 3 (logic)
     "a road is wrongly counted as missing/present" -> 5
     "wrong road type / speed / name / city"        -> 6
     "roads are not joined / broken segments"       -> 7
     "draw only inside the area / change the steps" -> 8
     "a different way to mark the area"             -> 9
     "add a button / change a message"              -> 10 (and 1 for a
                                                      new switch)
     "change colours / sizes"                       -> 11

   HOW TO CHANGE THIS SCRIPT (rules for the editor / AI assistant)
   ---------------------------------------------------------------
   1. Work out which section(s) the request touches. Read the header of
      each of those sections first: it says what the section does, what
      it uses from other sections and who uses it.
   2. Hand back ONLY the sections that changed, each one COMPLETE, from
      its banner line to the line before the next banner, ready to paste
      over the old one. Never hand back fragments, and never write
      "rest unchanged" inside a section. Do not reprint sections that
      did not change.
   3. Say which new @version the owner must type in the header (patch
      number for fixes, minor number for features), and add one line to
      "CHANGES TO THIS SECTION" in the header of every section you
      changed. That list travels with the section, so there is no
      separate changelog to maintain.
   4. Do not change the header (@grant, @connect, @match, URLs) unless
      the request needs it; if it does, say so clearly, because the
      owner edits the header by hand.
   5. One scope: every section lives inside the same IIFE, so functions
      and variables are shared directly, with no imports. Function
      declarations are hoisted, so the order of functions does not
      matter. But top-level const/let are only usable after their line
      has run, therefore:
        * no section runs code at load time; only Section 12 does;
        * a new number or switch goes into Section 1;
        * state used by more than one section goes into Section 1,
          state used by one section stays at the top of that section.
   6. Do not monkey-patch (reassign a function from another section).
      Change the function where it lives.
   7. Comments are in English and explain WHY, not only what. When you
      add a workaround for a WME or SDK limit, write down the error
      message or the symptom that made it necessary.
   8. Some code paths are switched off by a flag in Section 1 and are
      kept on purpose (see the decisions below). Do not delete them
      unless the owner asks.
   9. After a change the owner tests in WME: the panel shows the new
      version; mark a small area; scan; draw; look at the run log; make
      sure Save is not refused; undo.

   HOW THE OWNER PUBLISHES A CHANGE
   --------------------------------
   Paste each returned section over the old one, raise @version in the
   header, test locally in Tampermonkey, then paste the whole file into
   the Gist and press "Update secret gist".

   THE FLOW, END TO END
   --------------------
     Section 12  init()            injects CSS, builds the panel, starts
                                   the SDK.
     Section 9   startSelection()  the editor marks the area ->
                 finishSelection() stores selectedRing / selectedBounds
                                   and calls scanArea().
     Section 5   scanArea()        WME roads + OSM roads -> the list of
                                   missing roads in comparisonData.
     Section 10  the panel shows the count and the road-type chips.
     Section 8   buildMissingRoads()
                   a. decide what part of each road to draw
                   b. buildBatchNetwork()        (7) roads -> lines
                   c. addSegment for every line  (SDK)
                   d. splitLinesJoinedAtBothEnds (7)
                   e. runBatchJunctions()        (7) crossings, T's
                   f. rekeyBatchOwners()         (7)
                   g. fixTwoSegmentLoops()       (7)
                   h. existing roads: connect (7, off) or list open ends
                   i. applyBatchProperties()     (6)
                   j. audits + run log           (8)

   WORDS USED IN THE CODE
   ----------------------
     way      one OpenStreetMap road (an OSM "way"): tags + node ids +
              coordinates.
     ring     the marked area: a list of [lon, lat] corners. A box is a
              ring with four corners.
     edge     a piece of a way between two junction nodes.
     stroke   (called "line" in the run log) several edges chained
              THROUGH junctions and drawn as one WME segment at first.
     owner    an entry of createdWmeSegments: the list of WME segment
              ids that currently make up one drawn thing. Segments get
              new ids every time WME splits them, so every split must
              update the owner (replaceCreatedSegmentId).
     stub     the tiny helper piece left over after a T-junction is
              made by overshooting; it is deleted right away.
     existing a WME segment the script did not draw in this session.

   CURRENT DESIGN DECISIONS, AND WHY
   ---------------------------------
   These explain why the code looks the way it does. They are NOT fixed
   rules: the owner may ask to change any of them (for example a button
   that allows editing existing roads). They are listed so that a change
   is made knowingly, and so that an old problem is not brought back by
   accident. Each one names the switch or the place that controls it.

   D1  Nothing is saved automatically. Everything the script does is an
       unsaved WME edit; the editor reviews it and saves or undoes.

   D2  Only official SDK calls are used.
       Switch: USE_INTERNAL_WME_ACTIONS = false (Section 1).
       Why: WME's internal actions (W.model / MoveAndMergeNode) left
       node links half-updated, and Save was then refused with
       "Node X is not connected to segment Y".

   D3  Roads are drawn as long lines THROUGH junctions, then cut.
       Why: the SDK cannot merge two nodes. The only calls that create
       a shared node are addIntersection (two lines that really cross)
       and splitSegment. So road ends are paired at every junction and
       drawn as one line, and each junction becomes a true crossing
       (addIntersection) or a T made by overshooting 1.5 m and trimming
       the stub. See Section 7.

   D4  Existing WME roads are not touched: not split, shortened, moved
       or retyped. New roads are joined to each other only, and every
       open end beside an existing road is listed in the run log for
       the editor to join by hand.
       Switch: BATCH.TOUCH_EXISTING_ROADS = false (Section 1).
       The code that joins new roads to existing ones is still here
       (batchConnectToExisting, Section 7) but it is off and has had
       much less testing than the rest. If a button for it is added,
       treat that path as experimental and check the audits (Section 8)
       after every run.

   D5  The "merge two segments, then cross through the old node" trick
       is off. Switch: BATCH.ALLOW_MERGE_JOIN = false (Section 1).
       Why: in testing it corrupted node links (audit: "node does not
       list segment"). A road end that must join a node which already
       joins other roads is reported for manual connection instead.

   D6  addIntersection needs both segments to have the same road type.
       All new lines are therefore drawn with BATCH.BASE_ROAD_TYPE and
       get their real type only at the end (Section 6). When the types
       differ anyway, the temporary retype is applied only to a segment
       this script drew, never to an existing road.

   D7  Two segments are handed to addIntersection only when they meet
       in exactly ONE place.
       Why: addIntersection cuts both segments at EVERY place they meet
       but creates only one node, and gives that node to all the cut
       ends. The pieces at the second place then point at a node that
       is not there: broken segments. So a node is added between the
       two places first (separateBeforeJunction, Section 7).

   D8  A line that ends on other lines at BOTH ends gets a node in its
       middle before any junction is made.
       Why: joined at both ends as one segment, the second junction left
       the node of the first without a link to the road.

   D9  Loops. A line that comes back to its own end is cut into three
       segments before its end is joined (WME cannot join a segment to
       itself). Two new segments between the same two nodes get an extra
       node (routing cannot tell a two-segment loop apart). Closed OSM
       ways (roundabouts) are skipped: the WME roundabout tool does them
       better.

   D10 The marked area must be fully on screen, and no road is drawn
       past the edge of the screen.
       Why: WME only holds the roads of the visible map. Anything
       outside would look "missing" and be drawn on top of a road that
       already exists.

   D11 From zoom 16 only (ALL_STREETS_ZOOM). Below that WME does not
       load every street, so existing streets would be counted as
       missing. The panel warns; it does not block.

   D12 What counts as a road of the area: at least CLIP_MIN_PIECE_M
       (20 m) of it inside. What counts as already present: a WME road
       within 40 m of the centre of the inside part, or half of the
       inside part running along existing WME roads (within 6 m and
       about 30 degrees).

   D13 A road that belongs to the area is drawn WHOLE, also outside the
       area, so that roads are not left cut in half at an arbitrary
       line. Exceptions: it stops at the screen edge (D10), and if its
       outside part is already in WME (OUTSIDE_COVERED_SHARE) it is cut
       at the edge of the area instead.

   D14 After the build, the node/segment lists are audited. A NEW
       segment whose node link is broken is deleted and reported,
       because it would block Save for everything else.

   D15 OpenStreetMap is asked through several Overpass servers at once
       ("hedging"): if the first has not answered after 4 s the next is
       asked as well; the first good answer wins and is remembered.

   D16 SDK pixel positions are window coordinates (the same numbers as
       event.clientX / clientY). Do not subtract the map position when
       converting; that bug has been made before.

   D17 The marked area is drawn on the map as a LINE layer, not a
       polygon, so it never sits between the mouse and the roads.

   HISTORY BEFORE THE RESTRUCTURE
   ------------------------------
     3.4.0  a road line that loops back onto itself is cut into three
            segments and joined; two-segment loops get an extra node.
     3.5.0  faster reading from OpenStreetMap (several servers, first
            answer wins, winner remembered).
     3.6.0  the area can be a free shape as well as a box.
     3.7.0  two roads that meet in more than one place get a node
            between the two places before they are joined; short roads
            drawn inside a longer line are no longer offered again.
     3.7.1  a line that ends on other lines at both ends gets a node in
            its middle first.
     3.8.0  restructure into 12 sections. No change in behaviour: code
            was moved, the old "engine patches" were folded into the
            functions they patched, comments were rewritten.
   ====================================================================== */

(function () {
    'use strict';

// ████████████████████████  SECTION 1 — CONFIG  ████████████████████████

    /* ================================================================
       SECTION 1 — CONFIG: numbers, switches and shared state

       PURPOSE   The one place to look for a number or an on/off switch.
                 Also holds the state that several sections share.
       USES      nothing.
       USED BY   every section.
       NOTES     * Lengths are metres unless the name says otherwise.
- A few thresholds are still written inside the
                   functions that use them (Section 5: the 40 m centre
                   match, the 6 m / 30 degree "runs along" test, the 0.5
                   share). Move them here when they need to change.

       CHANGES TO THIS SECTION
         3.8.0   created by the restructure.
         3.11.0  added fast OSM v0.6 map.json endpoint settings, removed
                 dead Overpass endpoints (z., lz4., kumi.systems), lowered
                 hedge delay to 1000 ms, and moved OSM cache state here.
         3.12.0  added CUSTOM_OVERPASS_HEDGE_MS and ui.apiError for the
                 custom NextGIS / Overpass API endpoint input.
       ================================================================ */

    /* ---------------- identity ---------------- */

    const SCRIPT_NAME = 'WMEgypt Map Build';
    const SCRIPT_ID = 'wme-map-build';         // id given to the WME SDK

    // The version is NOT written here. It is read from the @version line
    // in the script header, so there is only one number to change.
    const SCRIPT_VERSION =
        (typeof GM_info !== 'undefined' && GM_info?.script?.version) || '0.0.0';

    const SETTINGS_KEY = 'wmb-panel-v3';       // localStorage: panel position, last good server, custom API
    const AREA_LAYER = 'wme-map-build-area';   // name of the map layer that shows the marked area

    /* ---------------- scan (Section 5) ---------------- */

    // 3.8.5: OSM ways whose WME road type would be one of these are not
    // read at all (parseOsmRoads, Section 3). They are the pedestrian
    // types (5 Walking Trail, 9 Walkway, 10 Pedestrian Boardwalk,
    // 16 Stairway), i.e. OSM footway, path, steps, pedestrian, cycleway,
    // bridleway and corridor. Every new line is first drawn as a Street
    // (decision D6) and gets its real type at the end, and the server
    // refuses that change for pedestrian types. One 30 m footway made a
    // whole save fail with
    //   [745] Cannot convert non-WT type 1 to a WT type 5 for segment
    // and deleting the segment afterwards does not help, because the save
    // replays every step in order. To support these paths they would have
    // to be drawn with their own type from the start and kept out of
    // addIntersection with driven roads.
    const NOT_DRAWN_ROAD_TYPES = new Set([5, 9, 10, 16]);

    const ALL_STREETS_ZOOM = 16;            // WME loads every street only from this zoom
    const CLIP_MIN_PIECE_M = 20;            // less than this inside the area = not a road of this area
    const COMPARE_GRID_CELL_DEGREES = 0.005; // grid used to find WME roads near an OSM road quickly
    // 3.9.2: the first "already in WME" test of the scan (a WME shape point
    // within 40 m of the road's centre) only stands when a WME road really
    // runs ALONG the OSM road: within NEAR_ALONG_M and about 30 degrees,
    // for at least NEAR_ALONG_SHARE of the part inside the area. Without
    // this a short road that ends on an existing junction was never
    // offered: a 46 m road has its centre about 25 m from the node at its
    // end. NEAR_ALONG_M must stay below one coverage grid cell (about
    // 19 m), because the test looks only one cell around each sample.
    const NEAR_ALONG_M = 15;
    const NEAR_ALONG_SHARE = 0.3;
    const COVERAGE_CELL_DEG = 0.0002;       // grid used by the "already covered by WME" test

    /* ---------------- build (Section 8) ---------------- */

    const OUTSIDE_COVERED_SHARE = 0.5;      // outside part this much in WME already = cut the road at the area edge
    const NODE_GAP_PROBLEM_M = 0.3;         // a segment end this far from its node is a real break

    /* ---------------- junctions (Section 7) ---------------- */

    const MIN_LOOP_M = 15;                  // a loop shorter than this is not cut into three
    const CONTACT_M = 0.1;                  // a point of one line this close to another line touches it
    const SAME_PLACE_M = 1;                 // contacts this close together are one meeting place
    const JUNCTION_ZONE_M = 2.5;            // contacts this close to a junction belong to that junction
    // 3.8.3: a node the script adds by itself (splitBetween, Section 7b) is
    // kept this far from every shape point of the line. Any shape point can
    // be an OSM junction that becomes a node a moment later; a node added
    // 0.8 m from one left a segment about 1 m long, and WME refused the
    // save with "Segment is too short (might be a point)".
    const SPLIT_CLEAR_M = 5;
    // 3.8.3: a new segment shorter than this is reported as a problem
    // (Section 8, auditCreatedGeometry). WME's real limit is not known;
    // about 1.1 m was refused, and the old limit of 1 m let it through.
    const SHORT_SEGMENT_M = 2;
    // 3.8.4: after the build, every shape point of a new segment that lies
    // closer than this to one of the segment's two end nodes is removed
    // (Section 8, cleanCreatedGeometry). The junction steps leave such
    // points behind on purpose (a T is made 0.3 m NEXT to a shape point,
    // see offsetCrossingPoint), but a shape point right beside a node
    // gives a wrong turn angle at the junction and is hard to see and fix
    // by hand. The road shape moves by less than this distance.
    const NODE_CLEAR_M = 2;
    const MIN_SEPARATE_GAP_M = 6;           // two meeting places closer than this along a road cannot be separated

    const TOPO = {
        CREATED_SNAP_M: 5.0,              // free end of a NEW road -> any road
        EXISTING_DEAD_END_SNAP_M: 3.0,    // free end of an EXISTING road -> a NEW road
        CONNECT_EXISTING_DEAD_ENDS: true, // only matters when TOUCH_EXISTING_ROADS is on
        NODE_SNAP_M: 1.5,                 // prefer joining a node this close
        OVERSHOOT_M: 1.5,                 // how far to push a road end past the target for a T
        CROSS_END_MARGIN_M: 1.0,          // crossings nearer than this to an end = endpoint junction
        MAX_ITERATIONS: 200
    };

    const JOIN = {
        TRIM_M: 2.0                       // end-to-end join: cross the target this far before its end
    };

    const BATCH = {
        BASE_ROAD_TYPE: 1,                // temporary type while connecting (decision D6)
        POINT_EPS_M: 0.35,                // two points this close are the same point
        // merge-then-split node join: corrupted node links in testing (decision D5)
        ALLOW_MERGE_JOIN: false,
        // false: existing WME roads are never split, shortened or retyped;
        // open ends are listed for the editor instead (decision D4)
        // 3.9.0: no longer fixed. Read on every use from the switch the
        // editor sets in the panel (kept in the browser, off by default),
        // so decision D4 becomes the editor's choice per run. The path it
        // switches on is EXPERIMENTAL: it splits or moves existing roads.
        get TOUCH_EXISTING_ROADS() {
            try {
                return localStorage.getItem('wmb-touch-existing') === '1';
            } catch (error) {
                return false;
            }
        }
    };

    // Internal (non-SDK) WME actions. Off: they can leave node links
    // half-updated, which later fails on Save with
    // "Node X is not connected to segment Y" (decision D2).
    const USE_INTERNAL_WME_ACTIONS = false;

    /* ---------------- OpenStreetMap / Overpass (Section 3) ---------------- */

    // Official OSM Editing/Read API v0.6 (cgimap C++ daemon): returns full
    // node+way JSON in ~150-400 ms for small/medium boxes without Overpass
    // query-planner queues. Hard API limit is 0.25 deg^2; capped lower here
    // so large boxes don't download excessive non-road elements.
    const OSM_MAP_API_URL = 'https://api.openstreetmap.org/api/0.6/map.json';
    const OSM_MAP_API_MAX_AREA_DEG2 = 0.0025; // ~5 km x 5 km at Egypt's latitude
    const OSM_MAP_API_TIMEOUT_MS = 8000;

    // 3.11.0: removed z.overpass-api.de and lz4.overpass-api.de (they accept
    // connections and hang 1-2 min until timeout per OSM wiki) and retired
    // kumi.systems (replaced by private.coffee). Ordered fastest-first.
    const OVERPASS_SERVERS = [
        'https://overpass.private.coffee/api/interpreter',
        'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
        'https://overpass.osm.ch/api/interpreter',
        'https://overpass-api.de/api/interpreter'
    ];
    // Every host above (plus api.openstreetmap.org and overpass.nextgis.com)
    // needs a "// @connect" line in the header.

    const OVERPASS_BUILD_TIMEOUT_SECONDS = 25;       // time the server may spend on the query
    const OVERPASS_BUILD_CLIENT_TIMEOUT_MS = 35000;  // time we wait for the whole area
    const OVERPASS_TILE_FALLBACK_TIMEOUT_MS = 25000; // time we wait for one of the four tiles
    const OVERPASS_HEDGE_MS = 1000;                  // no answer after 1 s: ask the next server as well
    const CUSTOM_OVERPASS_HEDGE_MS = 4000;           // give user's custom NextGIS server 4 s before hedging
    const OVERPASS_MAX_PARALLEL = 3;                 // never more than this many servers at once

    const OSM_CACHE_KEY = 'wmb-osm-cache-v1';
    const OSM_CACHE_MAX_AGE_MS = 48 * 60 * 60 * 1000;
    const OSM_CACHE_PAD_DEG = 0.0008;                // about 80 m
    let forceFreshOsm = false;                       // true: the next scan must fetch fresh data
    let osmCacheAgeMin = null;                       // minutes; null when the last scan fetched live

    /* ---------------- texts used in more than one place ---------------- */

    const OFF_SCREEN_MESSAGE =
        'Move the map until the whole marked area is on screen. WME only knows the roads of the visible map, ' +
        'so anything outside it would look missing and be drawn a second time.';

    /* ---------------- shared state ---------------- */

    let sdk = null;                          // the WME SDK object, set by initSDK() (Section 4)
    let comparisonData = null;               // result of the last scan (Section 5)

    // What this script drew: key -> owner { segmentIds: [...], ... }.
    // During the junction step the key is a temporary "batch-..." id per
    // line; rekeyBatchOwners() (Section 7) then stores one owner per OSM
    // way id ("123", or "123~2" for the second piece of a cut way).
    const createdWmeSegments = new Map();

    let selectedBounds = null;  // box around the marked area { south, north, west, east }
    let selectedRing = null;    // the marked area itself: [[lon, lat], ...], not repeated at the end
    let selectedIsBox = true;   // false when the area is a free shape
    let batchRunning = false;   // true while buildMissingRoads() is working

    // Everything the panel needs to draw itself (Section 10 reads it,
    // Sections 5, 8 and 9 write it and then call render()).
    const ui = {
        sdkError: '',
        selecting: false,
        areaError: '',
        extentCheck: false,    // true once the SDK map extent proved usable
        scanning: false,
        scanToken: 0,          // raised by every scan; an older scan that answers late is ignored
        scanError: '',
        scanZoom: null,
        scanInfo: null,        // { seconds, host } of the last OpenStreetMap answer
        apiError: '',          // validation message for the custom Overpass/NextGIS input
        buildBlock: '',
        offScreenAsked: false, // the editor was told that roads run off screen
        status: '',
        result: null
    };
    const excludedHighways = new Set(); // OSM highway types the editor unticked
    const skippedOsmIds = new Set();    // ways the last build refused (already in WME...)
    const drawnOsmIds = new Set();      // ways drawn since the last scan

// ████████████████████████  SECTION 2 — CORE  ████████████████████████

    /* ================================================================
       SECTION 2 — CORE: small helpers and pure geometry

       PURPOSE   Functions that only compute. They know nothing about
                 WME, OpenStreetMap or the panel, so they can be reused
                 anywhere and almost never need to change.
       USES      Section 1 (SCRIPT_NAME, SETTINGS_KEY).
       USED BY   every section.
       NOTES     * A coordinate is [lon, lat] (GeoJSON order) everywhere
                   except distanceMeters() and pointInside(), which take
                   lat, lon as separate arguments.
                 * Geometry is done on a flat approximation: degrees are
                   turned into metres with metersPerDegree(). That is
                   accurate to centimetres over the few hundred metres
                   the script works with.

       CHANGES TO THIS SECTION
         3.8.0  created by the restructure (code unchanged).
       ================================================================ */

    /* ---------------- general helpers ---------------- */

    function log(...args) {
        console.log(`[${SCRIPT_NAME}]`, ...args);
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Runs fn and returns its result, or the fallback when it throws.
    // Used around SDK getters that are not there in every WME version.
    function safeCall(fn, fallback = '?') {
        try {
            return fn();
        } catch (error) {
            return fallback;
        }
    }

    // Every text that goes into innerHTML passes through this.
    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function plural(count, word) {
        return `${count} ${word}${count === 1 ? '' : 's'}`;
    }

    // Lower case, single spaces, no punctuation (Latin and Arabic comma).
    function normalizeName(name) {
        return String(name || '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .replace(/[،,.;:()[\]{}"'`]/g, '');
    }

    function hostOf(url) {
        return safeCall(() => new URL(url).host, String(url || ''));
    }

    /* ---------------- settings kept between page loads ---------------- */

    function loadSettings() {
        try {
            return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
        } catch (error) {
            return {};
        }
    }

    function saveSettings(patch) {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...loadSettings(), ...patch }));
        } catch (error) { /* storage unavailable */ }
    }

    /* ---------------- distances ---------------- */

    // Great-circle distance. Arguments are lat, lon (not [lon, lat]).
    function distanceMeters(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const p1 = lat1 * Math.PI / 180;
        const p2 = lat2 * Math.PI / 180;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // Distance from a point to a GeoJSON LineString geometry.
    function pointToLineStringDistanceMeters(lat, lon, geometry) {
        const safeLat = Number(lat);
        const safeLon = Number(lon);
        if (!Number.isFinite(safeLat) || !Number.isFinite(safeLon)) return Infinity;

        const coords = Array.isArray(geometry?.coordinates) ? geometry.coordinates : [];
        if (!coords.length) return Infinity;

        const lat0 = safeLat * Math.PI / 180;
        const metersPerDegLat = 111320;
        const metersPerDegLon = 111320 * Math.cos(lat0);
        const px = safeLon * metersPerDegLon;
        const py = safeLat * metersPerDegLat;

        const toXY = point => {
            const lon2 = Number(point?.[0]);
            const lat2 = Number(point?.[1]);
            if (!Number.isFinite(lon2) || !Number.isFinite(lat2)) return null;
            return [lon2 * metersPerDegLon, lat2 * metersPerDegLat];
        };

        if (coords.length === 1) {
            const q = toXY(coords[0]);
            return q ? Math.hypot(px - q[0], py - q[1]) : Infinity;
        }

        let best = Infinity;
        for (let i = 1; i < coords.length; i += 1) {
            const a = toXY(coords[i - 1]);
            const b = toXY(coords[i]);
            if (!a || !b) continue;
            const vx = b[0] - a[0];
            const vy = b[1] - a[1];
            const wx = px - a[0];
            const wy = py - a[1];
            const vv = vx * vx + vy * vy;
            const t = vv > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / vv)) : 0;
            const d = Math.hypot(px - (a[0] + t * vx), py - (a[1] + t * vy));
            if (d < best) best = d;
        }
        return best;
    }

    /* ---------------- points, boxes, lengths ---------------- */

    // How many metres one degree is at this latitude.
    function metersPerDegree(lat) {
        const r = Number(lat) * Math.PI / 180;
        return { x: 111320 * Math.max(0.1, Math.cos(r)), y: 110540 };
    }

    // A clean [lon, lat] pair of numbers, or null.
    function asLonLat(point) {
        if (!Array.isArray(point) || point.length < 2) return null;
        const lon = Number(point[0]);
        const lat = Number(point[1]);
        return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
    }

    // Distance between two [lon, lat] points (flat approximation).
    function distanceM(a, b) {
        const p = asLonLat(a);
        const q = asLonLat(b);
        if (!p || !q) return Infinity;
        const m = metersPerDegree((p[1] + q[1]) / 2);
        return Math.hypot((p[0] - q[0]) * m.x, (p[1] - q[1]) * m.y);
    }

    function lineLengthM(coords) {
        let total = 0;
        for (let i = 1; i < (coords?.length || 0); i++) total += distanceM(coords[i - 1], coords[i]);
        return total;
    }

    // Bounding box of a LineString geometry, in degrees.
    function geometryBounds(geometry) {
        const coordinates = Array.isArray(geometry?.coordinates) ? geometry.coordinates : [];
        if (coordinates.length < 2) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const point of coordinates) {
            if (!Array.isArray(point) || point.length < 2) continue;
            const x = Number(point[0]);
            const y = Number(point[1]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            minX = Math.min(minX, x); minY = Math.min(minY, y);
            maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
        return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
    }

    function boxesOverlap(a, b, epsilon = 0.000001) {
        return !!a && !!b &&
            a.minX <= b.maxX + epsilon &&
            a.maxX + epsilon >= b.minX &&
            a.minY <= b.maxY + epsilon &&
            a.maxY + epsilon >= b.minY;
    }

    function expandBox(box, meters) {
        if (!box) return null;
        const m = metersPerDegree((box.minY + box.maxY) / 2);
        return {
            minX: box.minX - meters / m.x,
            maxX: box.maxX + meters / m.x,
            minY: box.minY - meters / m.y,
            maxY: box.maxY + meters / m.y
        };
    }

    function pointBox(point, meters) {
        const p = asLonLat(point);
        return p ? expandBox({ minX: p[0], maxX: p[0], minY: p[1], maxY: p[1] }, meters) : null;
    }

    // bounds is { south, north, west, east }. Arguments are lat, lon.
    function pointInside(lat, lon, bounds) {
        return (
            lat >= bounds.south &&
            lat <= bounds.north &&
            lon >= bounds.west &&
            lon <= bounds.east
        );
    }

    // "lat, lon" with six decimals, for messages and the run log
    // (the order people paste into a map search).
    function fmtPoint(p) {
        const q = asLonLat(p);
        return q ? `${q[1].toFixed(6)}, ${q[0].toFixed(6)}` : '?';
    }

    /* ---------------- nearest points and crossings ---------------- */

    function closestPointOnLineSegmentMeters(point, a, b) {
        if (!Array.isArray(point) || !Array.isArray(a) || !Array.isArray(b)) return null;
        const lat = ((Number(point[1]) + Number(a[1]) + Number(b[1])) / 3) * Math.PI / 180;
        const mLon = 111320 * Math.max(0.1, Math.cos(lat));
        const mLat = 110540;
        const px = Number(point[0]) * mLon, py = Number(point[1]) * mLat;
        const ax = Number(a[0]) * mLon, ay = Number(a[1]) * mLat;
        const bx = Number(b[0]) * mLon, by = Number(b[1]) * mLat;
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        const qx = ax + t * dx, qy = ay + t * dy;
        return {
            coordinates: [qx / mLon, qy / mLat],
            distanceSquaredMeters: (px - qx) * (px - qx) + (py - qy) * (py - qy),
            t
        };
    }

    // Nearest point of a line to a point: { coordinates, distance,
    // segIndex (which leg), distToStart, distToEnd }.
    function nearestPointOnLine(point, coords) {
        if (!Array.isArray(coords) || coords.length < 2) return null;
        let best = null;
        for (let i = 0; i < coords.length - 1; i++) {
            const c = closestPointOnLineSegmentMeters(point, coords[i], coords[i + 1]);
            if (!c) continue;
            const d = Math.sqrt(c.distanceSquaredMeters);
            if (!best || d < best.distance) best = { coordinates: c.coordinates, distance: d, segIndex: i };
        }
        if (best) {
            best.distToStart = distanceM(best.coordinates, coords[0]);
            best.distToEnd = distanceM(best.coordinates, coords[coords.length - 1]);
        }
        return best;
    }

    // Where leg a->b crosses leg c->d: { coordinates, t, u } (t and u
    // are the shares 0..1 along each leg), or null. Parallel legs give null.
    function findLineIntersectionPoint(a, b, c, d) {
        if (![a, b, c, d].every(p => Array.isArray(p) && p.length >= 2)) return null;
        const lat = ((Number(a[1]) + Number(b[1]) + Number(c[1]) + Number(d[1])) / 4) * Math.PI / 180;
        const mx = 111320 * Math.max(0.1, Math.cos(lat));
        const my = 110540;
        const ax = Number(a[0]) * mx, ay = Number(a[1]) * my;
        const bx = Number(b[0]) * mx, by = Number(b[1]) * my;
        const cx = Number(c[0]) * mx, cy = Number(c[1]) * my;
        const dx = Number(d[0]) * mx, dy = Number(d[1]) * my;
        const rX = bx - ax, rY = by - ay;
        const sX = dx - cx, sY = dy - cy;
        const den = rX * sY - rY * sX;
        if (Math.abs(den) < 1e-9) return null;
        const qX = cx - ax, qY = cy - ay;
        const t = (qX * sY - qY * sX) / den;
        const u = (qX * rY - qY * rX) / den;
        const EPS = 1e-7;
        if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
        return { coordinates: [(ax + t * rX) / mx, (ay + t * rY) / my], t, u };
    }

    // A real X-crossing that is not near any endpoint of either line.
    function findInteriorCrossing(geomA, geomB, marginM) {
        const a = geomA?.coordinates || [];
        const b = geomB?.coordinates || [];
        if (a.length < 2 || b.length < 2) return null;

        const lenA = lineLengthM(a);
        const lenB = lineLengthM(b);
        let alongA = 0;

        for (let i = 0; i < a.length - 1; i++) {
            const legA = distanceM(a[i], a[i + 1]);
            let alongB = 0;
            for (let j = 0; j < b.length - 1; j++) {
                const legB = distanceM(b[j], b[j + 1]);
                const hit = findLineIntersectionPoint(a[i], a[i + 1], b[j], b[j + 1]);
                if (hit) {
                    const pa = alongA + hit.t * legA;
                    const pb = alongB + hit.u * legB;
                    if (pa > marginM && pa < lenA - marginM && pb > marginM && pb < lenB - marginM) {
                        return { coordinates: hit.coordinates };
                    }
                }
                alongB += legB;
            }
            alongA += legA;
        }
        return null;
    }

    /* ---------------- positions along a line ---------------- */

    // The point distM metres from the start (or from the end) of a line:
    // { coordinates, segIndex }, or null when the line is shorter.
    function pointAlongLineFromEnd(coords, fromStart, distM) {
        if (!Array.isArray(coords) || coords.length < 2) return null;
        const n = coords.length;
        const pts = fromStart ? coords : [...coords].reverse();
        let remaining = Math.max(0, distM);

        for (let i = 0; i < n - 1; i++) {
            const leg = distanceM(pts[i], pts[i + 1]);
            if (leg > 0 && leg >= remaining) {
                const t = remaining / leg;
                const a = asLonLat(pts[i]);
                const b = asLonLat(pts[i + 1]);
                return {
                    coordinates: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
                    segIndex: fromStart ? i : n - 2 - i
                };
            }
            remaining -= leg;
        }
        return null;
    }

    function lineMidpoint(coords) {
        const p = pointAlongLineFromEnd(coords, true, lineLengthM(coords) / 2);
        return p ? p.coordinates : asLonLat(coords?.[0]);
    }

    // How far along the line (metres from its start) the point lies.
    function alongPositionM(point, coords) {
        let cumulative = 0;
        let best = null;
        for (let i = 0; i < coords.length - 1; i++) {
            const leg = distanceM(coords[i], coords[i + 1]);
            const c = closestPointOnLineSegmentMeters(point, coords[i], coords[i + 1]);
            if (c) {
                const d = Math.sqrt(c.distanceSquaredMeters);
                if (!best || d < best.d) best = { d, along: cumulative + c.t * leg };
            }
            cumulative += leg;
        }
        return best ? best.along : 0;
    }

    /* ---------------- cleaning a line ---------------- */

    // Remove near-duplicate vertices (< 0.2 m) and 180 degree spikes. WME
    // can fail inside addIntersection ("coordinates must contain numbers")
    // when a segment has a zero-length leg.
    function cleanLineCoords(coords) {
        const pts = (coords || []).map(asLonLat).filter(Boolean);
        if (pts.length < 2) return pts;

        const out = [pts[0]];
        for (let i = 1; i < pts.length; i++) {
            const isLast = i === pts.length - 1;
            if (distanceM(out[out.length - 1], pts[i]) < 0.2) {
                if (isLast && out.length > 1) out[out.length - 1] = pts[i];
                continue;
            }
            out.push(pts[i]);
        }

        let changed = true;
        while (changed && out.length > 2) {
            changed = false;
            for (let i = 1; i < out.length - 1; i++) {
                const a = out[i - 1];
                const b = out[i];
                const c = out[i + 1];
                const m = metersPerDegree(b[1]);
                const u = [(a[0] - b[0]) * m.x, (a[1] - b[1]) * m.y];
                const v = [(c[0] - b[0]) * m.x, (c[1] - b[1]) * m.y];
                const lu = Math.hypot(u[0], u[1]);
                const lv = Math.hypot(v[0], v[1]);
                if (!lu || !lv || (u[0] * v[0] + u[1] * v[1]) / (lu * lv) > 0.985) {
                    out.splice(i, 1);
                    changed = true;
                    break;
                }
            }
        }

        return out;
    }

    /* ---------------- cutting a road to a rectangle (the screen) ---------------- */

    // Liang-Barsky: the part of leg a->b that lies inside the bounds,
    // as [t0, t1] along the leg, or null when the leg misses the bounds.
    function clipLeg(a, b, bounds) {
        let t0 = 0;
        let t1 = 1;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const checks = [
            [-dx, a[0] - bounds.west],
            [dx, bounds.east - a[0]],
            [-dy, a[1] - bounds.south],
            [dy, bounds.north - a[1]]
        ];
        for (const [p, q] of checks) {
            if (p === 0) {
                if (q < 0) return null;
                continue;
            }
            const r = q / p;
            if (p < 0) {
                if (r > t1) return null;
                if (r > t0) t0 = r;
            } else {
                if (r < t0) return null;
                if (r < t1) t1 = r;
            }
        }
        return [t0, t1];
    }

    // Splits an OSM way into the pieces that lie inside the bounds. Real
    // OSM nodes keep their ids (junctions with other roads still work);
    // points created on the edge get ids of their own ("clip:...").
    function clipWayToBounds(way, bounds) {
        const pieces = [];
        let current = null;
        let cuts = 0;

        const pointAt = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const cutId = () => `clip:${way.osmId}:${cuts++}`;
        const close = () => {
            if (current && current.coords.length >= 2) pieces.push(current);
            current = null;
        };

        for (let i = 0; i < way.coords.length - 1; i++) {
            const a = way.coords[i];
            const b = way.coords[i + 1];
            const span = clipLeg(a, b, bounds);

            if (!span || span[1] - span[0] <= 1e-9) {
                close();
                continue;
            }

            const [t0, t1] = span;

            if (t0 > 0) {
                close();
                current = { nodeIds: [cutId()], coords: [pointAt(a, b, t0)] };
            } else if (!current) {
                current = { nodeIds: [way.nodeIds[i]], coords: [a] };
            }

            if (t1 < 1) {
                current.nodeIds.push(cutId());
                current.coords.push(pointAt(a, b, t1));
                close();
            } else {
                current.nodeIds.push(way.nodeIds[i + 1]);
                current.coords.push(b);
            }
        }
        close();

        const whole = pieces.length === 1 && cuts === 0 && pieces[0].nodeIds.length === way.nodeIds.length;
        pieces.forEach(piece => { piece.clipped = !whole; });
        return pieces;
    }

    /* ---------------- shape maths: the marked area as a closed ring ----------------
       A ring is a list of [lon, lat] corners, not repeated at the end.
       A box is simply a ring with four corners, so one code path serves
       both.                                                              */

    function pointInRing(lon, lat, ring) {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i][0], yi = ring[i][1];
            const xj = ring[j][0], yj = ring[j][1];
            if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
                inside = !inside;
            }
        }
        return inside;
    }

    // Where leg a->b meets leg c->d, as a share 0..1 along a->b, or null.
    function legCrossShare(a, b, c, d) {
        const rx = b[0] - a[0], ry = b[1] - a[1];
        const sx = d[0] - c[0], sy = d[1] - c[1];
        const den = rx * sy - ry * sx;
        if (Math.abs(den) < 1e-18) return null;
        const qx = c[0] - a[0], qy = c[1] - a[1];
        const t = (qx * sy - qy * sx) / den;
        const u = (qx * ry - qy * rx) / den;
        return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
    }

    // The stretches of leg a->b that lie inside the ring, as [from, to]
    // shares along the leg. Works for shapes with dents as well.
    function legSpansInRing(a, b, ring) {
        const shares = [0, 1];
        for (let i = 0; i < ring.length; i++) {
            const t = legCrossShare(a, b, ring[i], ring[(i + 1) % ring.length]);
            if (t != null && t > 1e-9 && t < 1 - 1e-9) shares.push(t);
        }
        shares.sort((x, y) => x - y);

        const spans = [];
        for (let i = 0; i < shares.length - 1; i++) {
            const from = shares[i];
            const to = shares[i + 1];
            if (to - from <= 1e-9) continue;
            const mid = (from + to) / 2;
            if (!pointInRing(a[0] + (b[0] - a[0]) * mid, a[1] + (b[1] - a[1]) * mid, ring)) continue;

            const last = spans[spans.length - 1];
            if (last && Math.abs(last[1] - from) <= 1e-9) last[1] = to;
            else spans.push([from, to]);
        }
        return spans;
    }

    // Splits an OSM way into the pieces that lie inside the ring. Real OSM
    // nodes keep their ids (junctions with other roads still work); points
    // created on the edge of the shape get ids of their own.
    function clipWayToRing(way, ring) {
        const pieces = [];
        let current = null;
        let cuts = 0;

        const pointAt = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const cutId = () => `clip:${way.osmId}:${cuts++}`;
        const close = () => {
            if (current && current.coords.length >= 2) pieces.push(current);
            current = null;
        };

        for (let i = 0; i < way.coords.length - 1; i++) {
            const a = way.coords[i];
            const b = way.coords[i + 1];
            const spans = legSpansInRing(a, b, ring);

            if (!spans.length) {
                close();
                continue;
            }

            for (const [from, to] of spans) {
                if (from > 1e-9) {
                    close();
                    current = { nodeIds: [cutId()], coords: [pointAt(a, b, from)] };
                } else if (!current) {
                    current = { nodeIds: [way.nodeIds[i]], coords: [a] };
                }

                if (to < 1 - 1e-9) {
                    current.nodeIds.push(cutId());
                    current.coords.push(pointAt(a, b, to));
                    close();
                } else {
                    current.nodeIds.push(way.nodeIds[i + 1]);
                    current.coords.push(b);
                }
            }
        }
        close();

        const whole = pieces.length === 1 && cuts === 0 && pieces[0].nodeIds.length === way.nodeIds.length;
        pieces.forEach(piece => { piece.clipped = !whole; });
        return pieces;
    }

    // True when two sides of the shape cross (a figure-eight). Points are
    // screen positions { x, y }.
    function shapeCrossesItself(points) {
        const n = points.length;
        const side = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

        for (let i = 0; i < n; i++) {
            const a = points[i];
            const b = points[(i + 1) % n];
            for (let j = i + 1; j < n; j++) {
                if ((j + 1) % n === i || (i + 1) % n === j) continue; // neighbours share a corner
                const c = points[j];
                const d = points[(j + 1) % n];
                if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return true;
            }
        }
        return false;
    }

// ████████████████████████  SECTION 3 — OSM  ████████████████████████

    /* ================================================================
       SECTION 3 — OSM: reading roads from OpenStreetMap

       PURPOSE   Fetch every road ("highway" way) in a box from OSM
                 as fast as possible, and turn the answer into plain
                 road objects. Also the readers for OSM tags.
       USES      Section 1 (OSM_MAP_API_*, OVERPASS_*, CUSTOM_OVERPASS_HEDGE_MS,
                 OSM_CACHE_*), Section 2 (helpers, loadSettings/saveSettings),
                 Section 10 (updateStatus, to show which server is asked).
       USED BY   Section 5 (queryOverpassRoads, preferredOverpassServer),
                 Section 6 and 7 (tag readers), Section 10 (custom URL helpers).
       NOTES     * Requests go through GM_xmlhttpRequest because the
                   page itself may not call other sites. Every server
                   host needs a "// @connect" line in the header.
- When a custom NextGIS / Overpass endpoint is configured,
                   it is queried first with a longer hedge window before
                   falling back to public mirrors.
- For small/medium areas (<= OSM_MAP_API_MAX_AREA_DEG2) without
                   a custom endpoint, the official OSM v0.6 /api/0.6/map.json
                   (cgimap) is raced in parallel against hedged Overpass
                   mirrors; whichever responds first wins and aborts the rest.
- A road object: { id, osmId, name, highway, tags,
                   nodeIds: [string], coords: [[lon, lat]], lat, lon }.
- Arabic names are preferred (name:ar) because the
                   script is used for Egypt.

       CHANGES TO THIS SECTION
         3.8.0   created by the restructure.
         3.11.0  raced OSM v0.6 /api/0.6/map.json (cgimap) with hedged
                 Overpass mirrors, filtered non-drivable highway types
                 server-side in Overpass QL, switched to "out geom qt;",
                 and supported node-table resolution in parseOsmRoads().
         3.12.0  added normalizeCustomOverpassUrl() and getCustomOverpassUrl(),
                 and prioritized user's custom NextGIS / Overpass endpoint.
       ================================================================ */

    let preferredOverpassServer = null; // the last server that answered; asked first next time

    // Called once from init(): start with the server that worked last time,
    // ignoring deprecated servers removed in 3.11.0.
    function restorePreferredOverpassServer() {
        const saved = loadSettings().overpass;
        if (OVERPASS_SERVERS.includes(saved)) preferredOverpassServer = saved;
    }

    // Accepts a full NextGIS / custom Overpass URL (e.g.
    // https://overpass.nextgis.com/KEY/api/interpreter or .../KEY/) or a bare
    // NextGIS API key, and returns a normalized https/http interpreter URL,
    // '' when empty, or null when invalid.
    function normalizeCustomOverpassUrl(raw) {
        const text = String(raw ?? '').trim();
        if (!text) return '';

        if (!text.includes('://')) {
            if (/\s|\//.test(text)) return null;
            return `https://overpass.nextgis.com/${encodeURIComponent(text)}/api/interpreter`;
        }

        let parsed = null;
        try {
            parsed = new URL(text);
        } catch (error) {
            return null;
        }
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;

        if (parsed.hostname === 'overpass.nextgis.com') {
            const parts = parsed.pathname.split('/').filter(Boolean);
            if (!parts.length) return null;
            if (parts.length === 1) {
                return `https://overpass.nextgis.com/${parts[0]}/api/interpreter`;
            }
        }

        return parsed.toString();
    }

    function getCustomOverpassUrl() {
        return normalizeCustomOverpassUrl(loadSettings().customOverpass) || '';
    }

    // Fast path for zoom-16+ editing areas: OSM's C++ cgimap daemon returns
    // full node+way JSON in ~150-400 ms with zero Overpass query-planner lag.
    function queryOsmMapApi(bounds, signal) {
        const areaDeg2 = (Number(bounds.north) - Number(bounds.south)) * (Number(bounds.east) - Number(bounds.west));
        if (!(areaDeg2 > 0 && areaDeg2 <= OSM_MAP_API_MAX_AREA_DEG2)) {
            return Promise.reject(new Error('Area exceeds fast OSM v0.6 map.json threshold.'));
        }

        const bbox = `${bounds.west.toFixed(6)},${bounds.south.toFixed(6)},${bounds.east.toFixed(6)},${bounds.north.toFixed(6)}`;
        const url = `${OSM_MAP_API_URL}?bbox=${bbox}`;

        return new Promise((resolve, reject) => {
            if (signal?.aborted) {
                reject(new Error('Aborted'));
                return;
            }

            const request = GM_xmlhttpRequest({
                method: 'GET',
                url,
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': `WME-Map-Build/${SCRIPT_VERSION} (OpenStreetMap editor helper)`
                },
                timeout: OSM_MAP_API_TIMEOUT_MS,
                anonymous: true,
                onload(response) {
                    if (signal?.aborted) return;
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error(`OSM v0.6 HTTP ${response.status}`));
                        return;
                    }
                    let json = null;
                    try {
                        json = JSON.parse(response.responseText);
                    } catch (error) {
                        reject(new Error('Invalid JSON from OSM v0.6 API.'));
                        return;
                    }
                    if (!Array.isArray(json?.elements)) {
                        reject(new Error('OSM v0.6 API returned no elements.'));
                        return;
                    }
                    resolve({ data: json, server: OSM_MAP_API_URL });
                },
                onerror() {
                    if (!signal?.aborted) reject(new Error('Network error contacting OSM v0.6 API.'));
                },
                ontimeout() {
                    if (!signal?.aborted) reject(new Error('OSM v0.6 API timed out.'));
                }
            });

            if (signal?.onAbort) {
                signal.onAbort.push(() => safeCall(() => request.abort(), null));
            }
        });
    }

    // Sends the Overpass query and resolves with { data, server }.
    // Does not wait for one server to time out before trying the next:
    // ask the first server (custom NextGIS endpoint if set); if it has not
    // answered after the hedge delay, ask the next one as well (at most
    // OVERPASS_MAX_PARALLEL at once). The first good answer wins, the other
    // requests are cancelled, and the winner goes first next time.
    function queryOverpassWithFallback(query, label, timeoutMs, signal) {
        const customUrl = getCustomOverpassUrl();
        const preferred = OVERPASS_SERVERS.includes(preferredOverpassServer) ? preferredOverpassServer : null;
        const servers = [...new Set([customUrl, preferred, ...OVERPASS_SERVERS].filter(Boolean))];

        return new Promise((resolve, reject) => {
            if (signal?.aborted) {
                reject(new Error('Aborted'));
                return;
            }

            const live = new Map(); // server -> running request
            let next = 0;
            let settled = false;
            let lastError = null;
            let timer = null;

            const abortAll = keepServer => {
                clearTimeout(timer);
                for (const [other, request] of live) {
                    if (other !== keepServer) safeCall(() => request.abort(), null);
                }
                live.clear();
            };

            if (signal?.onAbort) {
                signal.onAbort.push(() => {
                    if (settled) return;
                    settled = true;
                    abortAll(null);
                });
            }

            const showStatus = () => {
                if (settled || signal?.aborted) return;
                const hosts = [...live.keys()].map(hostOf);
                if (signal?.extraHost) hosts.unshift(signal.extraHost);
                updateStatus(
                    `${escapeHtml(label)}<small>${escapeHtml([...new Set(hosts)].join(', '))}</small>`
                );
            };

            const finish = (server, data) => {
                if (settled || signal?.aborted) return;
                settled = true;
                abortAll(server);
                preferredOverpassServer = server;
                if (OVERPASS_SERVERS.includes(server)) {
                    saveSettings({ overpass: server });
                }
                resolve({ data, server });
            };

            const fail = (server, error) => {
                if (settled || signal?.aborted) return;
                live.delete(server);
                lastError = error;
                log(`${label} failed:`, hostOf(server), error);

                if (next < servers.length) {
                    launch();
                } else if (!live.size) {
                    settled = true;
                    clearTimeout(timer);
                    reject(new Error(
                        `${label} failed on all Overpass servers. ` + (lastError?.message || 'No Overpass response.')
                    ));
                } else {
                    showStatus();
                }
            };

            const launch = () => {
                if (settled || signal?.aborted || next >= servers.length) return;
                const server = servers[next++];

                const request = GM_xmlhttpRequest({
                    method: 'POST',
                    url: server,
                    data: 'data=' + encodeURIComponent(query),
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                        'Accept': 'application/json,text/plain,*/*',
                        'User-Agent': `WME-Map-Build/${SCRIPT_VERSION} (OpenStreetMap/Overpass client)`,
                        'Referer': 'https://www.waze.com/editor/'
                    },
                    timeout: timeoutMs,
                    anonymous: true,
                    onload(response) {
                        if (response.status < 200 || response.status >= 300) {
                            fail(server, new Error(`Overpass HTTP ${response.status}`));
                            return;
                        }
                        let json = null;
                        try {
                            json = JSON.parse(response.responseText);
                        } catch (error) {
                            fail(server, new Error('Invalid JSON returned by Overpass.'));
                            return;
                        }
                        if (!Array.isArray(json?.elements)) {
                            fail(server, new Error('Overpass answered without any data.'));
                            return;
                        }
                        // a server that ran out of time or memory answers 200 with a remark
                        if (/error|timed out|out of memory/i.test(String(json.remark || ''))) {
                            fail(server, new Error(`Overpass: ${json.remark}`));
                            return;
                        }
                        finish(server, json);
                    },
                    onerror() {
                        fail(server, new Error('Network error while contacting Overpass.'));
                    },
                    ontimeout() {
                        fail(server, new Error('Overpass request timed out.'));
                    }
                });

                live.set(server, request);
                showStatus();

                const hedgeMs = server === customUrl ? CUSTOM_OVERPASS_HEDGE_MS : OVERPASS_HEDGE_MS;
                clearTimeout(timer);
                timer = setTimeout(() => {
                    if (!settled && !signal?.aborted && live.size < OVERPASS_MAX_PARALLEL) launch();
                }, hedgeMs);
            };

            launch();
        });
    }

    // 3.11.0: Filter out pedestrian/non-drivable highway classes directly in
    // Overpass QL (matching NOT_DRAWN_ROAD_TYPES) and sort with "qt" (quadtile
    // index order) to cut server CPU time and response payload size.
    function buildOverpassRoadQuery(bounds) {
        return `[out:json][timeout:${OVERPASS_BUILD_TIMEOUT_SECONDS}][maxsize:33554432];
way["highway"]["highway"!~"^(footway|path|steps|pedestrian|cycleway|bridleway|corridor|proposed|construction)$"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
out geom qt;`;
    }

    function splitBoundsIntoTiles(bounds) {
        const midLat = (Number(bounds.south) + Number(bounds.north)) / 2;
        const midLon = (Number(bounds.west) + Number(bounds.east)) / 2;
        return [
            { south: bounds.south, west: bounds.west, north: midLat, east: midLon },
            { south: bounds.south, west: midLon, north: midLat, east: bounds.east },
            { south: midLat, west: bounds.west, north: bounds.north, east: midLon },
            { south: midLat, west: midLon, north: bounds.north, east: bounds.east }
        ];
    }

    async function queryOverpassRoads(bounds) {
        const fresh = forceFreshOsm;
        forceFreshOsm = false;
        osmCacheAgeMin = null;

        if (!fresh) {
            try {
                const cached = JSON.parse(sessionStorage.getItem(OSM_CACHE_KEY) || 'null');
                const b = cached?.bounds;
                const age = Date.now() - Number(cached?.at);
                if (b && Array.isArray(cached.roads) && age >= 0 && age < OSM_CACHE_MAX_AGE_MS &&
                    b.south <= bounds.south && b.north >= bounds.north &&
                    b.west <= bounds.west && b.east >= bounds.east) {
                    osmCacheAgeMin = Math.round(age / 60000);
                    log(`OSM roads taken from the cache: ${cached.roads.length} ways, ${osmCacheAgeMin} min old`);
                    return cached.roads;
                }
            } catch (error) {
                log('OSM cache could not be read:', error);
            }
        }

        const padded = {
            south: bounds.south - OSM_CACHE_PAD_DEG,
            north: bounds.north + OSM_CACHE_PAD_DEG,
            west: bounds.west - OSM_CACHE_PAD_DEG,
            east: bounds.east + OSM_CACHE_PAD_DEG
        };
        const roads = await queryOverpassRoadsFresh(padded);
        try {
            sessionStorage.setItem(OSM_CACHE_KEY, JSON.stringify({ at: Date.now(), bounds: padded, roads }));
        } catch (error) {
            log('OSM cache could not be stored:', error); // storage full: the scan still works
        }
        return roads;
    }

    // Race the official OSM v0.6 map.json API (when no custom Overpass server
    // is configured and area fits) against the hedged Overpass servers.
    // Whichever answers first wins and aborts the slower requests; if the
    // full-box query fails, fall back to 4 tiles.
    async function queryOverpassRoadsFresh(bounds) {
        const customUrl = getCustomOverpassUrl();
        const areaDeg2 = (Number(bounds.north) - Number(bounds.south)) * (Number(bounds.east) - Number(bounds.west));
        const useFastMapApi = !customUrl && areaDeg2 > 0 && areaDeg2 <= OSM_MAP_API_MAX_AREA_DEG2;
        const signal = {
            aborted: false,
            onAbort: [],
            extraHost: useFastMapApi ? hostOf(OSM_MAP_API_URL) : null
        };
        const abortRest = () => {
            if (signal.aborted) return;
            signal.aborted = true;
            for (const fn of signal.onAbort) safeCall(fn, null);
            signal.onAbort = [];
        };

        try {
            const racers = [
                queryOverpassWithFallback(
                    buildOverpassRoadQuery(bounds),
                    'Reading OpenStreetMap roads...',
                    OVERPASS_BUILD_CLIENT_TIMEOUT_MS,
                    signal
                )
            ];

            if (useFastMapApi) {
                racers.push(queryOsmMapApi(bounds, signal));
            }

            const result = await Promise.any(racers);
            abortRest();
            preferredOverpassServer = result.server;
            return parseOsmRoads(result.data);
        } catch (aggError) {
            abortRest();
            const fullAreaError = Array.isArray(aggError?.errors)
                ? aggError.errors[aggError.errors.length - 1]
                : aggError;
            // Area too large or all servers failed: retry as four smaller tiles.
            log('Full-area OSM road query failed; switching to 4 tiles:', fullAreaError);

            const tiles = splitBoundsIntoTiles(bounds);
            const roadMap = new Map();
            let tileFailures = 0;
            let lastTileError = fullAreaError;

            for (let index = 0; index < tiles.length; index++) {
                try {
                    const result = await queryOverpassWithFallback(
                        buildOverpassRoadQuery(tiles[index]),
                        `Reading OpenStreetMap roads (tile ${index + 1}/4)...`,
                        OVERPASS_TILE_FALLBACK_TIMEOUT_MS
                    );
                    for (const road of parseOsmRoads(result.data)) {
                        const key = String(road.osmId);
                        if (!roadMap.has(key)) roadMap.set(key, road);
                    }
                } catch (tileError) {
                    tileFailures++;
                    lastTileError = tileError;
                    log(`OSM road tile ${index + 1}/4 failed:`, tileError);
                }
            }

            if (roadMap.size > 0 && tileFailures < tiles.length) {
                return Array.from(roadMap.values());
            }

            throw new Error(
                'Unable to load OSM roads. Full-area query failed and the 4-tile fallback also failed. ' +
                (lastTileError?.message || '')
            );
        }
    }

    // Overpass JSON ("out geom") OR OSM v0.6 map.json (separate node + way
    // elements) -> road objects (see NOTES in the section header).
    function parseOsmRoads(data) {
        const elements = Array.isArray(data?.elements) ? data.elements : [];
        const roads = [];

        // OSM v0.6 /api/0.6/map.json returns nodes separately from ways.
        const nodeCoords = new Map();
        for (const element of elements) {
            if (element?.type !== 'node' || element.id == null) continue;
            const lon = Number(element.lon);
            const lat = Number(element.lat);
            if (Number.isFinite(lon) && Number.isFinite(lat)) {
                nodeCoords.set(String(element.id), [lon, lat]);
            }
        }

        for (const element of elements) {
            const tags = element?.tags || {};
            if (element?.type !== 'way' || !tags.highway) continue;
            const hw = String(tags.highway).trim().toLowerCase();
            if (hw === 'proposed' || hw === 'construction') continue;
            // 3.8.5: pedestrian paths are left out (see NOT_DRAWN_ROAD_TYPES, Section 1)
            if (NOT_DRAWN_ROAD_TYPES.has(inferWmeRoadType(tags.highway, tags))) continue;
            if (!Array.isArray(element.nodes) || element.nodes.length < 2) continue;

            const nodeIds = element.nodes.map(String);
            let coords = null;

            if (Array.isArray(element.geometry) && element.geometry.length === nodeIds.length) {
                coords = element.geometry.map(point => [Number(point?.lon), Number(point?.lat)]);
            } else if (nodeCoords.size > 0) {
                coords = nodeIds.map(nid => nodeCoords.get(nid) || null);
            }

            if (!coords || coords.length < 2) continue;
            if (!coords.every(c => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))) continue;

            roads.push({
                id: `osm-way-${element.id}`,
                osmId: element.id,
                name: getOsmStreetName(tags),
                streetName: getOsmStreetName(tags),
                cityName: getOsmCityName(tags),
                countryName: getOsmCountryName(tags),
                stateName: getOsmStateName(tags),
                highway: tags.highway || '',
                ref: tags.ref || '',
                lat: null, // set by placeRoadsInArea: centre of the part inside the area
                lon: null,
                nodeIds,
                coords,
                tags
            });
        }

        return roads;
    }

    /* ---------------- reading OSM tags ---------------- */

    function firstNonEmpty(candidates) {
        for (const value of candidates) {
            const text = String(value ?? '').trim();
            if (text) return text;
        }
        return '';
    }

    // Arabic name first, then the default name, English, then the road number.
    function getOsmStreetName(tags) {
        const s = tags || {};
        return firstNonEmpty([s['name:ar'], s.name, s['name:en'], s.ref]);
    }

    function getOsmCityName(tags) {
        const s = tags || {};
        return firstNonEmpty([
            s['addr:city:ar'], s['addr:town:ar'], s['addr:municipality:ar'],
            s['addr:city'], s['addr:town'], s['addr:municipality'],
            s['is_in:city:ar'], s['is_in:town:ar'], s['is_in:city'], s['is_in:town'],
            s.city, s.town, s.municipality
        ]);
    }

    function getOsmCountryName(tags) {
        const s = tags || {};
        return firstNonEmpty([s['addr:country'], s['is_in:country'], s.country]);
    }

    function getOsmStateName(tags) {
        const s = tags || {};
        return firstNonEmpty([s['addr:state'], s['is_in:state'], s.state]);
    }
// ████████████████████████  SECTION 4 — WME  ████████████████████████

    /* ================================================================
       SECTION 4 — WME: talking to the editor

       PURPOSE   Everything that reads from the WME SDK, plus the
                 bookkeeping of what this script drew.
                   - starting the SDK
                   - the map view (screen rectangle, pixel <-> lon/lat,
                     visible extent)
                   - reading segments and nodes
                   - "created" bookkeeping: which segment ids belong to
                     which drawn road
                   - two small edits that must keep the bookkeeping
                     right: cleaning and splitting a new segment
       USES      Section 1 (sdk, createdWmeSegments, comparisonData,
                 ui, selectedBounds), Section 2 (geometry).
       USED BY   Sections 5 to 10.
       NOTES     * All SDK reads are wrapped so that a missing method or
                   an object outside the loaded map gives null / [] and
                   not an exception.
                 * WME gives a segment new ids whenever it is split. The
                   only reliable way to know what a road is made of now
                   is the owner's segmentIds list, so every split goes
                   through replaceCreatedSegmentId().
                 * New (unsaved) objects have negative ids; saved ones
                   have positive ids.

       CHANGES TO THIS SECTION
         3.8.0  created by the restructure (code unchanged).
       ================================================================ */

    /* ---------------- starting the SDK ---------------- */

    async function initSDK() {
        const w = unsafeWindow;
        for (let i = 0; i < 120 && !w.SDK_INITIALIZED; i++) await sleep(500);
        if (!w.SDK_INITIALIZED) throw new Error('WME SDK is not available on this page.');

        await w.SDK_INITIALIZED;
        if (typeof w.getWmeSdk !== 'function') throw new Error('getWmeSdk() was not found.');

        sdk = w.getWmeSdk({ scriptId: SCRIPT_ID, scriptName: SCRIPT_NAME });
        log('WME SDK:', sdk.getSDKVersion());
        return sdk;
    }

    /* ---------------- the map view ---------------- */

    function mapViewportElement() {
        try {
            return typeof sdk?.Map?.getMapViewportElement === 'function'
                ? sdk.Map.getMapViewportElement()
                : null;
        } catch (error) {
            return null;
        }
    }

    // Screen rectangle of the visible map. Only used to place the selection
    // overlay and to clip the area outline; NOT for coordinate conversion.
    function mapRect() {
        const element = mapViewportElement();
        if (element) {
            const r = element.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
                return { left: r.left, top: r.top, width: r.width, height: r.height };
            }
        }
        return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    }

    // SDK pixels are window coordinates: the same numbers as
    // event.clientX / event.clientY. Do not subtract the map position
    // (decision D16).
    function clientToLonLat(clientX, clientY) {
        if (!sdk) return null;
        try {
            const result = sdk.Map.getLonLatFromPixel({ x: clientX, y: clientY });
            if (!result) return null;
            const lat = Number(result.lat);
            const lon = Number(result.lon ?? result.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
            return { lat, lon };
        } catch (error) {
            log('clientToLonLat error:', error);
            return null;
        }
    }

    // Visible map as { west, south, east, north }, or null when the SDK
    // gives nothing that looks like lon/lat.
    function mapExtent() {
        const raw = safeCall(() => sdk.Map.getMapExtent(), null);
        if (!Array.isArray(raw) || raw.length < 4) return null;
        const [west, south, east, north] = raw.map(Number);
        if (![west, south, east, north].every(Number.isFinite)) return null;
        if (Math.abs(west) > 180 || Math.abs(east) > 180 || Math.abs(south) > 90 || Math.abs(north) > 90) return null;
        if (west >= east || south >= north) return null;
        return { west, south, east, north };
    }

    function extentContains(extent, b) {
        const pad = 0.00002;
        return extent.west <= b.west + pad &&
            extent.east >= b.east - pad &&
            extent.south <= b.south + pad &&
            extent.north >= b.north - pad;
    }

    // False only when we are sure part of the marked area is off screen.
    // (ui.extentCheck is false when the SDK extent proved unreliable; the
    // check is then skipped rather than blocking the editor for nothing.)
    function areaIsOnScreen() {
        if (!ui.extentCheck || !selectedBounds) return true;
        const extent = mapExtent();
        return !extent || extentContains(extent, selectedBounds);
    }

    /* ---------------- reading segments and nodes ---------------- */

    function wmeSegments() {
        // 3.8.6: every geometry this script writes goes through here, and
        // both ends are put EXACTLY on the segment's end nodes first.
        //
        // Why: the SDK hands out segment coordinates rounded to 6 decimals
        // (about 0.1 m), while nodes keep their full position. Writing a
        // shape that was read from the SDK back with updateSegment()
        // therefore moved the two ends up to 7 cm off their nodes, and the
        // server refused the whole save with
        //   [705] segment ... is connected to node ..., but has a
        //         different coordinate at edge
        // The clean-up of 3.8.2 / 3.8.4 did that to about 55 segments per
        // run. An end is only snapped when it is within 0.5 m of its node,
        // so a caller that really moves an end is not undone.
        const real = sdk?.DataModel?.Segments || null;
        if (!real) return null;
        if (wmeSegments.cache?.real === real) return wmeSegments.cache.proxy;

        const onNodes = (segmentId, geometry) => {
            const coords = Array.isArray(geometry?.coordinates) ? geometry.coordinates.map(asLonLat) : [];
            const seg = safeCall(() => real.getById({ segmentId: Number(segmentId) }), null);
            if (!seg || coords.length < 2 || coords.some(p => !p)) return geometry;
            const from = asLonLat(getNodeById(segmentEndNodeId(seg, true))?.geometry?.coordinates);
            const to = asLonLat(getNodeById(segmentEndNodeId(seg, false))?.geometry?.coordinates);
            if (from && distanceM(from, coords[0]) < 0.5) coords[0] = from;
            if (to && distanceM(to, coords[coords.length - 1]) < 0.5) coords[coords.length - 1] = to;
            return { type: 'LineString', coordinates: coords };
        };

        // A stand-in for the SDK's Segments object: updateSegment() is
        // replaced, everything else is passed straight through.
        const proxy = new Proxy({}, {
            get(unused, prop) {
                if (prop === 'updateSegment') {
                    return args => real.updateSegment(
                        args?.geometry ? { ...args, geometry: onNodes(args.segmentId, args.geometry) } : args
                    );
                }
                const value = real[prop];
                return typeof value === 'function' ? value.bind(real) : value;
            }
        });
        wmeSegments.cache = { real, proxy };
        return proxy;
    }

    // The segment as WME has it right now, or null when it is gone.
    function liveSegment(id) {
        const n = Number(id);
        if (id == null || !Number.isFinite(n)) return null;
        try {
            return wmeSegments()?.getById({ segmentId: n }) || null;
        } catch (error) {
            return null;
        }
    }

    function allSegments() {
        try {
            // 3.10.1: a SAVED segment that was split (or deleted) in this
            // session is still handed out by the SDK until the next save,
            // with its shape but with both node ids empty. Nothing else
            // tells it apart from a live road. The first run that joined
            // new roads to existing ones took these leftovers for real
            // roads: four road ends were refused with "one of its ends is
            // outside the loaded map", and the audit reported
            // "segment ...: from node id is null". They are dropped here,
            // so every reader of the segment list sees live roads only.
            // (An unsaved segment without nodes is NOT dropped: that would
            // be a real fault and the audit must still see it.)
            return (wmeSegments()?.getAll?.() || []).filter(s =>
                !(Number(s?.id) > 0 && s.fromNodeId == null && s.toNodeId == null)
            );
        } catch (error) {
            return [];
        }
    }

    // Current coordinates of a segment as clean [lon, lat] pairs.
    function segmentCoords(segmentId) {
        return (liveSegment(segmentId)?.geometry?.coordinates || []).map(asLonLat).filter(Boolean);
    }

    function getNodeById(nodeId) {
        const nodes = sdk?.DataModel?.Nodes;
        if (!nodes?.getById || nodeId == null || !Number.isFinite(Number(nodeId))) return null;
        try {
            return nodes.getById({ nodeId: Number(nodeId) });
        } catch (error) {
            return null;
        }
    }

    function getNodeConnectedSegmentIds(nodeId) {
        const node = getNodeById(nodeId);
        if (!node) return [];
        return Array.isArray(node.connectedSegmentIds)
            ? node.connectedSegmentIds.map(Number).filter(Number.isFinite)
            : [];
    }

    function segmentEndNodeId(segment, atStart) {
        const value = atStart ? segment?.fromNodeId : segment?.toNodeId;
        return value == null || !Number.isFinite(Number(value)) ? null : Number(value);
    }

    // False when an end node is outside the loaded area. Editing such a
    // segment fails with "node null does not exist".
    function segmentNodesLoaded(segment) {
        const from = segmentEndNodeId(segment, true);
        const to = segmentEndNodeId(segment, false);
        return from != null && to != null && !!getNodeById(from) && !!getNodeById(to);
    }

    function segmentElevation(segment) {
        const value = Number(segment?.elevationLevel ?? segment?.level ?? 0);
        return Number.isFinite(value) ? value : 0;
    }

    /* ---------------- bookkeeping: what this script drew ---------------- */

    // WME replaced segment oldId by newIds (a split): update the owner.
    function replaceCreatedSegmentId(owner, oldId, newIds) {
        if (!owner) return;
        const current = Array.isArray(owner.segmentIds)
            ? owner.segmentIds.map(Number).filter(Number.isFinite)
            : [];
        const replacement = (newIds || []).map(Number).filter(Number.isFinite);
        owner.segmentIds = [...new Set(current.flatMap(id => id === Number(oldId) ? replacement : [id]))];
        owner.segmentId = owner.segmentIds[0] || null;
    }

    function removeCreatedSegmentId(owner, segmentId) {
        if (!owner) return;
        owner.segmentIds = (owner.segmentIds || [])
            .map(Number)
            .filter(id => Number.isFinite(id) && id !== Number(segmentId));
        owner.segmentId = owner.segmentIds[0] || null;
    }

    function getCreatedEntries() {
        return Array.from(createdWmeSegments.entries())
            .map(([key, value]) => ({ key, value }))
            .filter(entry => Array.isArray(entry.value?.segmentIds) && entry.value.segmentIds.length);
    }

    // Ids of every segment this script drew. "Is this one of ours?" is
    // asked before anything is changed, so existing roads stay untouched.
    function getCreatedSegmentIdSet() {
        const result = new Set();
        for (const value of createdWmeSegments.values()) {
            for (const id of value?.segmentIds || []) {
                const n = Number(id);
                if (Number.isFinite(n)) result.add(n);
            }
        }
        return result;
    }

    function findCreatedOwner(segmentId) {
        const id = Number(segmentId);
        for (const [key, value] of createdWmeSegments.entries()) {
            if ((value?.segmentIds || []).map(Number).includes(id)) return { key, value };
        }
        return null;
    }

    // Forget ids of segments that are gone (undone or deleted by hand).
    function pruneCreatedSegmentIds() {
        for (const value of createdWmeSegments.values()) {
            value.segmentIds = [...new Set(
                (value.segmentIds || []).map(Number).filter(id => Number.isFinite(id) && liveSegment(id))
            )];
            value.segmentId = value.segmentIds[0] || null;
        }
    }

    function getOsmTagsForCreatedKey(key) {
        const osmId = String(key).split('~')[0];
        const items = comparisonData?.roads?.missing || [];
        const item = items.find(x => String(x?.osm?.osmId) === osmId);
        return item?.osm?.tags || {};
    }

    // Bridge, tunnel or another level: never make a junction in the
    // middle of such a segment.
    function isGradeSeparated(segment) {
        if (segmentElevation(segment) !== 0) return true;
        const owner = findCreatedOwner(segment?.id);
        if (!owner) return false;
        const tags = getOsmTagsForCreatedKey(owner.key);
        const truthy = value => {
            const s = String(value || '').trim().toLowerCase();
            return !!s && s !== 'no' && s !== '0' && s !== 'false';
        };
        if (truthy(tags.bridge) || truthy(tags.tunnel)) return true;
        const layer = Number(tags.layer);
        return Number.isFinite(layer) && layer !== 0;
    }

    /* ---------------- two edits that keep the bookkeeping right ---------------- */

    // Applies cleanLineCoords() to a NEW segment. Never an existing road.
    function sanitizeSegmentGeometry(segmentId) {
        const id = Number(segmentId);
        if (!getCreatedSegmentIdSet().has(id)) return false; // never touch existing roads
        const c = liveSegment(id)?.geometry?.coordinates;
        if (!c || c.length < 3) return false;

        const cleaned = cleanLineCoords(c);
        if (cleaned.length < 2 || cleaned.length === c.length) return false;

        try {
            wmeSegments().updateSegment({
                segmentId: id,
                geometry: { type: 'LineString', coordinates: cleaned }
            });
            log('Cleaned segment geometry:', id, `${c.length} -> ${cleaned.length} points`);
            return true;
        } catch (error) {
            log('Segment geometry clean failed:', id, error);
            return false;
        }
    }

    // Splits a segment drawn by this script and keeps the bookkeeping right.
    // Returns the ids that replaced it, or null when WME refused the split.
    // The new ids are found by comparing the segment list before and after,
    // so this does not depend on what splitSegment() returns.
    function splitCreatedSegment(segmentId, point) {
        const segments = wmeSegments();
        const id = Number(segmentId);
        if (typeof segments?.splitSegment !== 'function' || !liveSegment(id)) return null;

        const owner = findCreatedOwner(id);
        const before = new Set(allSegments().map(s => Number(s?.id)));

        try {
            segments.splitSegment({ segmentId: id, splitPoint: { type: 'Point', coordinates: point } });
        } catch (error) {
            log('splitSegment refused:', id, error);
            return null;
        }

        const fresh = allSegments()
            .map(s => Number(s?.id))
            .filter(n => Number.isFinite(n) && !before.has(n));
        const pieces = liveSegment(id) ? [id, ...fresh] : fresh;
        if (pieces.length < 2) return null;

        if (owner) replaceCreatedSegmentId(owner.value, id, pieces);
        return pieces;
    }

// ████████████████████████  SECTION 5 — SCAN  ████████████████████████

    /* ================================================================
       SECTION 5 — SCAN: which OSM roads are missing from WME

       PURPOSE   Compare the OSM roads of the marked area with the WME
                 roads, and keep the list of missing ones.
       USES      Sections 1 to 4, Section 10 (updateStatus, render).
       USED BY   Section 8 (the same rules are applied again just
                 before drawing), Section 9 (starts a scan when the
                 area is marked), Section 10 (shows the counts).
       THE RULES, IN ORDER (decision D12)
         1. The road must belong to the area: all of it inside, or at
            least CLIP_MIN_PIECE_M of it inside (measureRoadInArea).
            Otherwise it is counted as "outside or only touching".
         2. Closed OSM ways (roundabouts, rings) are set aside for the
            WME roundabout tool.
         3. "Already in WME" test A (compareRoads): a WME road has a
            shape point within 40 m of the centre of the inside part.
         4. "Already in WME" test B (insideCoverage): at least half of
            the inside part runs along existing WME roads, within 6 m
            and about 30 degrees (wayCoverageByExisting).
         5. Whatever is left is missing.
       RESULT    comparisonData = {
                   roads: { missing: [{ osm, nearestWME, distance }],
                            matched: [{ osm, wme, distance, sameName }] },
                   touching, loops }
       NOTES     * Test A is rough on purpose (fast, and good enough for
                   most roads); test B is the precise one and catches
                   what A misses. A long road whose centre is far from
                   any WME shape point passes A and is caught by B.
                 * The coverage index is rebuilt at most every 5 s
                   (existingLegIndexCache). Scan and build set it to
                   null first so that they see the roads as they are now.

       CHANGES TO THIS SECTION
         3.8.0  created by the restructure (code unchanged).
       ================================================================ */

    /* ---------------- which part of a road counts ---------------- */

    // What part of a road lies inside the marked area.
    function measureRoadInArea(road, ring) {
        const pieces = clipWayToRing(
            { osmId: String(road.osmId), nodeIds: road.nodeIds, coords: road.coords },
            ring
        );
        const fullLength = lineLengthM(road.coords);
        const insideLength = pieces.reduce((sum, piece) => sum + lineLengthM(piece.coords), 0);
        const entire = pieces.length === 1 && !pieces[0].clipped;
        return {
            pieces,
            fullLength,
            insideLength,
            entire,
            belongs: pieces.length > 0 && (entire || insideLength >= CLIP_MIN_PIECE_M)
        };
    }

    function roadRunsOffScreen(road, extent) {
        return !!extent && !road.coords.every(c => pointInside(c[1], c[0], extent));
    }

    /* ---------------- "runs along an existing WME road" ----------------
       How much of an OSM way is already covered by WME segments running
       in the same direction (within 6 m / 30 degrees). Used to avoid
       drawing roads on top of roads that already exist, including roads
       drawn by an earlier, unsaved run.                                  */

    let existingLegIndexCache = null; // { at, index }: every leg of every WME segment, by grid cell

    function getExistingLegIndex() {
        const now = Date.now();
        if (existingLegIndexCache && now - existingLegIndexCache.at < 5000) {
            return existingLegIndexCache.index;
        }

        const index = new Map();
        for (const seg of allSegments()) {
            const c = seg?.geometry?.coordinates;
            if (!Array.isArray(c)) continue;
            for (let i = 0; i < c.length - 1; i++) {
                const a = asLonLat(c[i]);
                const b = asLonLat(c[i + 1]);
                if (!a || !b) continue;
                const minX = Math.floor(Math.min(a[0], b[0]) / COVERAGE_CELL_DEG);
                const maxX = Math.floor(Math.max(a[0], b[0]) / COVERAGE_CELL_DEG);
                const minY = Math.floor(Math.min(a[1], b[1]) / COVERAGE_CELL_DEG);
                const maxY = Math.floor(Math.max(a[1], b[1]) / COVERAGE_CELL_DEG);
                if ((maxX - minX + 1) * (maxY - minY + 1) > 400) continue;
                for (let x = minX; x <= maxX; x++) {
                    for (let y = minY; y <= maxY; y++) {
                        const key = `${x}:${y}`;
                        if (!index.has(key)) index.set(key, []);
                        index.get(key).push({ a, b });
                    }
                }
            }
        }

        existingLegIndexCache = { at: now, index };
        return index;
    }

    // Share (0..1) of the way that runs along existing WME segments.
    // Samples the way every 3 to 10 m; a sample is covered when a WME leg
    // passes within 6 m (36 = 6 squared) at an angle under about 30
    // degrees (0.87 = cos 30).
    function wayCoverageByExisting(way) {
        const coords = way?.coords || [];
        const total = lineLengthM(coords);
        if (total <= 0) return 0;

        const index = getExistingLegIndex();
        const step = Math.max(3, Math.min(10, total / 20));
        let samples = 0;
        let covered = 0;

        for (let d = step / 2; d < total; d += step) {
            const pt = pointAlongLineFromEnd(coords, true, d)?.coordinates;
            const ahead = pointAlongLineFromEnd(coords, true, Math.min(total, d + 1))?.coordinates;
            if (!pt || !ahead) continue;

            const m = metersPerDegree(pt[1]);
            const wv = [(ahead[0] - pt[0]) * m.x, (ahead[1] - pt[1]) * m.y];
            const wl = Math.hypot(wv[0], wv[1]);
            samples++;

            const cx = Math.floor(pt[0] / COVERAGE_CELL_DEG);
            const cy = Math.floor(pt[1] / COVERAGE_CELL_DEG);
            let hit = false;

            for (let dx = -1; dx <= 1 && !hit; dx++) {
                for (let dy = -1; dy <= 1 && !hit; dy++) {
                    for (const leg of index.get(`${cx + dx}:${cy + dy}`) || []) {
                        const cp = closestPointOnLineSegmentMeters(pt, leg.a, leg.b);
                        if (!cp || cp.distanceSquaredMeters > 36) continue;
                        const lv = [(leg.b[0] - leg.a[0]) * m.x, (leg.b[1] - leg.a[1]) * m.y];
                        const ll = Math.hypot(lv[0], lv[1]);
                        if (!wl || !ll || Math.abs((wv[0] * lv[0] + wv[1] * lv[1]) / (wl * ll)) > 0.87) {
                            hit = true;
                            break;
                        }
                    }
                }
            }

            if (hit) covered++;
        }

        return samples ? covered / samples : 0;
    }

    // Share of the inside part that WME already has (0..1).
    function insideCoverage(pieces) {
        let covered = 0;
        let total = 0;
        for (const piece of pieces) {
            const length = lineLengthM(piece.coords);
            covered += wayCoverageByExisting(piece) * length;
            total += length;
        }
        return total > 0 ? covered / total : 0;
    }

    /* ---------------- reading the WME roads of the area ---------------- */

    function geometryInside(geometry, bounds) {
        if (!geometry || geometry.type !== 'LineString') return false;
        const coords = geometry.coordinates || [];
        return coords.some(point => {
            if (!Array.isArray(point) || point.length < 2) return false;
            return pointInside(Number(point[1]), Number(point[0]), bounds);
        });
    }

    // Every WME segment with at least one shape point inside the box.
    function extractWmeRoads(bounds) {
        if (!sdk) throw new Error('WME SDK is not initialized.');

        const segments = sdk.DataModel.Segments.getAll();
        const streets = sdk.DataModel.Streets.getAll();

        const streetMap = new Map();
        for (const street of streets) {
            if (street && street.id != null) {
                streetMap.set(Number(street.id), street.name || '');
            }
        }

        const roads = [];
        for (const segment of segments) {
            if (!segment) continue;
            const geometry = segment.geometry;
            if (!geometryInside(geometry, bounds)) continue;

            let name = '';
            if (segment.primaryStreetId != null) {
                name = streetMap.get(Number(segment.primaryStreetId)) || '';
            }

            roads.push({
                id: String(segment.id),
                name,
                roadType: segment.roadType,
                length: Number(segment.length) || 0,
                isAtoB: !!segment.isAtoB,
                isBtoA: !!segment.isBtoA,
                isTwoWay: !!segment.isTwoWay,
                geometry
            });
        }

        return roads;
    }

    /* ---------------- comparing ---------------- */

    // Rules 1 and 2. Keeps the roads that belong to the area and gives
    // each one the centre of its inside part (used by rule 3).
    function placeRoadsInArea(osmRoads, ring) {
        const inside = [];
        let touching = 0;
        let loops = 0;

        for (const road of osmRoads) {
            const area = measureRoadInArea(road, ring);
            if (!area.belongs) {
                touching++;
                continue;
            }
            if (road.nodeIds[0] === road.nodeIds[road.nodeIds.length - 1]) {
                loops++;
                continue;
            }

            let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
            for (const piece of area.pieces) {
                for (const c of piece.coords) {
                    minLon = Math.min(minLon, c[0]); maxLon = Math.max(maxLon, c[0]);
                    minLat = Math.min(minLat, c[1]); maxLat = Math.max(maxLat, c[1]);
                }
            }
            road.lon = (minLon + maxLon) / 2;
            road.lat = (minLat + maxLat) / 2;
            road.area = area;
            inside.push(road);
        }

        return { inside, touching, loops };
    }

    // Distance from the OSM road's centre to the nearest shape point of
    // a WME road. Stops early once it is within stopAtMeters.
    function roadDistance(osmRoad, wmeRoad, stopAtMeters = Infinity) {
        const geometry = wmeRoad.geometry;
        if (!geometry || !Array.isArray(geometry.coordinates)) return Infinity;

        let min = Infinity;
        for (const point of geometry.coordinates) {
            if (!Array.isArray(point) || point.length < 2) continue;
            const lon = Number(point[0]);
            const lat = Number(point[1]);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

            const d = distanceMeters(osmRoad.lat, osmRoad.lon, lat, lon);
            if (d < min) {
                min = d;
                if (min <= stopAtMeters) return min;
            }
        }
        return min;
    }

    function gridKey(lat, lon) {
        return `${Math.floor(Number(lat) / COMPARE_GRID_CELL_DEGREES)}:${Math.floor(Number(lon) / COMPARE_GRID_CELL_DEGREES)}`;
    }

    function getNearbyIndexedItems(index, lat, lon) {
        const baseLat = Math.floor(Number(lat) / COMPARE_GRID_CELL_DEGREES);
        const baseLon = Math.floor(Number(lon) / COMPARE_GRID_CELL_DEGREES);
        const candidates = new Set();

        for (let dLat = -1; dLat <= 1; dLat++) {
            for (let dLon = -1; dLon <= 1; dLon++) {
                const bucket = index.get(`${baseLat + dLat}:${baseLon + dLon}`);
                if (!bucket) continue;
                for (const itemIndex of bucket) candidates.add(itemIndex);
            }
        }
        return candidates;
    }

    // Rule 3: a WME road within 40 m of the centre = matched.
    function compareRoads(wmeRoads, osmRoads) {
        const missing = [];
        const matched = [];
        const index = new Map();

        for (let i = 0; i < wmeRoads.length; i++) {
            const coordinates = wmeRoads[i]?.geometry?.coordinates;
            if (!Array.isArray(coordinates)) continue;

            const seenKeys = new Set();
            for (const point of coordinates) {
                if (!Array.isArray(point) || point.length < 2) continue;
                const lon = Number(point[0]);
                const lat = Number(point[1]);
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

                const key = gridKey(lat, lon);
                if (seenKeys.has(key)) continue;
                seenKeys.add(key);

                let bucket = index.get(key);
                if (!bucket) {
                    bucket = [];
                    index.set(key, bucket);
                }
                bucket.push(i);
            }
        }

        for (const osmRoad of osmRoads) {
            let bestMatch = null;
            let bestDistance = Infinity;

            for (const candidateIndex of getNearbyIndexedItems(index, osmRoad.lat, osmRoad.lon)) {
                const wmeRoad = wmeRoads[candidateIndex];
                const d = roadDistance(osmRoad, wmeRoad, 40);
                if (d < bestDistance) {
                    bestDistance = d;
                    bestMatch = wmeRoad;
                }
            }

            if (bestMatch && bestDistance <= 40) {
                const osmName = normalizeName(osmRoad.name);
                const wmeName = normalizeName(bestMatch.name);
                matched.push({
                    osm: osmRoad,
                    wme: bestMatch,
                    distance: bestDistance,
                    sameName: !osmName || !wmeName || osmName === wmeName
                });
            } else {
                missing.push({ osm: osmRoad, nearestWME: bestMatch, distance: bestDistance });
            }
        }

        return { missing, matched };
    }

    /* ---------------- the scan itself ---------------- */

    // Runs when the area is marked and when "Scan again" is pressed.
    // OpenStreetMap is asked for the box around the area; the shape
    // itself is applied here, road by road.
    async function scanArea() {
        if (!sdk || !selectedBounds || !selectedRing || batchRunning) return;

        const token = ++ui.scanToken;
        const bounds = selectedBounds;
        const ring = selectedRing;
        const zoom = safeCall(() => Number(sdk.Map.getZoomLevel()), null);

        ui.scanning = false;
        ui.scanError = '';
        ui.scanInfo = null;
        ui.buildBlock = '';
        ui.offScreenAsked = false;
        ui.scanZoom = Number.isFinite(zoom) ? zoom : null;
        ui.result = null;
        comparisonData = null;
        skippedOsmIds.clear();
        drawnOsmIds.clear();

        if (!areaIsOnScreen()) {
            ui.scanError = OFF_SCREEN_MESSAGE;
            render();
            return;
        }

        // Forget roads whose segments are gone (undone or deleted by hand),
        // so they are offered again.
        pruneCreatedSegmentIds();

        ui.scanning = true;
        updateStatus('Reading WME roads...');
        render();

        try {
            const wmeRoads = extractWmeRoads(bounds);

            const askedAt = Date.now();
            const osmRoads = await queryOverpassRoads(bounds);
            if (token !== ui.scanToken) return;
            ui.scanInfo = {
                seconds: ((Date.now() - askedAt) / 1000).toFixed(1),
                // 3.8.8: say so when the answer came from the cache (Section 3)
                host: osmCacheAgeMin != null
                    ? `the cache (${osmCacheAgeMin} min old)`
                    : hostOf(preferredOverpassServer)
            };

            updateStatus('Comparing OpenStreetMap with WME...');

            // 1) which OSM roads belong to the area at all
            const placed = placeRoadsInArea(osmRoads, ring);

            // 2) a WME road within 40 m of the inside part's centre = already there
            const compared = compareRoads(wmeRoads, placed.inside);

            // 3) the inside part runs along an existing WME road = already there
            existingLegIndexCache = null;
            const missing = [];

            // 2b) 3.9.2: check the matches of step 2 again. A WME point
            // near the centre is only proof when a WME road also runs ALONG
            // the OSM road (NEAR_ALONG_M, Section 1). A road that fails goes
            // on to step 3 like any other road. It is marked nearOnly so
            // that a later version can ask the editor to look at it.
            // (The sampling is the same as wayCoverageByExisting, with a
            // wider corridor; fold the two into one at the next full pass.)
            const runsAlong = pieces => {
                const index = getExistingLegIndex();
                let samples = 0;
                let covered = 0;
                for (const piece of pieces) {
                    const length = lineLengthM(piece.coords);
                    const step = Math.max(3, Math.min(10, length / 20));
                    for (let d = step / 2; d < length; d += step) {
                        const pt = pointAlongLineFromEnd(piece.coords, true, d)?.coordinates;
                        const ahead = pointAlongLineFromEnd(piece.coords, true, Math.min(length, d + 1))?.coordinates;
                        if (!pt || !ahead) continue;
                        const m = metersPerDegree(pt[1]);
                        const wv = [(ahead[0] - pt[0]) * m.x, (ahead[1] - pt[1]) * m.y];
                        const wl = Math.hypot(wv[0], wv[1]);
                        const cx = Math.floor(pt[0] / COVERAGE_CELL_DEG);
                        const cy = Math.floor(pt[1] / COVERAGE_CELL_DEG);
                        let hit = false;
                        for (let dx = -1; dx <= 1 && !hit; dx++) {
                            for (let dy = -1; dy <= 1 && !hit; dy++) {
                                for (const leg of index.get(`${cx + dx}:${cy + dy}`) || []) {
                                    const cp = closestPointOnLineSegmentMeters(pt, leg.a, leg.b);
                                    if (!cp || cp.distanceSquaredMeters > NEAR_ALONG_M * NEAR_ALONG_M) continue;
                                    const lv = [(leg.b[0] - leg.a[0]) * m.x, (leg.b[1] - leg.a[1]) * m.y];
                                    const ll = Math.hypot(lv[0], lv[1]);
                                    if (wl && ll && Math.abs((wv[0] * lv[0] + wv[1] * lv[1]) / (wl * ll)) > 0.87) {
                                        hit = true;
                                        break;
                                    }
                                }
                            }
                        }
                        samples++;
                        if (hit) covered++;
                    }
                }
                return samples ? covered / samples : 0;
            };

            const candidates = compared.missing.slice();
            const confirmed = [];
            for (const match of compared.matched) {
                if (runsAlong(match.osm.area.pieces) >= NEAR_ALONG_SHARE) {
                    confirmed.push(match);
                } else {
                    candidates.push({ osm: match.osm, nearestWME: match.wme, distance: match.distance, nearOnly: true });
                }
            }
            log(`Scan: ${compared.matched.length - confirmed.length} of ${compared.matched.length} roads had a WME point near their centre but no WME road along them; they are checked again as missing.`);
            compared.matched = confirmed;

            for (const item of candidates) {
                if (insideCoverage(item.osm.area.pieces) >= 0.5) {
                    compared.matched.push({ osm: item.osm, wme: null, distance: null, sameName: true });
                } else {
                    missing.push(item);
                }
            }

            comparisonData = {
                roads: { missing, matched: compared.matched },
                touching: placed.touching,
                loops: placed.loops,
                // 3.10.2: what was decided for every OpenStreetMap road that
                // was read, and why. Printed at the top of the run log
                // (Section 8), so that "why was this road not offered?" can
                // be answered from the log. Footways, paths and steps are
                // not in it: they are dropped when the answer is read
                // (NOT_DRAWN_ROAD_TYPES).
                report: (() => {
                    const missingIds = new Set(missing.map(item => String(item.osm.osmId)));
                    const matchById = new Map(compared.matched.map(match => [String(match.osm.osmId), match]));
                    const percent = share => `${Math.round(share * 100)}%`;
                    return osmRoads.map(road => {
                        const id = String(road.osmId);
                        const head = `OSM ${id} "${road.name || '-'}" ${road.highway || '-'}`;
                        const area = road.area || measureRoadInArea(road, ring);
                        if (!area.belongs) {
                            return `${head}: outside the area (${area.insideLength.toFixed(0)} m of ${area.fullLength.toFixed(0)} m inside)`;
                        }
                        if (road.nodeIds[0] === road.nodeIds[road.nodeIds.length - 1]) {
                            return `${head}: closed loop, left for the roundabout tool`;
                        }
                        if (missingIds.has(id)) {
                            return `${head}: MISSING, offered (${area.insideLength.toFixed(0)} m inside)`;
                        }
                        const match = matchById.get(id);
                        if (match?.wme) {
                            return `${head}: in WME already: a point of WME ${match.wme.id} is ${Number(match.distance).toFixed(0)} m ` +
                                `from its centre and WME roads run along ${percent(runsAlong(area.pieces))} of it`;
                        }
                        return `${head}: in WME already: ${percent(insideCoverage(area.pieces))} of it runs along existing roads`;
                    });
                })()
            };

            log('Scan:', {
                osmSeconds: ui.scanInfo.seconds,
                osmServer: ui.scanInfo.host,
                wmeRoads: wmeRoads.length,
                osmRoads: osmRoads.length,
                inArea: placed.inside.length,
                touching: placed.touching,
                loops: placed.loops,
                missing: missing.length
            });
        } catch (error) {
            if (token !== ui.scanToken) return;
            console.error(`[${SCRIPT_NAME}] Scan failed`, error);
            ui.scanError = `OpenStreetMap could not be read: ${error?.message || error} Wait a minute and scan again, or mark a smaller area.`;
        } finally {
            if (token === ui.scanToken) {
                ui.scanning = false;
                updateStatus('');
                render();
            }
        }
    }

    /* ---------------- what is still left to draw ---------------- */

    // OSM ways that currently have at least one drawn segment. A way cut
    // into several pieces is stored as "id", "id~2", "id~3"...
    function builtOsmIdSet() {
        const result = new Set();
        for (const [key, value] of createdWmeSegments.entries()) {
            if (value?.segmentIds?.length) result.add(String(key).split('~')[0]);
        }
        return result;
    }

    // Missing roads that are neither drawn yet nor refused by the last build.
    // A short road drawn inside a longer line has no segment of its own, so
    // "drawn since the last scan" is remembered separately (drawnOsmIds).
    function remainingMissing() {
        if (!comparisonData) return [];
        const built = builtOsmIdSet();
        return comparisonData.roads.missing.filter(item => {
            const id = String(item.osm.osmId);
            return !built.has(id) && !skippedOsmIds.has(id) && !drawnOsmIds.has(id);
        });
    }

    function highwayOf(item) {
        return String(item?.osm?.highway || 'other');
    }

    // The roads the Draw button will work on: still missing, and of a
    // road type the editor left ticked.
    function getBuildQueue() {
        return remainingMissing().filter(item => !excludedHighways.has(highwayOf(item)));
    }

// ████████████████████████  SECTION 6 — PROPS  ████████████████████████

    /* ================================================================
       SECTION 6 — PROPS: OSM tags -> WME road properties

       PURPOSE   Decide and apply, for every new segment: road type,
                 direction, speed limits, lane counts, flags (unpaved,
                 tunnel), toll, elevation level, street name and city.
       USES      Sections 1 to 4, Section 10 (updateStatus).
       USED BY   Section 8 (applyBatchProperties is the last build
                 step), Section 7 (batchEdgeSignature, to split a line
                 where the properties change; inferWmeRoadType).
       NOTES     * WME road type numbers used here:
                     1 Street            2 Primary Street
                     3 Freeway           4 Ramp
                     5 Walking Trail     6 Major Highway
                     7 Minor Highway     8 Off-road / Not maintained
                     9 Walkway          15 Ferry
                    16 Stairway         17 Private Road
                    18 Railroad         19 Runway / Taxiway
                    22 Narrow Street (alley)
                 * Direction is relative to the way the SEGMENT was
                   drawn (A -> B), which can be the reverse of the OSM
                   way: lines are built through junctions in either
                   direction. isSegmentReversedAgainstWay() finds out,
                   and everything directional is swapped when it is.
                 * Properties are applied in one updateSegment call; if
                   WME refuses it, they are applied one by one so that
                   only the bad one is lost and reported.
                 * City: taken from the nearest WME segment that has a
                   city (so new streets get the same city as their
                   neighbours); OSM address tags are only a fallback.

       CHANGES TO THIS SECTION
         3.8.0  created by the restructure (code unchanged).
       ================================================================ */

    /* ---------------- single values ---------------- */

    // OSM highway=* -> WME road type number. Unknown values become Street.
    function inferWmeRoadType(highway, tags) {
        const value = String(highway || '').trim().toLowerCase();
        const access = String(tags?.access || '').trim().toLowerCase();

        const map = {
            motorway: 3,
            motorway_link: 4,
            // 3.9.1: one step up the WME ladder per OSM class, as the owner
            // asked: residential = Street, tertiary = Primary Street,
            // secondary = Minor Highway, primary = Major Highway, and
            // everything above that (trunk, motorway) = Freeway, the
            // biggest type WME has. Before: trunk 6, primary 2, tertiary 7.
            trunk: 3,
            trunk_link: 4,
            primary: 6,
            primary_link: 4,
            secondary: 7,
            secondary_link: 4,
            tertiary: 2,
            tertiary_link: 4,
            residential: 1,
            unclassified: 1,
            living_street: 1,
            service: access === 'private' ? 17 : 1,
            track: 8,
            path: 5,
            footway: 5,
            cycleway: 5,
            bridleway: 5,
            pedestrian: 9,
            pedestrian_area: 9,
            steps: 16,
            corridor: 9,
            alley: 22,
            ferry: 15,
            rail: 18,
            railway: 18,
            runway: 19,
            taxiway: 19
        };

        return map[value] || 1;
    }

    // "50", "30 mph", "5 knots" -> km/h, or null.
    function parseSpeedLimitKmH(value) {
        if (value == null || String(value).trim() === '') return null;

        const text = String(value).trim().toLowerCase();
        const match = text.match(/(-?\d+(?:[.,]\d+)?)/);
        if (!match) return null;

        const number = Number(match[1].replace(',', '.'));
        if (!Number.isFinite(number)) return null;

        if (text.includes('mph')) return Math.round(number * 1.609344);
        if (text.includes('kn')) return Math.round(number * 1.852);
        return Math.round(number);
    }

    function parseLaneCount(value) {
        if (value == null || String(value).trim() === '') return null;

        const match = String(value).match(/\d+(?:[.,]\d+)?/);
        if (!match) return null;

        const number = Number(match[0].replace(',', '.'));
        if (!Number.isFinite(number) || number <= 0) return null;

        return Math.max(1, Math.round(number));
    }

    // OSM oneway=* -> 'A_TO_B' | 'B_TO_A' | 'TWO_WAY' (along the OSM way).
    function getPreparedDirection(oneway) {
        const value = String(oneway ?? '').trim().toLowerCase();
        if (value === 'yes' || value === 'true' || value === '1') return 'A_TO_B';
        if (value === '-1') return 'B_TO_A';
        return 'TWO_WAY';
    }

    function buildLaneInfo(lanes) {
        const n = Number(lanes);
        if (!Number.isFinite(n) || n < 1 || n > 32) return null;
        return { lanesCount: Math.round(n) };
    }

    /* ---------------- all properties of one segment ---------------- */

    // A text that is equal for two neighbouring pieces of a line when
    // they would get the same properties. Section 7 splits the line
    // where it changes.
    function batchEdgeSignature(item, network) {
        const edge = network.edges[item.edge];
        const tags = network.ways[edge.wayIndex].tags || {};
        let dir = getPreparedDirection(tags.oneway);
        if (item.reversed && dir !== 'TWO_WAY') dir = dir === 'A_TO_B' ? 'B_TO_A' : 'A_TO_B';
        return JSON.stringify([
            inferWmeRoadType(tags.highway, tags), dir, getOsmStreetName(tags),
            tags.maxspeed || '', tags.lanes || '', tags.surface || '',
            tags.bridge || '', tags.tunnel || '', tags.layer || '', tags.toll || ''
        ]);
    }

    // True when the segment runs against the direction of its OSM way.
    function isSegmentReversedAgainstWay(coords, wayEdges) {
        const L = lineLengthM(coords);
        if (!wayEdges.length || L <= 0) return false;

        const d = Math.min(1, L / 4);
        const p1 = pointAlongLineFromEnd(coords, true, L / 2 - d)?.coordinates;
        const p2 = pointAlongLineFromEnd(coords, true, L / 2 + d)?.coordinates;
        const mid = lineMidpoint(coords);
        if (!p1 || !p2 || !mid) return false;

        let best = null;
        for (const edge of wayEdges) {
            const near = nearestPointOnLine(mid, edge.coords);
            if (near && (!best || near.distance < best.distance)) best = { distance: near.distance, edge };
        }
        if (!best) return false;

        return alongPositionM(p2, best.edge.coords) < alongPositionM(p1, best.edge.coords);
    }

    // The object handed to Segments.updateSegment for one segment.
    function buildBatchSegmentUpdate(tags, reversed) {
        const yes = v => ['yes', 'true', '1'].includes(String(v || '').toLowerCase());
        const update = { roadType: inferWmeRoadType(tags.highway, tags) };

        let direction = getPreparedDirection(tags.oneway);
        if (reversed && direction !== 'TWO_WAY') direction = direction === 'A_TO_B' ? 'B_TO_A' : 'A_TO_B';
        update.direction = direction;

        const base = parseSpeedLimitKmH(tags.maxspeed);
        const fwd = parseSpeedLimitKmH(reversed ? tags['maxspeed:backward'] : tags['maxspeed:forward']) ?? base;
        const rev = parseSpeedLimitKmH(reversed ? tags['maxspeed:forward'] : tags['maxspeed:backward']) ?? base;
        if (fwd != null && direction !== 'B_TO_A') update.fwdSpeedLimit = fwd;
        if (rev != null && direction !== 'A_TO_B') update.revSpeedLimit = rev;

        let fwdLanes = parseLaneCount(reversed ? tags['lanes:backward'] : tags['lanes:forward']);
        let revLanes = parseLaneCount(reversed ? tags['lanes:forward'] : tags['lanes:backward']);
        const total = parseLaneCount(tags.lanes);
        if (direction === 'A_TO_B' && fwdLanes == null) fwdLanes = total;
        if (direction === 'B_TO_A' && revLanes == null) revLanes = total;
        const fwdInfo = direction !== 'B_TO_A' ? buildLaneInfo(fwdLanes) : null;
        const revInfo = direction !== 'A_TO_B' ? buildLaneInfo(revLanes) : null;
        if (fwdInfo) update.fromLanesInfo = fwdInfo;
        if (revInfo) update.toLanesInfo = revInfo;

        const unpaved = ['unpaved', 'dirt', 'gravel', 'ground', 'fine_gravel', 'compacted', 'sand', 'earth']
            .includes(String(tags.surface || '').toLowerCase());
        const tunnel = yes(tags.tunnel);
        if (unpaved || tunnel) {
            update.flagAttributes = {
                ...(unpaved ? { unpaved: true } : {}),
                ...(tunnel ? { tunnel: true } : {})
            };
        }

        if (yes(tags.toll)) update.hasToll = true;

        const hasLayer = tags.layer != null && String(tags.layer).trim() !== '' && Number.isFinite(Number(tags.layer));
        const elevation = hasLayer
            ? Math.max(-5, Math.min(9, Math.round(Number(tags.layer))))
            : (yes(tags.bridge) ? 1 : (tunnel ? -1 : 0));
        if (elevation !== 0) update.elevationLevel = elevation;

        return update;
    }

    // One call for everything; if WME refuses it, one call per property
    // so that only the property WME does not accept is lost.
    function applySegmentUpdateSafely(id, update, stats) {
        const segments = wmeSegments();
        const current = liveSegment(id);
        const currentDirection = current?.isTwoWay ? 'TWO_WAY'
            : current?.isAtoB ? 'A_TO_B'
                : current?.isBtoA ? 'B_TO_A' : null;

        if (update.direction && update.direction === currentDirection) delete update.direction;
        if (update.roadType != null && Number(update.roadType) === Number(current?.roadType)) delete update.roadType;
        if (!Object.keys(update).length) return;

        try {
            segments.updateSegment({ segmentId: id, ...update });
            return;
        } catch (error) {
            // isolate the failing attribute below
        }

        for (const [key, value] of Object.entries(update)) {
            try {
                segments.updateSegment({ segmentId: id, [key]: value });
            } catch (error) {
                stats.propertiesFailed++;
                stats.warnings.push(`Segment ${id} ${key}: ${error?.message || error}`);
            }
        }
    }

    /* ---------------- address: city, state, country ---------------- */

    const wmeNearbyAddressCache = new Map();    // "lat,lon" -> { city, country }
    const wmeNearbyAddressPromises = new Map(); // lookups that are still running

    // City and country of the nearest WME segments that have them.
    async function findNearestWmeAddress(lat, lon) {
        const safeLat = Number(lat);
        const safeLon = Number(lon);
        if (!Number.isFinite(safeLat) || !Number.isFinite(safeLon)) return null;

        const cacheKey = `${safeLat.toFixed(5)},${safeLon.toFixed(5)}`;
        if (wmeNearbyAddressCache.has(cacheKey)) return wmeNearbyAddressCache.get(cacheKey);
        if (wmeNearbyAddressPromises.has(cacheKey)) return wmeNearbyAddressPromises.get(cacheKey);

        const requestPromise = (async () => {
            try {
                const segmentModule = sdk?.DataModel?.Segments;
                if (!segmentModule || typeof segmentModule.getAll !== 'function') return null;

                const candidates = [];
                for (const segment of segmentModule.getAll() || []) {
                    const distance = pointToLineStringDistanceMeters(safeLat, safeLon, segment?.geometry);
                    if (!Number.isFinite(distance)) continue;
                    candidates.push({ segment, distance });
                }
                candidates.sort((a, b) => a.distance - b.distance);

                const inspectCount = Math.min(40, candidates.length);
                const nearestCity = [];
                const nearestCountry = [];

                for (let i = 0; i < inspectCount; i += 1) {
                    const candidate = candidates[i];
                    let address = null;
                    try {
                        if (typeof segmentModule.getAddress === 'function') {
                            address = segmentModule.getAddress({ segmentId: Number(candidate.segment?.id) });
                        }
                    } catch (error) {
                        continue;
                    }
                    if (!address) continue;

                    if (address.city?.name) {
                        nearestCity.push({
                            name: String(address.city.name).trim(),
                            id: address.city.id != null ? Number(address.city.id) : null,
                            countryId: address.city.countryId != null ? Number(address.city.countryId) : null,
                            stateId: address.city.stateId != null ? Number(address.city.stateId) : null,
                            distance: candidate.distance,
                            segmentId: candidate.segment?.id
                        });
                    }
                    if (address.country?.name) {
                        nearestCountry.push({
                            name: String(address.country.name).trim(),
                            id: address.country.id != null ? Number(address.country.id) : null,
                            distance: candidate.distance,
                            segmentId: candidate.segment?.id
                        });
                    }
                    if (nearestCity.length && nearestCountry.length && candidate.distance < 250) break;
                }

                const result = {
                    city: nearestCity[0] || null,
                    country: nearestCountry[0] || null
                };
                wmeNearbyAddressCache.set(cacheKey, result);
                return result;
            } catch (error) {
                log('Nearest WME address lookup failed:', error);
                return null;
            }
        })();

        wmeNearbyAddressPromises.set(cacheKey, requestPromise);
        try {
            return await requestPromise;
        } finally {
            wmeNearbyAddressPromises.delete(cacheKey);
        }
    }

    // normalizeName() plus folding of Arabic letter variants (the forms
    // of alef, ta marbuta / ha, alef maqsura / ya), so that two
    // spellings of the same place name compare equal.
    function normalizeLookupName(value) {
        return normalizeName(String(value || ''))
            .replace(/أ/g, 'ا')
            .replace(/إ/g, 'ا')
            .replace(/آ/g, 'ا')
            .replace(/ة/g, 'ه')
            .replace(/ى/g, 'ي');
    }

    // Fallback when the nearest-segment lookup gave no country or state:
    // find WME's country / state / city ids from names and position.
    function resolveWmeAddressIds(draft) {
        const result = {
            countryId: Number.isFinite(Number(draft.countryId)) && draft.countryId != null ? Number(draft.countryId) : null,
            stateId: Number.isFinite(Number(draft.stateId)) && draft.stateId != null ? Number(draft.stateId) : null,
            countryName: draft.countryName || '',
            stateName: draft.stateName || '',
            wmeCityId: null,
            wmeCityName: '',
            wmeCityCountryId: null,
            wmeCityStateId: null
        };

        try {
            const dm = sdk?.DataModel;
            const countryModule = dm?.Countries;
            const stateModule = dm?.States;
            const cityModule = dm?.Cities;

            if (!result.countryId && draft.wmeCountryId != null && Number.isFinite(Number(draft.wmeCountryId))) {
                result.countryId = Number(draft.wmeCountryId);
                try {
                    const country = typeof countryModule?.getById === 'function'
                        ? countryModule.getById({ countryId: result.countryId })
                        : null;
                    if (country?.name) result.countryName = country.name;
                } catch (error) {
                    log('WME country getById failed:', error);
                }
            }

            if (cityModule && typeof cityModule.getById === 'function' &&
                draft.wmeCityId != null && Number.isFinite(Number(draft.wmeCityId))) {
                try {
                    const knownCity = cityModule.getById({ cityId: Number(draft.wmeCityId) });
                    if (knownCity) {
                        result.wmeCityId = Number(knownCity.id);
                        result.wmeCityName = String(knownCity.name || '').trim();
                        result.wmeCityCountryId = knownCity.countryId != null ? Number(knownCity.countryId) : null;
                        result.wmeCityStateId = knownCity.stateId != null ? Number(knownCity.stateId) : null;
                        if (!result.countryId && result.wmeCityCountryId != null) result.countryId = result.wmeCityCountryId;
                        if (!result.stateId && result.wmeCityStateId != null) result.stateId = result.wmeCityStateId;
                    }
                } catch (error) {
                    log('WME city getById failed:', error);
                }
            }

            if (!result.countryId && countryModule) {
                const countries = typeof countryModule.getAll === 'function' ? countryModule.getAll() : [];
                const target = normalizeLookupName(draft.countryName);
                const match = countries.find(country => {
                    const names = [country?.name, country?.englishName, country?.abbr]
                        .filter(Boolean)
                        .map(normalizeLookupName);
                    return target && names.includes(target);
                });
                const topCountry = typeof countryModule.getTopCountry === 'function'
                    ? countryModule.getTopCountry()
                    : null;
                const chosen = match || topCountry;
                if (chosen?.id != null) {
                    result.countryId = Number(chosen.id);
                    result.countryName = chosen.name || chosen.englishName || result.countryName;
                }
            }

            const cities = cityModule && typeof cityModule.getAll === 'function' ? (cityModule.getAll() || []) : [];
            const targetCity = normalizeLookupName(draft.cityName);
            const addressLat = Number(draft._addressLat);
            const addressLon = Number(draft._addressLon);

            let bestCity = null;
            let bestDistance = Infinity;

            const cityDistance = city => {
                const point = city.geometry?.coordinates;
                const lon = Array.isArray(point) ? Number(point[0]) : NaN;
                const lat = Array.isArray(point) ? Number(point[1]) : NaN;
                return Number.isFinite(lat) && Number.isFinite(lon) &&
                    Number.isFinite(addressLat) && Number.isFinite(addressLon)
                    ? distanceMeters(addressLat, addressLon, lat, lon)
                    : null;
            };

            const cityAllowed = city => {
                if (result.countryId && city.countryId != null && Number(city.countryId) !== Number(result.countryId)) return false;
                if (result.stateId && city.stateId != null && Number(city.stateId) !== Number(result.stateId)) return false;
                return true;
            };

            // 1) exact name match
            for (const city of cities) {
                if (!city) continue;
                const cityName = normalizeLookupName(city.name);
                if (!targetCity || !cityName || cityName !== targetCity) continue;
                if (!cityAllowed(city)) continue;
                const d = cityDistance(city) ?? 0;
                if (!bestCity || d < bestDistance) {
                    bestCity = city;
                    bestDistance = d;
                }
            }

            // 2) nearest WME city (OSM name may be spelled differently)
            if (!bestCity && Number.isFinite(addressLat) && Number.isFinite(addressLon)) {
                for (const city of cities) {
                    if (!city || city.isEmpty || !cityAllowed(city)) continue;
                    const d = cityDistance(city);
                    if (d == null) continue;
                    if (d < bestDistance) {
                        bestCity = city;
                        bestDistance = d;
                    }
                }
                if (bestCity && bestDistance > 50000) bestCity = null;
            }

            if (bestCity) {
                result.wmeCityId = bestCity.id != null ? Number(bestCity.id) : null;
                result.wmeCityName = String(bestCity.name || '').trim();
                result.wmeCityCountryId = bestCity.countryId != null ? Number(bestCity.countryId) : null;
                result.wmeCityStateId = bestCity.stateId != null ? Number(bestCity.stateId) : null;
                if (!result.countryId && result.wmeCityCountryId != null) result.countryId = result.wmeCityCountryId;
                if (!result.stateId && result.wmeCityStateId != null) result.stateId = result.wmeCityStateId;
            }

            if (!result.stateId && stateModule && typeof stateModule.getAll === 'function') {
                const targetState = normalizeLookupName(draft.stateName);
                const stateMatch = (stateModule.getAll() || []).find(state => {
                    const stateName = normalizeLookupName(state?.name);
                    return targetState && stateName && stateName === targetState;
                });
                if (stateMatch?.id != null) {
                    result.stateId = Number(stateMatch.id);
                    result.stateName = stateMatch.name || result.stateName;
                }
            }

            if (!result.countryId && countryModule && typeof countryModule.getTopCountry === 'function') {
                const topCountry = countryModule.getTopCountry();
                if (topCountry?.id != null) {
                    result.countryId = Number(topCountry.id);
                    result.countryName = topCountry.name || result.countryName;
                }
            }

            if (bestCity && !result.stateId && bestCity.stateId != null) {
                result.stateId = Number(bestCity.stateId);
            }
        } catch (error) {
            log('WME address ID resolution failed:', error);
        }

        return result;
    }

    // The address for one OSM way: { cityName, countryId, stateId? },
    // or null when not even a country could be found.
    async function resolveBatchAddress(way) {
        const P = asLonLat(way.coords[Math.floor(way.coords.length / 2)]);
        if (!P) return null;

        let near = null;
        try {
            near = await findNearestWmeAddress(P[1], P[0]);
        } catch (e) { /* ignore */ }

        let cityName = near?.city?.name || '';
        let countryId = near?.city?.countryId ?? near?.country?.id ?? null;
        let stateId = near?.city?.stateId ?? null;

        if (!countryId || stateId == null) {
            const ids = resolveWmeAddressIds({
                countryName: getOsmCountryName(way.tags),
                cityName: cityName || getOsmCityName(way.tags),
                stateName: getOsmStateName(way.tags),
                _addressLat: P[1],
                _addressLon: P[0]
            });
            countryId = countryId || ids.countryId;
            if (stateId == null) stateId = ids.stateId;
            if (!cityName) cityName = ids.wmeCityName || '';
        }

        if (stateId == null) {
            try {
                const top = sdk?.DataModel?.States?.getTopState?.();
                if (top?.id != null) stateId = Number(top.id);
            } catch (e) { /* ignore */ }
        }

        if (!countryId) return null;

        const address = { cityName, countryId: Number(countryId) };
        if (stateId != null) address.stateId = Number(stateId);
        return address;
    }

    /* ---------------- the build step ---------------- */

    // Last build step: gives every new segment its real properties and
    // its address. Runs after the junctions, because until then all new
    // segments must share one road type (decision D6).
    async function applyBatchProperties(network, stats) {
        const segments = wmeSegments();
        const edgesByWay = new Map();
        network.edges.forEach(edge => {
            if (!edgesByWay.has(edge.wayIndex)) edgesByWay.set(edge.wayIndex, []);
            edgesByWay.get(edge.wayIndex).push(edge);
        });

        for (let wi = 0; wi < network.ways.length; wi++) {
            const way = network.ways[wi];
            const owner = createdWmeSegments.get(way.osmId);
            if (!owner?.segmentIds?.length) continue;

            const tags = way.tags || {};
            const address = await resolveBatchAddress(way);

            for (const raw of owner.segmentIds) {
                const id = Number(raw);
                const c = liveSegment(id)?.geometry?.coordinates;
                if (!c || c.length < 2) continue;

                const reversed = isSegmentReversedAgainstWay(c, edgesByWay.get(wi) || []);
                applySegmentUpdateSafely(id, buildBatchSegmentUpdate(tags, reversed), stats);

                if (address && typeof segments.updateAddress === 'function') {
                    try {
                        segments.updateAddress({
                            segmentId: id,
                            addressData: { ...address, streetName: getOsmStreetName(tags) || '' }
                        });
                    } catch (error) {
                        stats.propertiesFailed++;
                        stats.warnings.push(`Address ${id}: ${error?.message || error}`);
                    }
                }
            }

            owner.propertiesApplied = true;

            if (wi % 10 === 9) {
                updateStatus(`Applying road properties... ${wi + 1}/${network.ways.length}`);
                await sleep(0);
            }
        }
    }

// ████████████████████████  SECTION 7 — JUNCTIONS  ████████████████████████

    /* ================================================================
       SECTION 7 — JUNCTIONS: roads -> joined WME segments

       PURPOSE   Turn a set of OSM ways into WME segments that share
                 nodes where the roads meet.
       USES      Sections 1 to 4, Section 6 (batchEdgeSignature,
                 getOsmStreetName via Section 3), Section 8 (runLog).
       USED BY   Section 8 (calls the steps in order).

       THE PROBLEM THIS SECTION SOLVES (decisions D3, D7, D8, D9)
         The WME SDK cannot merge two nodes. If two roads were drawn
         separately, each ending at the junction, there would be two
         nodes on top of each other and no way to make them one.
         The only SDK calls that create a SHARED node are:
           addIntersection  two segments that really CROSS -> both are
                            cut and one node is created at the crossing
           splitSegment     one segment is cut -> a node in its middle
         and addIntersection has two limits:
           * "Segments does not have a split point" when one segment
             only TOUCHES the other (ends exactly on it);
           * it cannot cut a segment exactly at one of its own shape
             points ("splitNode is null").

       THE METHOD
         1. buildBatchNetwork: cut the ways into edges at shared OSM
            nodes, then pair the road ends at every junction (opposite
            ends go together) and chain the edges into long "strokes"
            that pass THROUGH the junctions. Each stroke is drawn as
            one segment.
         2. A junction where two strokes pass through is a real X:
            addIntersection makes the node (batchCross).
         3. A junction where a stroke ENDS on another is a T: push the
            end OVERSHOOT_M past the other road so that it crosses,
            addIntersection, then delete the little stub that sticks
            out (batchTee -> connectEndpointByOvershoot).
         4. Where the properties change along a stroke (two OSM ways
            chained together), cut it there (batchSplit).
         Around that: rules that keep addIntersection away from the
         cases it breaks on (7b, 7f).

       LAYOUT OF THIS SECTION
         7a  network: ways -> edges -> strokes
         7b  two segments that meet in more than one place
         7c  the one gateway to addIntersection
         7d  T-junctions by overshoot
         7e  end-to-end joins (mostly switched off)
         7f  loops and lines joined at both ends
         7g  the junction pass (cross, tee, split) and re-keying
         7h  existing WME roads (list open ends; connecting is off)

       CHANGES TO THIS SECTION
         3.8.0  created by the restructure. The rules that used to wrap
                addIntersectionPreservingRoadTypes, batchTee and
                batchCross from outside are now their first lines.
       ================================================================ */

    /* ---------------- 7a. network: ways -> edges -> strokes ---------------- */

    // Returns { ways, edges, strokes, nodeCoord, selfJoinPoints }.
    //   edge   = { index, wayIndex, nodeIds, coords, from, to }
    //   stroke = { index, list: [{ edge, reversed }], coords, nodeSeq }
    //            (key and owner are added when it is drawn, Section 8)
    function buildBatchNetwork(ways, warnings) {
        const nodeCoord = new Map();
        const usage = new Map();

        for (const way of ways) {
            way.nodeIds.forEach((nid, k) => {
                nodeCoord.set(nid, way.coords[k]);
                usage.set(nid, (usage.get(nid) || 0) + 1);
            });
        }

        // Split every way at nodes it shares with another selected way.
        const edges = [];
        ways.forEach((way, wayIndex) => {
            let startK = 0;
            for (let k = 1; k < way.nodeIds.length; k++) {
                const last = k === way.nodeIds.length - 1;
                if (!last && (usage.get(way.nodeIds[k]) || 0) < 2) continue;
                const nodeIds = way.nodeIds.slice(startK, k + 1);
                startK = k;
                if (nodeIds[0] === nodeIds[nodeIds.length - 1]) {
                    warnings.push(`OSM way ${way.osmId}: a loop part was skipped.`);
                    continue;
                }
                edges.push({
                    index: edges.length,
                    wayIndex,
                    nodeIds,
                    coords: nodeIds.map(n => nodeCoord.get(n)),
                    from: nodeIds[0],
                    to: nodeIds[nodeIds.length - 1]
                });
            }
        });

        const endKey = (edge, atStart) => `${edge}:${atStart ? 1 : 0}`;
        const incidence = new Map();
        const addEnd = (nid, end) => {
            if (!incidence.has(nid)) incidence.set(nid, []);
            incidence.get(nid).push(end);
        };
        for (const edge of edges) {
            addEnd(edge.from, { edge: edge.index, atStart: true });
            addEnd(edge.to, { edge: edge.index, atStart: false });
        }

        const leaving = end => {
            const c = edges[end.edge].coords;
            const a = end.atStart ? c[0] : c[c.length - 1];
            const b = end.atStart ? c[1] : c[c.length - 2];
            const m = metersPerDegree(a[1]);
            const v = [(b[0] - a[0]) * m.x, (b[1] - a[1]) * m.y];
            const l = Math.hypot(v[0], v[1]) || 1;
            return [v[0] / l, v[1] / l];
        };
        const angleDeg = (u, v) =>
            Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]))) * 180 / Math.PI;

        // Pair the road ends at every junction so roads pass THROUGH the
        // node. Ends are sorted by angle around the node and each end is
        // paired with the end OPPOSITE it in that order. Pairs made this
        // way always cross each other (a real X), so ONE addIntersection
        // connects all of them. (Two T's on the same node cannot work: the
        // second T would have to join an existing node, and the SDK has no
        // node merge.) Odd counts leave exactly one end as a T.
        const pairOf = new Map();
        for (const ends of incidence.values()) {
            if (ends.length < 2) continue;

            const items = ends
                .map(end => {
                    const v = leaving(end);
                    return { ...end, v, theta: Math.atan2(v[1], v[0]) };
                })
                .sort((a, b) => a.theta - b.theta);

            const link = (a, b) => {
                if (a.edge === b.edge) return;
                pairOf.set(endKey(a.edge, a.atStart), { edge: b.edge, atStart: b.atStart });
                pairOf.set(endKey(b.edge, b.atStart), { edge: a.edge, atStart: a.atStart });
            };

            const pairOpposite = list => {
                const half = list.length / 2;
                for (let i = 0; i < half; i++) link(list[i], list[i + half]);
            };

            if (items.length === 2) {
                link(items[0], items[1]);
                continue;
            }

            if (items.length % 2 === 0) {
                pairOpposite(items);
                continue;
            }

            // odd: leave out the end that keeps the other pairs straightest
            let bestSkip = 0;
            let bestScore = -Infinity;
            for (let k = 0; k < items.length; k++) {
                const rest = items.filter((_, i) => i !== k);
                const half = rest.length / 2;
                let score = 0;
                for (let i = 0; i < half; i++) score += angleDeg(rest[i].v, rest[i + half].v);
                if (score > bestScore) {
                    bestScore = score;
                    bestSkip = k;
                }
            }
            pairOpposite(items.filter((_, i) => i !== bestSkip));
        }

        const used = new Set();
        const strokes = [];

        const walkForward = entry => {
            const list = [];
            const seen = new Set();
            let cur = entry;
            while (cur && !used.has(cur.edge) && !seen.has(cur.edge)) {
                seen.add(cur.edge);
                const reversed = !cur.atStart;
                list.push({ edge: cur.edge, reversed });
                cur = pairOf.get(endKey(cur.edge, reversed)) || null;
            }
            return list;
        };

        const makeStroke = list => {
            const coords = [];
            const nodeSeq = [];
            for (const item of list) {
                const e = edges[item.edge];
                const ids = item.reversed ? [...e.nodeIds].reverse() : e.nodeIds;
                ids.forEach((nid, k) => {
                    if (k === 0 && nodeSeq.length && nodeSeq[nodeSeq.length - 1] === nid) return;
                    nodeSeq.push(nid);
                    coords.push(nodeCoord.get(nid));
                });
            }
            return { index: 0, list, coords, nodeSeq };
        };

        const pushStroke = list => {
            if (!list.length) return;
            const s = makeStroke(list);
            if (s.nodeSeq[0] === s.nodeSeq[s.nodeSeq.length - 1]) {
                // A closed ring cannot be one WME segment: split it in two.
                if (list.length >= 2) {
                    const mid = Math.ceil(list.length / 2);
                    pushStroke(list.slice(0, mid));
                    pushStroke(list.slice(mid));
                } else {
                    warnings.push('A closed loop could not be drawn.');
                }
                return;
            }
            s.index = strokes.length;
            strokes.push(s);
        };

        for (const edge of edges) {
            if (used.has(edge.index)) continue;

            // walk backwards to the start of the chain this edge is in
            let entry = { edge: edge.index, atStart: true };
            const visited = new Set([edge.index]);
            let cycle = false;

            for (;;) {
                const partner = pairOf.get(endKey(entry.edge, entry.atStart));
                if (!partner) break;
                if (partner.edge === edge.index) { cycle = true; break; }
                if (visited.has(partner.edge) || used.has(partner.edge)) break;
                visited.add(partner.edge);
                entry = { edge: partner.edge, atStart: !partner.atStart };
            }

            if (cycle) entry = { edge: edge.index, atStart: true };

            const list = walkForward(entry);
            list.forEach(item => used.add(item.edge));
            pushStroke(list);
        }

        return { ways, edges, strokes, nodeCoord, selfJoinPoints: [] };
    }

    // The owner's segment that has `point` as one of its INNER shape
    // points (the road passes through it): { id, segment, vertexIndex }.
    function findOwnerSegmentThrough(owner, point) {
        for (const raw of owner?.segmentIds || []) {
            const seg = liveSegment(raw);
            const c = seg?.geometry?.coordinates;
            if (!c || c.length < 3) continue;
            for (let k = 1; k < c.length - 1; k++) {
                if (distanceM(c[k], point) <= BATCH.POINT_EPS_M) {
                    return { id: Number(raw), segment: seg, vertexIndex: k };
                }
            }
        }
        return null;
    }

    // The owner's segment that ENDS at `point`: { id, segment, atStart }.
    function findOwnerSegmentEndingAt(owner, point, excludeId = null) {
        for (const raw of owner?.segmentIds || []) {
            if (excludeId != null && Number(raw) === Number(excludeId)) continue;
            const seg = liveSegment(raw);
            const c = seg?.geometry?.coordinates;
            if (!c || c.length < 2) continue;
            if (distanceM(c[0], point) <= BATCH.POINT_EPS_M) return { id: Number(raw), segment: seg, atStart: true };
            if (distanceM(c[c.length - 1], point) <= BATCH.POINT_EPS_M) return { id: Number(raw), segment: seg, atStart: false };
        }
        return null;
    }

    /* ---------------- 7b. two segments that meet in more than one place ----------------
       WME's addIntersection() cuts two segments at EVERY place they meet,
       but it makes only one node, and gives that node to all the cut ends.
       The pieces at the second place then point at a node that is not
       there: broken segments, and every later junction on those roads
       fails. It happens when a U-shaped road has both ends on the same
       road, or when two roads end on each other.

       So: before two segments are joined at one place, they must not meet
       anywhere else. If they do, one of them gets a node between the two
       places first. That also gives the loop the three segments it needs.
       (decision D7)                                                       */

    // Every place where two lines meet: real crossings, and ends or shape
    // points of one line that lie on the other.
    function contactPoints(a, b) {
        const points = [];
        if (a.length < 2 || b.length < 2) return points;

        const boxA = expandBox(geometryBounds({ coordinates: a }), 1);
        const boxB = expandBox(geometryBounds({ coordinates: b }), 1);
        if (!boxesOverlap(boxA, boxB)) return points;

        const PAD = 0.000002; // about 0.2 m
        for (let i = 0; i < a.length - 1; i++) {
            const p = a[i];
            const q = a[i + 1];
            const minX = Math.min(p[0], q[0]) - PAD, maxX = Math.max(p[0], q[0]) + PAD;
            const minY = Math.min(p[1], q[1]) - PAD, maxY = Math.max(p[1], q[1]) + PAD;
            for (let j = 0; j < b.length - 1; j++) {
                const r = b[j];
                const s = b[j + 1];
                if (Math.max(r[0], s[0]) < minX || Math.min(r[0], s[0]) > maxX ||
                    Math.max(r[1], s[1]) < minY || Math.min(r[1], s[1]) > maxY) continue;
                const hit = findLineIntersectionPoint(p, q, r, s);
                if (hit) points.push(hit.coordinates);
            }
        }

        for (const [line, other, box] of [[a, b, boxB], [b, a, boxA]]) {
            for (const vertex of line) {
                if (vertex[0] < box.minX || vertex[0] > box.maxX || vertex[1] < box.minY || vertex[1] > box.maxY) continue;
                const near = nearestPointOnLine(vertex, other);
                if (near && near.distance <= CONTACT_M) points.push(vertex);
            }
        }

        return points;
    }

    // The contacts WME would cut at: everywhere the two lines meet, except
    // where BOTH of them end (a node they share, or two ends side by side).
    function strayContacts(a, b) {
        const atEnd = (p, line) =>
            Math.min(distanceM(p, line[0]), distanceM(p, line[line.length - 1])) <= BATCH.POINT_EPS_M;
        return contactPoints(a, b).filter(p => !(atEnd(p, a) && atEnd(p, b)));
    }

    // Contacts grouped into separate meeting places.
    function contactPlaces(points) {
        const places = [];
        for (const p of points) {
            if (!places.some(q => distanceM(p, q) <= SAME_PLACE_M)) places.push(p);
        }
        return places;
    }

    function alongGap(coords, p, q) {
        return Math.abs(alongPositionM(p, coords) - alongPositionM(q, coords));
    }

    // Adds a node to a new segment half way between two places on it.
    // Returns the spot, or null when WME refused.
    function splitBetween(segmentId, coords, p, q) {
        if (!getCreatedSegmentIdSet().has(Number(segmentId))) return null; // never an existing road

        const from = alongPositionM(p, coords);
        const to = alongPositionM(q, coords);
        const middle = (from + to) / 2;

        // 3.8.3: first look for a spot that is at least SPLIT_CLEAR_M away
        // from every shape point of the line and from the two places,
        // starting at the middle and moving outwards one metre at a time.
        // (See SPLIT_CLEAR_M in Section 1 for the save error this avoids.)
        const reach = Math.abs(to - from) / 2 - 1.5;
        const avoid = [...coords, p, q];
        let tries = 0;
        for (let step = 0; step <= reach && tries < 6; step++) {
            for (const nudge of step === 0 ? [0] : [step, -step]) {
                const at = pointAlongLineFromEnd(coords, true, middle + nudge)?.coordinates;
                if (!at || avoid.some(vertex => distanceM(vertex, at) < SPLIT_CLEAR_M)) continue;
                tries++;
                if (splitCreatedSegment(segmentId, at)) return at;
            }
        }

        // No roomy spot (a short or very bendy line), or WME refused them
        // all: fall back to the old rule, 0.5 m from shape points.

        for (const nudge of [0, 1, -1, 2, -2]) {
            if (Math.abs(nudge) > Math.abs(to - from) / 2 - 1.5) continue; // stay well between the two places
            const at = pointAlongLineFromEnd(coords, true, middle + nudge)?.coordinates;
            if (!at || coords.some(vertex => distanceM(vertex, at) < 0.5)) continue;
            if (splitCreatedSegment(segmentId, at)) return at;
        }
        return null;
    }

    // findA / findB return the two segments about to be joined at `point`
    // ({ id, ... }), looked up again after every split. Returns false when
    // the two cannot be separated; the junction is then left open.
    function separateBeforeJunction(findA, findB, point, stats) {
        let other = null;

        for (let round = 0; round < 8; round++) {
            const a = findA();
            const b = findB();
            if (!a || !b || a.id === b.id) return true; // nothing this step can help with

            const ac = segmentCoords(a.id);
            const bc = segmentCoords(b.id);
            const stray = strayContacts(ac, bc).filter(c => distanceM(c, point) > JUNCTION_ZONE_M);
            if (!stray.length) return true;

            other = stray[0];
            // cut the road that is longer between the two places
            const options = [
                { id: a.id, coords: ac, gap: alongGap(ac, point, other) },
                { id: b.id, coords: bc, gap: alongGap(bc, point, other) }
            ].sort((x, y) => y.gap - x.gap);

            let cut = null;
            for (const option of options) {
                if (option.gap < MIN_SEPARATE_GAP_M) continue;
                cut = splitBetween(option.id, option.coords, point, other);
                if (cut) break;
            }

            if (!cut) break;

            stats.loopSplits = (stats.loopSplits || 0) + 1;
            runLog.ok(`Node added at ${fmtPoint(cut)}: the two roads joined at ${fmtPoint(point)} also meet at ${fmtPoint(other)}`);
        }

        stats.warnings.push(
            `Junction at ${fmtPoint(point)} was left open: the same two roads also meet at ${fmtPoint(other)} ` +
            'and could not be separated. Join it by hand.'
        );
        return false;
    }

    /* ---------------- 7c. the one gateway to addIntersection ---------------- */

    // Every junction in the script is made through this function.
    // Returns { ok: true, sourceSplits, targetSplits, restoreFailures }
    // (the ids each segment was cut into) or { ok: false, reason }.
    //
    // What it adds around the plain SDK call:
    //   * refuses a segment with itself, and two segments that meet in
    //     more than one place (see 7b): both half-apply in WME and leave
    //     broken pieces behind;
    //   * cleans the geometry of new segments first;
    //   * refuses segments whose end nodes are not loaded;
    //   * addIntersection needs equal road types, so when they differ the
    //     type of one segment is changed for the call and put back on the
    //     pieces afterwards. That segment is always one this script drew.
    function addIntersectionPreservingRoadTypes(sourceSegmentId, targetSegmentId, sourceRoadType, targetRoadType) {
        if (Number(sourceSegmentId) === Number(targetSegmentId)) {
            return { ok: false, reason: 'a segment cannot be joined to itself' };
        }
        const places = contactPlaces(strayContacts(segmentCoords(sourceSegmentId), segmentCoords(targetSegmentId)));
        if (places.length > 1) {
            return {
                ok: false,
                reason: `the two segments meet in ${places.length} places (${places.map(fmtPoint).join(' and ')}); WME can only join them at one`
            };
        }

        sanitizeSegmentGeometry(sourceSegmentId);
        sanitizeSegmentGeometry(targetSegmentId);
        const segments = wmeSegments();
        if (!segments?.addIntersection || typeof segments.updateSegment !== 'function') {
            return { ok: false, reason: 'WME SDK does not expose addIntersection/updateSegment.' };
        }

        const sourceId = Number(sourceSegmentId);
        const targetId = Number(targetSegmentId);
        const sourceType = Number(sourceRoadType);
        const targetType = Number(targetRoadType);

        if (!Number.isFinite(sourceId) || !Number.isFinite(targetId)) {
            return { ok: false, reason: 'Invalid segment IDs.' };
        }

        if (!segmentNodesLoaded(liveSegment(sourceId)) || !segmentNodesLoaded(liveSegment(targetId))) {
            const bad = !segmentNodesLoaded(liveSegment(sourceId)) ? sourceId : targetId;
            const created = getCreatedSegmentIdSet().has(bad);
            return {
                ok: false,
                unloaded: !created,
                reason: created
                    ? `new segment ${bad} has an end node missing from the data model`
                    : `segment ${bad}: an end node is outside the loaded map area`
            };
        }

        // The temporary road-type change below is applied to the TARGET.
        // Make sure the target is a segment created by this script, so an
        // existing WME road is never retyped, not even temporarily.
        if (sourceType !== targetType) {
            const createdIds = getCreatedSegmentIdSet();
            if (!createdIds.has(targetId) && createdIds.has(sourceId)) {
                const swapped = addIntersectionPreservingRoadTypes(targetId, sourceId, targetType, sourceType);
                return swapped.ok
                    ? { ...swapped, sourceSplits: swapped.targetSplits, targetSplits: swapped.sourceSplits }
                    : swapped;
            }
        }

        if (sourceType === targetType) {
            try {
                const result = segments.addIntersection({ segmentIds: [sourceId, targetId] });
                return {
                    ok: true,
                    sourceSplits: (result?.sourceSplits || []).map(Number).filter(Number.isFinite),
                    targetSplits: (result?.targetSplits || []).map(Number).filter(Number.isFinite),
                    restoreFailures: []
                };
            } catch (error) {
                log('addIntersection failed:', sourceId, targetId, error);
                return { ok: false, reason: error?.message || String(error) };
            }
        }

        // addIntersection needs equal road types: temporarily give the target
        // the source type, then restore the original type on its splits.
        let targetTemporarilyChanged = false;
        try {
            segments.updateSegment({ segmentId: targetId, roadType: sourceType });
            targetTemporarilyChanged = true;

            const result = segments.addIntersection({ segmentIds: [sourceId, targetId] });
            const sourceSplits = (result?.sourceSplits || []).map(Number).filter(Number.isFinite);
            const targetSplits = (result?.targetSplits || []).map(Number).filter(Number.isFinite);

            const restoreFailures = [];
            for (const splitId of targetSplits) {
                try {
                    segments.updateSegment({ segmentId: splitId, roadType: targetType });
                } catch (restoreError) {
                    restoreFailures.push(`${splitId}: ${restoreError?.message || restoreError}`);
                }
            }

            return { ok: true, sourceSplits, targetSplits, restoreFailures };
        } catch (error) {
            if (targetTemporarilyChanged && liveSegment(targetId)) {
                try {
                    segments.updateSegment({ segmentId: targetId, roadType: targetType });
                } catch (restoreError) {
                    log('Failed restoring target road type:', restoreError);
                }
            }
            log('addIntersection (different road types) failed:', sourceId, targetId, error);
            return { ok: false, reason: error?.message || String(error) };
        }
    }

    /* ---------------- 7d. T-junctions by overshoot ----------------
       A road that ends exactly ON another road only touches it, so WME
       reports "Segments does not have a split point". For a T we push
       the free end OVERSHOOT_M metres past the target, let
       addIntersection() create a real junction node, then delete the
       tiny stub that sticks out.                                       */

    // End point for a T-junction whose junction lies on (or within 1 m of)
    // a shape point of the target road. WME addIntersection cannot split a
    // segment exactly at one of its shape points ("Segments does not have a
    // split point" / "splitNode is null"), so cross the target 0.3 m NEXT
    // to that point, continuing the road's own direction, and only accept a
    // candidate that crosses the target exactly once, away from its points.
    function offsetCrossingPoint(targetCoords, Q, A, distM) {
        const c = (targetCoords || []).map(asLonLat);
        if (c.length < 2 || !Q || !A) return null;

        let vi = -1;
        let vd = Infinity;
        for (let i = 1; i < c.length - 1; i++) {
            if (!c[i]) continue;
            const d = distanceM(c[i], Q);
            if (d < vd) {
                vd = d;
                vi = i;
            }
        }
        if (vi < 0 || vd > 1.0) return null; // Q is inside a leg: normal method is fine

        const V = c[vi];
        const m = metersPerDegree(V[1]);
        const candidates = [];
        for (const j of [vi - 1, vi + 1]) {
            const W = c[j];
            if (!W) continue;
            const leg = distanceM(V, W);
            if (leg < 0.8) continue;
            const t = Math.min(0.3, leg / 3) / leg;
            candidates.push([V[0] + (W[0] - V[0]) * t, V[1] + (W[1] - V[1]) * t]);
        }

        for (const Qc of candidates) {
            const dir = [(Qc[0] - A[0]) * m.x, (Qc[1] - A[1]) * m.y];
            const l = Math.hypot(dir[0], dir[1]);
            if (l < 0.05) continue;
            const Pout = [Qc[0] + dir[0] / l * distM / m.x, Qc[1] + dir[1] / l * distM / m.y];

            let hits = 0;
            let clean = true;
            for (let i = 0; i < c.length - 1; i++) {
                if (!c[i] || !c[i + 1]) continue;
                const hit = findLineIntersectionPoint(A, Pout, c[i], c[i + 1]);
                if (!hit) continue;
                hits++;
                const dEnd = Math.min(distanceM(hit.coordinates, c[i]), distanceM(hit.coordinates, c[i + 1]));
                if (dEnd < 0.15) clean = false;
            }
            if (hits === 1 && clean) return Pout;
        }

        return null;
    }

    // The shortest segment (of the candidates) that ends at endPoint and
    // is short enough to be a helper stub.
    function findStubSegment(candidateIds, endPoint) {
        const ids = Array.isArray(candidateIds) && candidateIds.length
            ? candidateIds
            : allSegments().map(s => s?.id);

        let best = null;
        for (const raw of ids) {
            const seg = liveSegment(raw);
            const c = seg?.geometry?.coordinates;
            if (!c || c.length < 2) continue;

            const dEnd = Math.min(distanceM(endPoint, c[0]), distanceM(endPoint, c[c.length - 1]));
            if (dEnd > 0.5) continue;

            const length = lineLengthM(c);
            if (length > TOPO.OVERSHOOT_M * 3 + 1) continue;

            if (!best || length < best.length) best = { id: Number(seg.id), length };
        }
        return best ? best.id : null;
    }

    // Makes the T. ep = { segmentId, nodeId, atStart, owner } is the road
    // end, P its position, coords the geometry of its segment, target the
    // road it ends on, near = nearestPointOnLine(P, target coordinates).
    // On failure the end is moved back to where it was.
    function connectEndpointByOvershoot(ep, P, coords, target, near, memo) {
        const nodes = sdk?.DataModel?.Nodes;
        const segments = wmeSegments();
        if (typeof nodes?.moveNode !== 'function') return { ok: false, reason: 'Nodes.moveNode() is unavailable.' };

        const tc = target.geometry.coordinates;
        const b0 = asLonLat(tc[near.segIndex]);
        const b1 = asLonLat(tc[near.segIndex + 1]);
        const A = asLonLat(ep.atStart ? coords[1] : coords[coords.length - 2]);
        const Q = near.coordinates;
        if (!b0 || !b1 || !A || !Q) return { ok: false, reason: 'Missing geometry.' };

        const m = metersPerDegree(Q[1]);
        const dx = (b1[0] - b0[0]) * m.x;
        const dy = (b1[1] - b0[1]) * m.y;
        const len = Math.hypot(dx, dy);
        if (len < 0.05) return { ok: false, reason: 'Degenerate target geometry.' };

        const nx = -dy / len;
        const ny = dx / len;
        const sideOf = pt => (pt[0] - Q[0]) * m.x * nx + (pt[1] - Q[1]) * m.y * ny;

        // Push the end to the side opposite the rest of the road so the last
        // leg really crosses the target.
        let outward;
        const sideA = sideOf(A);
        if (Math.abs(sideA) >= 0.2) {
            outward = -Math.sign(sideA);
        } else {
            const travel = (P[0] - A[0]) * m.x * nx + (P[1] - A[1]) * m.y * ny;
            if (Math.abs(travel) < 0.05) return { ok: false, reason: 'Road runs parallel to the target at its end.' };
            outward = Math.sign(travel);
        }

        // If the junction point is on (or within 1 m of) a bend vertex of
        // the target, cross NEXT to that vertex (offsetCrossingPoint). A
        // plain perpendicular push can hit the wrong leg of the bend and
        // leave a second node right next to the junction.
        const Pout = offsetCrossingPoint(tc, Q, A, TOPO.OVERSHOOT_M) || [
            Q[0] + outward * nx * TOPO.OVERSHOOT_M / m.x,
            Q[1] + outward * ny * TOPO.OVERSHOOT_M / m.y
        ];

        const moveTo = pt => nodes.moveNode({ id: ep.nodeId, geometry: { type: 'Point', coordinates: pt } });

        try {
            moveTo(Pout);
        } catch (error) {
            return { ok: false, reason: `moveNode failed: ${error?.message || error}` };
        }

        const movedSeg = liveSegment(ep.segmentId);
        const liveTarget = liveSegment(target.id);
        if (!movedSeg || !liveTarget) {
            try { moveTo(P); } catch (e) { /* ignore */ }
            return { ok: false, reason: 'Segments disappeared after moving the endpoint.' };
        }

        const targetOwner = findCreatedOwner(target.id);
        const result = addIntersectionPreservingRoadTypes(
            ep.segmentId, Number(target.id), Number(movedSeg.roadType), Number(liveTarget.roadType)
        );

        if (!result.ok) {
            try { moveTo(P); } catch (e) { /* ignore */ }
            return { ok: false, reason: result.reason };
        }

        if (targetOwner) replaceCreatedSegmentId(targetOwner.value, Number(target.id), result.targetSplits);

        // 3.8.7 (temporary diagnostics): at a few T-junctions the new node
        // ends up not listing the road that was just joined to it (the
        // "broken segment" that is deleted at the end of the build). The
        // per-step audit of 3.8.6 showed that it happens inside this very
        // step. This writes down, straight after addIntersection and before
        // the stub is deleted, what the SDK returned and what each piece is
        // attached to, but only when a piece is missing from an end node.
        {
            const pieces = [...(result.sourceSplits || []), ...(result.targetSplits || [])].map(Number);
            const facts = pieces.map(pid => {
                const s = liveSegment(pid);
                const ends = [true, false].map(atStart => {
                    const nid = segmentEndNodeId(s, atStart);
                    return `${nid}${getNodeConnectedSegmentIds(nid).includes(pid) ? '' : '(NOT LISTED)'}`;
                });
                return `${pid}[${ends.join(' -> ')}, ${lineLengthM(s?.geometry?.coordinates).toFixed(1)}m]`;
            });
            if (facts.some(fact => fact.includes('NOT LISTED'))) {
                const fmt = list => (list || []).map(asLonLat).filter(Boolean).slice(0, 8)
                    .map(p => `${p[1].toFixed(7)},${p[0].toFixed(7)}`).join(' ; ');
                runLog.add(`  T-DEBUG source ${ep.segmentId} (${ep.atStart ? 'start' : 'end'} moved) x target ${target.id}`);
                runLog.add(`    source splits: ${(result.sourceSplits || []).join(', ')} | target splits: ${(result.targetSplits || []).join(', ')}`);
                runLog.add(`    pieces: ${facts.join(' | ')}`);
                runLog.add(`    end was at ${fmtPoint(P)}, pushed to ${Pout[1].toFixed(7)},${Pout[0].toFixed(7)}, previous point ${fmtPoint(A)}, nearest on target ${fmtPoint(Q)}`);
                runLog.add(`    source shape before: ${fmt(coords)}`);
                runLog.add(`    target shape before: ${fmt(tc)}`);
                const nodesSeen = new Set(pieces.flatMap(pid =>
                    [true, false].map(atStart => segmentEndNodeId(liveSegment(pid), atStart))));
                for (const nid of nodesSeen) {
                    runLog.add(`    node ${nid} lists: ${getNodeConnectedSegmentIds(nid).join(', ') || 'nothing'}`);
                }
            }
        }

        let warning = result.restoreFailures?.length
            ? `Road type restore failed: ${result.restoreFailures.join(' | ')}`
            : null;

        const stubId = findStubSegment(result.sourceSplits, Pout);
        if (stubId != null) {
            try {
                segments.deleteSegment({ segmentId: stubId });
            } catch (error) {
                warning = `Stub segment ${stubId} could not be deleted (${error?.message || error}). Delete it manually.`;
                const stub = liveSegment(stubId);
                for (const s of [true, false]) {
                    const n = segmentEndNodeId(stub, s);
                    if (n != null) memo.skipNodes.add(n);
                }
            }
        } else {
            warning = `Junction created for ${ep.segmentId}, but the ${TOPO.OVERSHOOT_M} m stub was not found. Check it manually.`;
        }

        if (ep.owner) {
            const kept = (result.sourceSplits || []).map(Number).filter(id => id !== stubId);
            replaceCreatedSegmentId(ep.owner, ep.segmentId, kept);
        }

        log('T-junction created:', { segment: ep.segmentId, target: target.id, stubId });
        return { ok: true, warning };
    }

    /* ---------------- 7e. end-to-end joins ----------------
       Two road ENDS that must share a node. The SDK has no method that
       merges two nodes, so when the target end is a dead end we:
         1. bend the free end so its last leg crosses the target road
            JOIN.TRIM_M metres before the target's end;
         2. addIntersection -> one real junction node;
         3. delete the small helper stub and the target's old end piece;
         4. remove the helper bend.
       This is needed rarely, because 7a draws roads THROUGH junctions.
       It is used as a retry by batchTee, and by the existing-roads code
       in 7h (off by default).                                          */

    function getInternalMergeNodeActions() {
        const page = unsafeWindow || window;
        const W = page?.W;
        const actionManager = W?.model?.actionManager;
        if (!actionManager || typeof actionManager.add !== 'function') return null;

        let MoveAndMergeNode = W?.Action?.MoveAndMergeNode;
        let MergeNode = W?.Action?.MergeNode;

        if (typeof MoveAndMergeNode !== 'function' && typeof page?.require === 'function') {
            try { MoveAndMergeNode = page.require('Waze/Action/MoveAndMergeNode'); } catch (e) { /* n/a */ }
        }
        if (typeof MergeNode !== 'function' && typeof page?.require === 'function') {
            try { MergeNode = page.require('Waze/Action/MergeNode'); } catch (e) { /* n/a */ }
        }

        const wmeNodes = W?.model?.nodes;
        if (!wmeNodes || typeof wmeNodes.get !== 'function') return null;

        return { actionManager, MoveAndMergeNode, MergeNode, wmeNodes };
    }

    // Same as dragging one node onto another in WME. Target node stays put.
    // OFF by default (USE_INTERNAL_WME_ACTIONS, decision D2): with the
    // switch off this always answers "not merged" and the callers fall
    // back to the SDK-only method below.
    function mergeNodesUsingWmeAction(sourceNodeId, targetNodeId) {
        if (Number(sourceNodeId) === Number(targetNodeId)) return { ok: true, merged: false };
        if (!USE_INTERNAL_WME_ACTIONS) {
            return { ok: false, reason: 'Internal WME node merge is disabled (SDK-only mode).' };
        }

        const actions = getInternalMergeNodeActions();
        if (!actions) return { ok: false, reason: 'WME node merge actions are unavailable.' };

        const source = actions.wmeNodes.get(Number(sourceNodeId));
        const target = actions.wmeNodes.get(Number(targetNodeId));
        if (!source || !target) return { ok: false, reason: 'Could not resolve internal WME nodes for merge.' };

        if (typeof actions.MoveAndMergeNode === 'function') {
            try {
                actions.actionManager.add(new actions.MoveAndMergeNode(source, target));
                if (!actions.wmeNodes.get(Number(sourceNodeId))) {
                    return { ok: true, merged: true, method: 'MOVE_AND_MERGE_NODE' };
                }
                const targetAfter = actions.wmeNodes.get(Number(targetNodeId));
                const targetSegIds = (targetAfter?.segIDs || targetAfter?.connectedSegmentIds || [])
                    .map(Number).filter(Number.isFinite);
                const sourceSegIds = (source?.segIDs || []).map(Number).filter(Number.isFinite);
                if (targetSegIds.length && sourceSegIds.every(id => targetSegIds.includes(id))) {
                    return { ok: true, merged: true, method: 'MOVE_AND_MERGE_NODE' };
                }
            } catch (error) {
                log('MOVE_AND_MERGE_NODE failed:', error);
            }
        }

        if (typeof actions.MergeNode === 'function') {
            try {
                const targetPoint = getNodeById(targetNodeId)?.geometry;
                if (targetPoint && typeof sdk?.DataModel?.Nodes?.moveNode === 'function') {
                    sdk.DataModel.Nodes.moveNode({ id: Number(sourceNodeId), geometry: targetPoint });
                }
                actions.actionManager.add(new actions.MergeNode(source, target));
                if (!actions.wmeNodes.get(Number(sourceNodeId))) {
                    return { ok: true, merged: true, method: 'MERGE_NODE' };
                }
            } catch (error) {
                log('MERGE_NODE fallback failed:', error);
            }
        }

        return { ok: false, reason: 'WME MoveAndMergeNode/MergeNode did not merge the nodes.' };
    }

    // Joins the road end `ep` to the END of the target segment, with SDK
    // calls only (bend + cross + trim, see the note above).
    function connectEndpointToTargetEnd(ep, P, coords, target, targetAtStart, memo) {
        const nodes = sdk?.DataModel?.Nodes;
        const segments = wmeSegments();
        if (typeof nodes?.moveNode !== 'function' || typeof segments?.updateSegment !== 'function') {
            return { ok: false, reason: 'Nodes.moveNode()/updateSegment() unavailable.' };
        }

        const liveTarget = liveSegment(target?.id);
        const tc = liveTarget?.geometry?.coordinates || [];
        if (tc.length < 2) return { ok: false, reason: 'Target geometry missing.' };

        const targetLength = lineLengthM(tc);
        if (targetLength < JOIN.TRIM_M + 1.5) {
            return { ok: false, reason: `Target segment is only ${targetLength.toFixed(1)} m long.` };
        }

        const targetEndNode = segmentEndNodeId(liveTarget, targetAtStart);
        const endDegree = getNodeConnectedSegmentIds(targetEndNode).length;

        // The target end is not a dead end: it is a node shared with other
        // roads. Cutting 2 m off would leave a tiny segment next to it, so
        // use the "merge the two pieces, then cross through the old node"
        // method instead (or report it for manual connection).
        if (endDegree >= 2) {
            return joinThroughPassNode(ep, P, coords, targetEndNode, memo);
        }
        const targetEndPoint = asLonLat(targetAtStart ? tc[0] : tc[tc.length - 1]);

        const cut = pointAlongLineFromEnd(tc, targetAtStart, JOIN.TRIM_M);
        if (!cut) return { ok: false, reason: 'Could not find a cut point on the target.' };

        const Q = cut.coordinates;
        const b0 = asLonLat(tc[cut.segIndex]);
        const b1 = asLonLat(tc[cut.segIndex + 1]);
        const A = asLonLat(ep.atStart ? coords[1] : coords[coords.length - 2]);
        if (!b0 || !b1 || !A || !P) return { ok: false, reason: 'Missing geometry.' };

        const m = metersPerDegree(Q[1]);
        const dx = (b1[0] - b0[0]) * m.x;
        const dy = (b1[1] - b0[1]) * m.y;
        const len = Math.hypot(dx, dy);
        if (len < 0.05) return { ok: false, reason: 'Degenerate target geometry.' };
        const nx = -dy / len;
        const ny = dx / len;

        // K = helper bend on the same side as the rest of the road,
        // X = new end on the other side, so K -> X crosses the target at Q.
        const sideA = (A[0] - Q[0]) * m.x * nx + (A[1] - Q[1]) * m.y * ny;
        const sign = Math.abs(sideA) >= 0.2 ? Math.sign(sideA) : 1;
        const offset = TOPO.OVERSHOOT_M;
        const K = [Q[0] + sign * nx * offset / m.x, Q[1] + sign * ny * offset / m.y];
        const X = [Q[0] - sign * nx * offset / m.x, Q[1] - sign * ny * offset / m.y];

        const original = coords.map(c => [Number(c[0]), Number(c[1])]);
        const moveTo = pt => nodes.moveNode({ id: ep.nodeId, geometry: { type: 'Point', coordinates: pt } });
        const restore = () => {
            try { moveTo(P); } catch (e) { /* ignore */ }
            try {
                segments.updateSegment({
                    segmentId: ep.segmentId,
                    geometry: { type: 'LineString', coordinates: original }
                });
            } catch (e) { /* ignore */ }
        };

        try {
            moveTo(X);
            const moved = (liveSegment(ep.segmentId)?.geometry?.coordinates || [])
                .map(c => [Number(c[0]), Number(c[1])]);
            if (moved.length < 2) throw new Error('Segment geometry missing after move.');
            if (ep.atStart) moved.splice(1, 0, K);
            else moved.splice(moved.length - 1, 0, K);
            segments.updateSegment({
                segmentId: ep.segmentId,
                geometry: { type: 'LineString', coordinates: moved }
            });
        } catch (error) {
            restore();
            return { ok: false, reason: `Could not bend the road end: ${error?.message || error}` };
        }

        const sourceSeg = liveSegment(ep.segmentId);
        const targetOwner = findCreatedOwner(liveTarget.id);
        const result = addIntersectionPreservingRoadTypes(
            ep.segmentId,
            Number(liveTarget.id),
            Number(sourceSeg?.roadType),
            Number(liveTarget.roadType)
        );

        if (!result.ok) {
            restore();
            return { ok: false, reason: result.reason };
        }

        if (targetOwner) {
            replaceCreatedSegmentId(targetOwner.value, Number(liveTarget.id), result.targetSplits);
        }

        const notes = [];
        if (result.restoreFailures?.length) {
            notes.push(`Road type restore failed: ${result.restoreFailures.join(' | ')}`);
        }

        // 1) helper stub of the source road beyond the junction
        const stubId = findStubSegment(result.sourceSplits, X);
        if (stubId != null) {
            try {
                segments.deleteSegment({ segmentId: stubId });
            } catch (error) {
                notes.push(`Helper stub ${stubId} could not be deleted; delete it manually.`);
                const stub = liveSegment(stubId);
                for (const s of [true, false]) {
                    const n = segmentEndNodeId(stub, s);
                    if (n != null) memo?.skipNodes?.add(n);
                }
            }
        }

        const kept = (result.sourceSplits || []).map(Number).filter(id => id !== stubId);
        if (ep.owner) replaceCreatedSegmentId(ep.owner, ep.segmentId, kept);

        // 2) the target's old end piece (junction -> old end node)
        const endPiece = findStubSegment(result.targetSplits, targetEndPoint);
        if (endPiece != null) {
            if (endDegree <= 1) {
                try {
                    segments.deleteSegment({ segmentId: endPiece });
                    if (targetOwner) removeCreatedSegmentId(targetOwner.value, endPiece);
                    else notes.push(`Existing road ${liveTarget.id} was shortened by ${JOIN.TRIM_M} m to create the junction.`);
                } catch (error) {
                    notes.push(`End piece ${endPiece} could not be deleted: ${error?.message || error}`);
                }
            } else {
                const others = getNodeConnectedSegmentIds(targetEndNode).filter(id => id !== endPiece);
                let merged = false;
                if (others.length === 1 && typeof segments.mergeSegments === 'function') {
                    try {
                        segments.mergeSegments({ segmentIds: [endPiece, others[0]] });
                        merged = true;
                    } catch (e) { /* keep the short piece */ }
                }
                if (!merged) {
                    notes.push(`A ${JOIN.TRIM_M} m segment (#${endPiece}) was left next to node ${targetEndNode}; fix it manually.`);
                }
            }
        }

        // 3) remove the helper bend K from the kept road
        for (const id of kept) {
            const seg = liveSegment(id);
            const c = (seg?.geometry?.coordinates || []).map(p => [Number(p[0]), Number(p[1])]);
            const k = c.findIndex((p, index) => index > 0 && index < c.length - 1 && distanceM(p, K) < 0.3);
            if (k > 0) {
                c.splice(k, 1);
                try {
                    segments.updateSegment({ segmentId: id, geometry: { type: 'LineString', coordinates: c } });
                } catch (e) { /* cosmetic only */ }
            }
        }

        log('End-to-end junction created:', { segment: ep.segmentId, target: liveTarget.id, stubId, endPiece });
        return { ok: true, warning: notes.length ? notes.join(' ') : null };
    }

    // A road end must join a node that already connects other segments.
    // The idea, for a node joining exactly two segments (a plain "pass"
    // node on a through road):
    //   1. mergeSegments() the two pieces -> the node becomes an ordinary
    //      geometry point of one segment;
    //   2. cross the road end straight through that point with
    //      addIntersection -> a real junction exactly where the node was.
    // OFF by default (BATCH.ALLOW_MERGE_JOIN, decision D5): with the
    // switch off, and always for nodes joining three or more roads, this
    // only reports the place for manual connection.
    function joinThroughPassNode(ep, P, coords, targetEndNode, memo) {
        const segments = wmeSegments();
        const connected = getNodeConnectedSegmentIds(targetEndNode);
        const where = fmtPoint(getNodeById(targetEndNode)?.geometry?.coordinates);

        // The merge-then-split trick corrupted node links in testing
        // (audit: "node does not list segment"), so it is disabled. Such
        // ends are reported for manual connection instead.
        if (!BATCH.ALLOW_MERGE_JOIN || connected.length !== 2) {
            return {
                ok: false,
                manual: true,
                reason: `Node ${targetEndNode} at ${where} already joins ${connected.length} roads; ` +
                    'connect it manually (drag the road end onto the node).'
            };
        }
        if (typeof segments?.mergeSegments !== 'function') {
            return { ok: false, reason: 'Segments.mergeSegments() is unavailable.' };
        }

        const nodePoint = asLonLat(getNodeById(targetEndNode)?.geometry?.coordinates);
        const [idA, idB] = connected;
        const farEnd = seg => {
            const c = seg?.geometry?.coordinates || [];
            if (c.length < 2 || !nodePoint) return null;
            return distanceM(c[0], nodePoint) <= distanceM(c[c.length - 1], nodePoint)
                ? asLonLat(c[c.length - 1])
                : asLonLat(c[0]);
        };
        const farA = farEnd(liveSegment(idA));
        const farB = farEnd(liveSegment(idB));
        if (!nodePoint || !farA || !farB) return { ok: false, reason: 'Geometry missing around the node.' };

        const ownerA = findCreatedOwner(idA);
        const ownerB = findCreatedOwner(idB);

        try {
            segments.mergeSegments({ segmentIds: [idA, idB] });
        } catch (error) {
            return {
                ok: false,
                reason: `Node ${targetEndNode} could not be removed (${error?.message || error}). Connect it manually.`
            };
        }

        const merged = allSegments().find(s => {
            const c = s?.geometry?.coordinates || [];
            if (c.length < 3) return false;
            const a = c[0];
            const b = c[c.length - 1];
            return (distanceM(a, farA) < 0.5 && distanceM(b, farB) < 0.5) ||
                (distanceM(a, farB) < 0.5 && distanceM(b, farA) < 0.5);
        });
        if (!merged) return { ok: false, reason: 'Merged segment could not be found.' };

        const mergedId = Number(merged.id);
        if (ownerA) replaceCreatedSegmentId(ownerA.value, idA, [mergedId]);
        if (ownerB) {
            if (ownerA && ownerB.value === ownerA.value) removeCreatedSegmentId(ownerB.value, idB);
            else replaceCreatedSegmentId(ownerB.value, idB, [mergedId]);
        }

        const near = nearestPointOnLine(P, merged.geometry.coordinates);
        const r = near
            ? connectEndpointByOvershoot(ep, P, coords, merged, near, memo)
            : { ok: false, reason: 'No crossing point.' };

        if (!r.ok) {
            // put the node back so nothing is left half-done
            try {
                const result = segments.splitSegment({
                    segmentId: mergedId,
                    splitPoint: { type: 'Point', coordinates: nodePoint }
                });
                const ids = (Array.isArray(result) ? result : [])
                    .map(x => (x && typeof x === 'object' ? x.id : x))
                    .map(Number)
                    .filter(Number.isFinite);
                const owner = ownerA || ownerB;
                if (owner && ids.length) replaceCreatedSegmentId(owner.value, mergedId, ids);
            } catch (e) { /* ignore */ }
            return { ok: false, reason: `Crossing through node ${targetEndNode} failed: ${r.reason}` };
        }

        log('Joined through pass node:', { node: targetEndNode, segment: ep.segmentId, merged: mergedId });
        return { ok: true, warning: r.warning || null };
    }

    /* ---------------- 7f. loops and lines joined at both ends ---------------- */

    // Splits whichever segment of this owner runs through the point at
    // `distance` metres along `line`. Stays off shape points, where WME
    // can refuse a split.
    function splitOwnerAlong(owner, line, distance) {
        for (const nudge of [0, 1, -1, 2, -2]) {
            const at = pointAlongLineFromEnd(line, true, distance + nudge)?.coordinates;
            if (!at || line.some(vertex => distanceM(vertex, at) < 0.5)) continue;

            let host = null;
            for (const raw of owner?.segmentIds || []) {
                const c = liveSegment(raw)?.geometry?.coordinates;
                if (!c || c.length < 2) continue;
                const near = nearestPointOnLine(at, c);
                if (near && near.distance < 0.3 && Math.min(near.distToStart, near.distToEnd) > 1) {
                    host = Number(raw);
                    break;
                }
            }
            if (host != null && splitCreatedSegment(host, at)) return true;
        }
        return false;
    }

    // A drawn line can come back to its own end (a block road, a "6"
    // shape). Its end then has to join the middle of the SAME segment,
    // which WME cannot do. Cut the loop part into three first: then the
    // end and the middle are different segments, they can be joined, and
    // the loop has the three segments WME wants. (decision D9)
    function splitLoopBeforeSelfJunction(owner, point, stats) {
        const end = findOwnerSegmentEndingAt(owner, point);
        const pass = findOwnerSegmentThrough(owner, point);
        if (!end || !pass || end.id !== pass.id) return; // already separate segments

        const coords = pass.segment.geometry.coordinates.map(p => [Number(p[0]), Number(p[1])]);
        const k = pass.vertexIndex;
        // the loop, starting at the end that sits on `point`
        const loop = end.atStart ? coords.slice(0, k + 1) : coords.slice(k).reverse();
        const loopLength = lineLengthM(loop);

        if (loopLength < MIN_LOOP_M) {
            stats.warnings.push(`Loop at ${fmtPoint(point)} is only ${loopLength.toFixed(0)} m long and was left unjoined. Join it by hand.`);
            return;
        }

        let cuts = 0;
        for (const share of [1 / 3, 2 / 3]) {
            if (splitOwnerAlong(owner, loop, loopLength * share)) cuts++;
        }

        stats.loopSplits = (stats.loopSplits || 0) + cuts;
        if (cuts === 2) {
            runLog.ok(`Loop at ${fmtPoint(point)} (${loopLength.toFixed(0)} m) cut into three segments before joining its end`);
        } else {
            stats.warnings.push(`Loop at ${fmtPoint(point)}: only ${cuts} of 2 cuts worked. Check the junction there.`);
        }
    }

    // A line that ends on other lines at BOTH ends gets a node in its
    // middle before any junction is made, so each half is joined at one
    // end only. Joined at both ends as ONE segment, the second junction
    // left the node of the first one without a link to the road, and the
    // road had to be deleted. (3.7.0 run: the one line joined that way was
    // the one that broke; a line cut in the middle first was fine.)
    // (decision D8)
    function splitLinesJoinedAtBothEnds(network, stats) {
        const { strokes, edges } = network;

        const passed = new Set(); // OSM nodes that some line runs through
        for (const stroke of strokes) {
            if (!stroke.owner) continue;
            stroke.list.forEach((item, k) => {
                if (k === stroke.list.length - 1) return;
                const edge = edges[item.edge];
                passed.add(item.reversed ? edge.from : edge.to);
            });
        }

        for (const stroke of strokes) {
            if (!stroke.owner) continue;
            const seq = stroke.nodeSeq;
            if (!passed.has(seq[0]) || !passed.has(seq[seq.length - 1])) continue;

            const id = stroke.owner.segmentIds[0];
            const coords = segmentCoords(id);
            if (coords.length < 2) continue;

            const at = lineLengthM(coords) >= MIN_SEPARATE_GAP_M
                ? splitBetween(id, coords, coords[0], coords[coords.length - 1])
                : null;

            if (at) {
                stats.loopSplits = (stats.loopSplits || 0) + 1;
                runLog.ok(`Line ${stroke.index + 1} ends on other roads at both ends: node added in its middle at ${fmtPoint(at)}`);
            } else {
                stats.warnings.push(
                    `Line ${stroke.index + 1} ends on other roads at both ends and could not get a node in its middle. Check it after the build.`
                );
            }
        }
    }

    // Two new segments that join the same two nodes form a two-segment
    // loop, which routing cannot tell apart. Give the longer one a node
    // in the middle. (decision D9)
    function fixTwoSegmentLoops(stats) {
        const failed = new Set();

        for (let pass = 0; pass < 60; pass++) {
            const seen = new Map();
            let fixed = false;

            for (const id of getCreatedSegmentIdSet()) {
                const seg = liveSegment(id);
                const from = segmentEndNodeId(seg, true);
                const to = segmentEndNodeId(seg, false);
                if (!seg || from == null || to == null || from === to) continue;

                const key = from < to ? `${from}|${to}` : `${to}|${from}`;
                if (failed.has(key)) continue;

                const otherId = seen.get(key);
                if (otherId == null) {
                    seen.set(key, id);
                    continue;
                }

                const other = liveSegment(otherId);
                const lengthA = lineLengthM(other?.geometry?.coordinates);
                const lengthB = lineLengthM(seg.geometry?.coordinates);
                const pick = lengthA >= lengthB ? other : seg;
                const coords = (pick?.geometry?.coordinates || []).map(p => [Number(p[0]), Number(p[1])]);
                const length = Math.max(lengthA, lengthB);

                let done = false;
                if (coords.length >= 2 && length >= 6) {
                    for (const nudge of [0, 1, -1, 2, -2]) {
                        const at = pointAlongLineFromEnd(coords, true, length / 2 + nudge)?.coordinates;
                        if (!at || coords.some(vertex => distanceM(vertex, at) < 0.5)) continue;
                        if (splitCreatedSegment(Number(pick.id), at)) {
                            done = true;
                            runLog.ok(`Two-segment loop ${otherId} / ${id}: node added in the middle of ${pick.id} at ${fmtPoint(at)}`);
                            break;
                        }
                    }
                }

                if (done) {
                    stats.loopSplits = (stats.loopSplits || 0) + 1;
                    fixed = true;
                    break; // ids changed: look again from the start
                }

                failed.add(key);
                stats.warnings.push(
                    `WME ${otherId} and ${id} join the same two nodes (a two-segment loop) and could not be split. Add a node to one of them by hand.`
                );
            }

            if (!fixed) break;
        }
    }

    /* ---------------- 7g. the junction pass ---------------- */

    // X: two lines pass through `point`. First make sure the two segments
    // do not also meet somewhere else (7b), then addIntersection.
    function batchCross(ownerA, ownerB, point, stats) {
        const ready = separateBeforeJunction(
            () => findOwnerSegmentThrough(ownerA, point),
            () => findOwnerSegmentThrough(ownerB, point),
            point,
            stats
        );
        if (!ready) return;

        const segments = wmeSegments();
        const a = findOwnerSegmentThrough(ownerA, point);
        const b = findOwnerSegmentThrough(ownerB, point);
        if (!a || !b) {
            stats.warnings.push(`A crossing at ${fmtPoint(point)} could not be located.`);
            return;
        }

        const attempt = () => addIntersectionPreservingRoadTypes(
            a.id,
            b.id,
            Number(liveSegment(a.id)?.roadType),
            Number(liveSegment(b.id)?.roadType)
        );

        let r = attempt();

        // Both lines share the exact same shape point, which WME cannot use
        // as a split point. Nudge B's point 0.3 m sideways (B still goes from
        // one side of A to the other, so it still crosses A once). As a last
        // resort remove B's point; restore B if nothing works.
        if (!r.ok) {
            const original = (liveSegment(b.id)?.geometry?.coordinates || []).map(p => [Number(p[0]), Number(p[1])]);
            const k = original.findIndex((p, i) =>
                i > 0 && i < original.length - 1 && distanceM(p, point) <= BATCH.POINT_EPS_M
            );

            if (k > 0) {
                const prev = original[k - 1];
                const next = original[k + 1];
                const V = original[k];
                const m = metersPerDegree(V[1]);
                const chord = [(next[0] - prev[0]) * m.x, (next[1] - prev[1]) * m.y];
                const cl = Math.hypot(chord[0], chord[1]) || 1;
                const offsets = [
                    [-chord[1] / cl, chord[0] / cl],
                    [chord[1] / cl, -chord[0] / cl]
                ];

                const tryGeometry = coords => {
                    try {
                        segments.updateSegment({ segmentId: b.id, geometry: { type: 'LineString', coordinates: coords } });
                        return attempt();
                    } catch (error) {
                        return { ok: false, reason: error?.message || String(error) };
                    }
                };

                for (const o of offsets) {
                    const shifted = original.map(p => p.slice());
                    shifted[k] = [V[0] + o[0] * 0.3 / m.x, V[1] + o[1] * 0.3 / m.y];
                    r = tryGeometry(shifted);
                    if (r.ok) break;
                }

                if (!r.ok) r = tryGeometry(original.filter((_, i) => i !== k));

                if (!r.ok) {
                    try {
                        segments.updateSegment({ segmentId: b.id, geometry: { type: 'LineString', coordinates: original } });
                    } catch (e) { /* ignore */ }
                }
            }
        }

        if (!r.ok) {
            stats.warnings.push(`Crossing ${a.id}/${b.id} at ${fmtPoint(point)}: ${r.reason}`);
            return;
        }

        replaceCreatedSegmentId(ownerA, a.id, r.sourceSplits);
        replaceCreatedSegmentId(ownerB, b.id, r.targetSplits);

        // 3.9.2: write the shape of the four pieces back once.
        // When two lines cross on a shape point they share, WME puts the new
        // node a few centimetres away from that point (node positions are
        // rounded), and one piece of each road keeps the old point right
        // beside its new end. The SDK does not show that point for an
        // unsaved segment (in the rounded shape it hands out, the point and
        // the node are the same place), so neither the clean-up nor the
        // checks could see it. The server can: two roads that share a point
        // which is not a node, and the save answered with warning 2006,
        // "Intersecting segments with the same elevation". Seen after a
        // save: shape ...; 30.9162091,30.2993288 ; 30.9162090,30.2993290.
        // Writing back the shape the SDK shows drops the hidden point;
        // wmeSegments() puts the two ends exactly on their nodes (Section 4).
        // A piece that an end node does not list is left alone (see
        // cleanCreatedGeometry, Section 8, for why).
        for (const pieceId of [...r.sourceSplits, ...r.targetSplits]) {
            const piece = liveSegment(pieceId);
            const shape = segmentCoords(pieceId);
            if (!piece || shape.length < 2) continue;
            if (![true, false].every(atStart =>
                getNodeConnectedSegmentIds(segmentEndNodeId(piece, atStart)).includes(Number(pieceId)))) continue;
            try {
                segments.updateSegment({ segmentId: pieceId, geometry: { type: 'LineString', coordinates: shape } });
            } catch (error) {
                log('Rewriting the shape after a crossing failed:', pieceId, error);
            }
        }
        stats.crossings++;
        runLog.ok(`X crossing ${a.id} x ${b.id} at ${fmtPoint(point)} -> ${[...r.sourceSplits, ...r.targetSplits].join(',')}`);
    }

    // T: a line of endOwner ENDS at `point`, where a line of passOwner
    // passes through.
    //   * If it ends on itself (same owner), cut the loop first (7f).
    //   * If the two segments also meet somewhere else, separate them
    //     first (7b).
    //   * Then overshoot (7d); if that fails next to a node, retry as an
    //     end-to-end join (7e).
    function batchTee(endOwner, passOwner, point, stats, memo) {
        if (endOwner && endOwner === passOwner) splitLoopBeforeSelfJunction(endOwner, point, stats);
        const ready = separateBeforeJunction(
            () => findOwnerSegmentEndingAt(endOwner, point),
            () => findOwnerSegmentThrough(passOwner, point),
            point,
            stats
        );
        if (!ready) return;

        const end = findOwnerSegmentEndingAt(endOwner, point);
        if (!end) {
            // diagnostic: how far is the nearest end of this line from the node?
            let nearest = Infinity;
            for (const raw of endOwner?.segmentIds || []) {
                const c = liveSegment(raw)?.geometry?.coordinates;
                if (!c || c.length < 2) continue;
                nearest = Math.min(nearest, distanceM(c[0], point), distanceM(c[c.length - 1], point));
            }
            stats.warnings.push(
                `T-junction end at ${fmtPoint(point)} could not be located (nearest end of that line is ${Number.isFinite(nearest) ? nearest.toFixed(1) + ' m' : 'unknown'}). Connect manually.`
            );
            return;
        }

        const coords = end.segment.geometry.coordinates;
        const P = asLonLat(end.atStart ? coords[0] : coords[coords.length - 1]);
        const ep = {
            segmentId: end.id,
            nodeId: segmentEndNodeId(end.segment, end.atStart),
            atStart: end.atStart,
            owner: endOwner
        };

        const pass = findOwnerSegmentThrough(passOwner, point);

        if (pass) {
            const near = nearestPointOnLine(P, pass.segment.geometry.coordinates);
            const r = connectEndpointByOvershoot(ep, P, coords, pass.segment, near, memo);
            if (r.ok) {
                stats.tees++;
                runLog.ok(`T junction ${end.id} -> ${pass.id} at ${fmtPoint(point)}${r.warning ? ` (${r.warning})` : ''}`);
                if (r.warning) stats.warnings.push(r.warning);
                return;
            }
            runLog.fail(`T junction ${end.id} -> ${pass.id} at ${fmtPoint(point)}: ${r.reason}`);

            // e.g. "splitNode is null": the crossing fell on / next to a node
            // at the end of the through road. Retry as a node join.
            const passNow = liveSegment(pass.id);
            const pc = passNow?.geometry?.coordinates || [];
            if (pc.length >= 2) {
                const atStart = distanceM(pc[0], point) <= distanceM(pc[pc.length - 1], point);
                const endPoint = atStart ? pc[0] : pc[pc.length - 1];
                if (distanceM(endPoint, point) <= 3) {
                    const retry = connectEndpointToTargetEnd(ep, P, coords, passNow, atStart, memo);
                    if (retry.ok) {
                        stats.tees++;
                        runLog.ok(`T junction (retry as end join) ${end.id} -> ${pass.id} at ${fmtPoint(point)}`);
                        if (retry.warning) stats.warnings.push(retry.warning);
                        return;
                    }
                    runLog.fail(`T junction retry ${end.id} -> ${pass.id}: ${retry.reason}`);
                }
            }

            stats.warnings.push(`T-junction ${end.id} -> ${pass.id} at ${fmtPoint(point)}: ${r.reason}`);
            return;
        }

        // The through road is already split at this node: join node-to-node.
        const endHit = findOwnerSegmentEndingAt(passOwner, point, end.id);
        if (!endHit) {
            stats.warnings.push(`T-junction for ${end.id} at ${fmtPoint(point)} could not be located.`);
            return;
        }

        const merged = mergeNodesUsingWmeAction(ep.nodeId, segmentEndNodeId(endHit.segment, endHit.atStart));
        if (merged.ok) {
            stats.tees++;
            runLog.ok(`Node merge ${end.id} -> ${endHit.id} at ${fmtPoint(point)} (${merged.method})`);
            return;
        }

        const r = connectEndpointToTargetEnd(ep, P, coords, endHit.segment, endHit.atStart, memo);
        if (r.ok) {
            stats.tees++;
            runLog.ok(`End join ${end.id} -> ${endHit.id} at ${fmtPoint(point)}${r.warning ? ` (${r.warning})` : ''}`);
            if (r.warning) stats.warnings.push(r.warning);
        } else {
            stats.warnings.push(`Junction ${end.id} -> ${endHit.id} at ${fmtPoint(point)}: ${r.reason}`);
        }
    }

    // Cut a line at `point` because the road properties change there.
    function batchSplit(owner, point, stats) {
        const hit = findOwnerSegmentThrough(owner, point);
        if (!hit) return;

        // WME may refuse a split exactly on an existing geometry point;
        // retry 0.3 m further along the road.
        const c = hit.segment.geometry.coordinates;
        const V = asLonLat(c[hit.vertexIndex]);
        const next = asLonLat(c[hit.vertexIndex + 1]);
        const candidates = [point];
        if (V && next) {
            const leg = distanceM(V, next);
            if (leg > 0.8) {
                const t = 0.3 / leg;
                candidates.push([V[0] + (next[0] - V[0]) * t, V[1] + (next[1] - V[1]) * t]);
            }
        }

        let lastError = null;
        for (const splitAt of candidates) {
            try {
                const result = wmeSegments().splitSegment({
                    segmentId: hit.id,
                    splitPoint: { type: 'Point', coordinates: splitAt }
                });
                const ids = (Array.isArray(result) ? result : [])
                    .map(x => (x && typeof x === 'object' ? x.id : x))
                    .map(Number)
                    .filter(Number.isFinite);
                if (ids.length) replaceCreatedSegmentId(owner, hit.id, ids);
                stats.splits++;
                return;
            } catch (error) {
                lastError = error;
            }
        }

        stats.warnings.push(`Split ${hit.id}: ${lastError?.message || lastError}`);
    }

    // Goes over every OSM node where drawn lines meet and makes the
    // junction: all the X's first, then the T's, then the property splits.
    function runBatchJunctions(network, stats, memo) {
        const { strokes, edges, nodeCoord } = network;
        const passing = new Map(); // node id -> lines that run through it
        const ending = new Map();  // node id -> lines that end on it
        const push = (map, nid, value) => {
            if (!map.has(nid)) map.set(nid, []);
            map.get(nid).push(value);
        };

        for (const stroke of strokes) {
            if (!stroke.owner) continue;
            stroke.list.forEach((item, k) => {
                const edge = edges[item.edge];
                const entryNode = item.reversed ? edge.to : edge.from;
                const exitNode = item.reversed ? edge.from : edge.to;
                if (k === 0) push(ending, entryNode, { stroke });
                if (k === stroke.list.length - 1) push(ending, exitNode, { stroke });
                else push(passing, exitNode, { stroke, before: item, after: stroke.list[k + 1] });
            });
        }

        const nodeIds = new Set([...passing.keys(), ...ending.keys()]);

        // 1) X-crossings: two lines pass through the same OSM node
        for (const nid of nodeIds) {
            const pass = passing.get(nid) || [];
            if (pass.length < 2) continue;
            for (let i = 1; i < pass.length; i++) {
                if (pass[i].stroke === pass[0].stroke) continue;
                batchCross(pass[0].stroke.owner, pass[i].stroke.owner, nodeCoord.get(nid), stats);
            }
        }

        // 2) T-junctions: a line ends on a node another line passes through
        for (const nid of nodeIds) {
            const pass = passing.get(nid) || [];
            const ends = ending.get(nid) || [];
            if (!pass.length || !ends.length) continue;
            for (const e of ends) {
                batchTee(e.stroke.owner, pass[0].stroke.owner, nodeCoord.get(nid), stats, memo);
            }
        }

        // 3) property changes between two OSM ways on the same line
        for (const nid of nodeIds) {
            const pass = passing.get(nid) || [];
            if (pass.length !== 1 || (ending.get(nid) || []).length) continue;
            const p = pass[0];
            if (batchEdgeSignature(p.before, network) !== batchEdgeSignature(p.after, network)) {
                batchSplit(p.stroke.owner, nodeCoord.get(nid), stats);
            }
        }

        // nodes where lines only meet end-to-end (closed rings split in two)
        network.selfJoinPoints = [...nodeIds]
            .filter(nid => !(passing.get(nid) || []).length && (ending.get(nid) || []).length >= 2)
            .map(nid => nodeCoord.get(nid));
    }

    // Two cases the junction pass does not join. Say so, with the place,
    // instead of leaving them for the editor to stumble on.
    function reportUnjoinedPlaces(network, stats) {
        for (const stroke of network.strokes) {
            if (!stroke.owner) continue;
            const seen = new Set();
            for (const nid of stroke.nodeSeq.slice(1, -1)) {
                if (seen.has(nid)) {
                    stats.warnings.push(
                        `A road line crosses itself at ${fmtPoint(network.nodeCoord.get(nid))} and is not joined there. Add that junction by hand.`
                    );
                }
                seen.add(nid);
            }
        }

        if (!BATCH.TOUCH_EXISTING_ROADS) {
            for (const point of network.selfJoinPoints || []) {
                stats.warnings.push(
                    `Two new road ends meet at ${fmtPoint(point)} and are not joined. Drag one end onto the other.`
                );
            }
        }
    }

    // Until now createdWmeSegments has one owner per LINE (stroke). The
    // junctions are done, so store one owner per OSM WAY instead: each
    // segment goes to the way whose geometry is nearest to its midpoint.
    // Section 6 needs that to give every segment the tags of its own way.
    function rekeyBatchOwners(network) {
        const perWay = new Map();

        for (const stroke of network.strokes) {
            if (!stroke.owner) continue;
            for (const raw of stroke.owner.segmentIds) {
                const c = liveSegment(raw)?.geometry?.coordinates;
                if (!c || c.length < 2) continue;
                const mid = lineMidpoint(c);
                let best = null;
                for (const item of stroke.list) {
                    const edge = network.edges[item.edge];
                    const near = nearestPointOnLine(mid, edge.coords);
                    if (near && (!best || near.distance < best.distance)) {
                        best = { distance: near.distance, wayIndex: edge.wayIndex };
                    }
                }
                if (!best) continue;
                const osmId = network.ways[best.wayIndex].osmId;
                if (!perWay.has(osmId)) perWay.set(osmId, []);
                perWay.get(osmId).push(Number(raw));
            }
            createdWmeSegments.delete(stroke.key);
        }

        const now = new Date().toISOString();
        for (const [osmId, ids] of perWay) {
            const way = network.ways.find(w => w.osmId === osmId);
            createdWmeSegments.set(osmId, {
                segmentId: ids[0],
                segmentIds: [...new Set(ids)],
                osmId,
                name: getOsmStreetName(way?.tags || {}),
                createdAt: now,
                propertiesApplied: false,
                batch: true,
                draftFingerprint: ''
            });
            if (way?.item) way.item.wmeCreatedSegmentId = ids[0];
        }
    }

    /* ---------------- 7h. existing WME roads ----------------
       Default (BATCH.TOUCH_EXISTING_ROADS = false, decision D4): the
       script only LISTS the free ends of new roads that lie beside an
       existing road (logOpenEndsNearExisting).

       The three functions after it join new roads to existing ones.
       They only run when the switch is on, and have had far less
       testing than the rest of this section: treat them as experimental
       and read the audits in the run log after every run.              */

    // List every free end of a new road that lies near an existing WME
    // road, so the editor knows where to connect manually.
    function logOpenEndsNearExisting(network, stats) {
        const all = allSegments();
        const createdIds = getCreatedSegmentIdSet();
        const existing = all.filter(s => s?.geometry && !createdIds.has(Number(s.id)));
        let count = 0;

        for (const entry of getCreatedEntries()) {
            if (!entry.value.batch) continue;
            for (const raw of entry.value.segmentIds) {
                const seg = liveSegment(raw);
                const c = seg?.geometry?.coordinates;
                if (!c || c.length < 2) continue;
                for (const atStart of [true, false]) {
                    const nodeId = segmentEndNodeId(seg, atStart);
                    if (getNodeConnectedSegmentIds(nodeId).length !== 1) continue;
                    const P = asLonLat(atStart ? c[0] : c[c.length - 1]);
                    const box = pointBox(P, TOPO.CREATED_SNAP_M + 1);
                    let best = null;
                    for (const t of existing) {
                        if (!boxesOverlap(box, geometryBounds(t.geometry))) continue;
                        const near = nearestPointOnLine(P, t.geometry.coordinates);
                        if (near && near.distance <= TOPO.CREATED_SNAP_M && (!best || near.distance < best.d)) {
                            best = { d: near.distance, id: t.id };
                        }
                    }
                    if (best) {
                        count++;
                        runLog.add(`OPEN END WME ${seg.id} at ${fmtPoint(P)} -> existing ${best.id} (${best.d.toFixed(1)} m) — connect manually`);
                    }
                }
            }
        }

        // 3.10.2: the other way round. An EXISTING road whose dead end lies
        // on (or within EXISTING_DEAD_END_SNAP_M of) a new road is not
        // joined by anything in this script: joining it means moving the
        // end of the existing road, which the owner has not allowed. Until
        // now it was not even mentioned. It happens whenever areas are done
        // one beside the other: a road drawn in the last session ends where
        // a road of this session passes.
        const ours = [];
        for (const id of createdIds) {
            const s = liveSegment(id);
            if (s?.geometry?.coordinates?.length >= 2) {
                ours.push({
                    coords: s.geometry.coordinates,
                    box: expandBox(geometryBounds(s.geometry), TOPO.EXISTING_DEAD_END_SNAP_M + 1)
                });
            }
        }
        for (const t of existing) {
            const tc = t.geometry?.coordinates;
            if (!Array.isArray(tc) || tc.length < 2) continue;
            for (const atStart of [true, false]) {
                const nodeId = segmentEndNodeId(t, atStart);
                if (nodeId == null || !getNodeById(nodeId) || getNodeConnectedSegmentIds(nodeId).length !== 1) continue;
                const P = asLonLat(atStart ? tc[0] : tc[tc.length - 1]);
                if (!P) continue;
                let gap = Infinity;
                for (const o of ours) {
                    if (!o.box || P[0] < o.box.minX || P[0] > o.box.maxX || P[1] < o.box.minY || P[1] > o.box.maxY) continue;
                    const near = nearestPointOnLine(P, o.coords);
                    if (near && near.distance < gap) gap = near.distance;
                }
                if (gap <= TOPO.EXISTING_DEAD_END_SNAP_M) {
                    stats.warnings.push(
                        `Existing road ${t.id} has a dead end at ${fmtPoint(P)}, ${gap.toFixed(1)} m from a new road, ` +
                        'and is not joined to it. Drag that end onto the new road.'
                    );
                }
            }
        }

        stats.openEnds = count;
    }

    // (experimental) Free road ends: ends of new roads, and dead ends of
    // existing roads that lie beside a new road.
    function collectDanglingEndpoints(all, createdIds) {
        const result = [];
        const createdBoxes = [];

        for (const entry of getCreatedEntries()) {
            for (const rawId of entry.value.segmentIds) {
                const seg = liveSegment(rawId);
                if (!seg?.geometry || !segmentNodesLoaded(seg)) continue;

                createdBoxes.push(expandBox(geometryBounds(seg.geometry), TOPO.EXISTING_DEAD_END_SNAP_M + 1));

                for (const atStart of [true, false]) {
                    const nodeId = segmentEndNodeId(seg, atStart);
                    if (getNodeConnectedSegmentIds(nodeId).length !== 1) continue;
                    result.push({
                        segmentId: Number(seg.id),
                        nodeId,
                        atStart,
                        owner: entry.value,
                        snapM: TOPO.CREATED_SNAP_M,
                        onlyCreatedTargets: false
                    });
                }
            }
        }

        if (TOPO.CONNECT_EXISTING_DEAD_ENDS && createdBoxes.length) {
            for (const seg of all) {
                const id = Number(seg?.id);
                if (!Number.isFinite(id) || createdIds.has(id) || !seg.geometry) continue;

                const box = geometryBounds(seg.geometry);
                if (!createdBoxes.some(b => boxesOverlap(b, box))) continue;
                if (!segmentNodesLoaded(seg)) continue;

                for (const atStart of [true, false]) {
                    const nodeId = segmentEndNodeId(seg, atStart);
                    if (getNodeConnectedSegmentIds(nodeId).length !== 1) continue;
                    result.push({
                        segmentId: id,
                        nodeId,
                        atStart,
                        owner: null,
                        snapM: TOPO.EXISTING_DEAD_END_SNAP_M,
                        onlyCreatedTargets: true
                    });
                }
            }
        }

        return result;
    }

    // (experimental) Join one free end to the nearest road within its
    // snap distance: to a node when one is close, otherwise as a T.
    function tryConnectEndpoint(ep, all, createdIds, stats, memo) {
        const seg = liveSegment(ep.segmentId);
        const coords = seg?.geometry?.coordinates;
        if (!coords || coords.length < 2) return false;

        const P = asLonLat(ep.atStart ? coords[0] : coords[coords.length - 1]);
        if (!P) return false;

        const searchBox = pointBox(P, ep.snapM + 1);
        let bestNode = null;
        let bestLine = null;

        for (const target of all) {
            const tid = Number(target?.id);
            if (!Number.isFinite(tid) || tid === ep.segmentId || !target.geometry) continue;
            if (ep.onlyCreatedTargets && !createdIds.has(tid)) continue;
            if (memo.failed.has(`${ep.nodeId}>${tid}`)) continue;
            if (!boxesOverlap(searchBox, geometryBounds(target.geometry))) continue;

            const tc = target.geometry.coordinates;
            const near = nearestPointOnLine(P, tc);
            if (!near || near.distance > ep.snapM) continue;

            if (!segmentNodesLoaded(target)) {
                memo.unloaded.add(tid);
                continue;
            }

            for (const atStart of [true, false]) {
                const nid = segmentEndNodeId(target, atStart);
                if (nid == null || nid === ep.nodeId || memo.skipNodes.has(nid)) continue;
                const d = distanceM(P, atStart ? tc[0] : tc[tc.length - 1]);
                if (d <= TOPO.NODE_SNAP_M && (!bestNode || d < bestNode.distance)) {
                    bestNode = { distance: d, nodeId: nid, targetId: tid };
                }
            }

            if (!bestLine || near.distance < bestLine.near.distance) bestLine = { near, target };
        }

        let mode = null;

        if (bestNode && (!bestLine || bestNode.distance <= bestLine.near.distance + 0.5)) {
            mode = 'node';
        } else if (bestLine) {
            const n = bestLine.near;
            if (Math.min(n.distToStart, n.distToEnd) < TOPO.NODE_SNAP_M) {
                const atStart = n.distToStart <= n.distToEnd;
                const nid = segmentEndNodeId(bestLine.target, atStart);
                if (nid != null && nid !== ep.nodeId && !memo.skipNodes.has(nid)) {
                    bestNode = { distance: n.distance, nodeId: nid, targetId: Number(bestLine.target.id) };
                    mode = 'node';
                }
            } else {
                mode = 'line';
            }
        }

        if (!mode) return false;

        if (mode === 'node') {
            const result = mergeNodesUsingWmeAction(ep.nodeId, bestNode.nodeId);
            if (result.ok) {
                stats.endpointConnections++;
                return true;
            }

            // The WME SDK has no "merge nodes" method and the internal
            // MoveAndMergeNode action is switched off. Join the two road
            // ends with official SDK calls only (bend + cross + trim).
            const target = liveSegment(bestNode.targetId);
            if (target) {
                const targetAtStart = segmentEndNodeId(target, true) === bestNode.nodeId;
                const joined = connectEndpointToTargetEnd(ep, P, coords, target, targetAtStart, memo);
                if (joined.ok) {
                    stats.endpointConnections++;
                    if (joined.warning) stats.warnings.push(joined.warning);
                    return true;
                }
                stats.warnings.push(`End-to-end ${ep.segmentId} -> ${bestNode.targetId}: ${joined.reason}`);
            }

            memo.failed.add(`${ep.nodeId}>${bestNode.targetId}`);
            return false;
        }

        const result = connectEndpointByOvershoot(ep, P, coords, bestLine.target, bestLine.near, memo);
        if (result.ok) {
            stats.endpointConnections++;
            stats.nearMissIntersections++;
            if (result.warning) stats.warnings.push(result.warning);
            return true;
        }

        memo.failed.add(`${ep.nodeId}>${bestLine.target.id}`);
        stats.warnings.push(`T-junction ${ep.segmentId} -> ${bestLine.target.id}: ${result.reason}`);
        return false;
    }

    // 3.10.0: joining new roads to EXISTING roads, the careful way.
    // This is what runs when the editor ticks "Also join to existing roads"
    // (BATCH.TOUCH_EXISTING_ROADS). It does what the owner does by hand
    // (recorded with the Save Monitor on 2026-10-06): drag the free end of
    // a new road onto an existing road, which splits that road at one
    // point and changes nothing else on it.
    //
    // The rules, agreed with the owner:
    //   1. FREE ENDS. A new road whose end is free is joined where its own
    //      direction meets an existing road: it is extended up to
    //      END_REACH_M, or cut back up to END_TRIM_M when it runs past the
    //      existing road (OpenStreetMap and WME rarely agree to the metre).
    //   2. CROSSINGS. A new road that crosses an existing road in its
    //      middle gets a junction there.
    //   3. An existing road is only ever SPLIT at the meeting point. It is
    //      never moved, shortened, deleted or retyped. (addIntersection
    //      needs equal road types; the temporary retype is done on the new
    //      road, see 7c.)
    //   4. Left to the editor, with a line in the result: a meeting point
    //      closer than NODE_KEEP_M to an existing node (the SDK cannot
    //      merge nodes; the editor drags the end onto the node), a road
    //      locked above the editor's rank, a roundabout, a meeting at a
    //      very flat angle (it usually is the same road drawn twice).
    //   5. Never joined: pedestrian paths, ferries, railways, runways
    //      (NO_JOIN_TYPES), and roads on another level (bridges, tunnels).
    //   6. Every existing road that was split is written to the result as
    //      a "Check:" line with its place, so the editor can look at each
    //      one before saving.
    //
    // The numbers below belong in Section 1; move them there at the next
    // full pass over the file.
    function connectToExistingSafely(network, stats, memo) {
        const END_REACH_M = 10;   // a free end is extended at most this far
        const END_TRIM_M = 8;     // a road running past an existing road by less than this is cut back
        const NODE_KEEP_M = 3;    // no junction closer than this to a node that is already there
        const MIN_LEFT_M = 5;     // never cut a new road down to less than this
        const MIN_ANGLE_DEG = 25; // flatter than this is not a junction
        const NO_JOIN_TYPES = new Set([5, 9, 10, 15, 16, 18, 19]);

        const userRank = safeCall(() => Number(sdk.State.getUserInfo().rank), NaN);

        // Existing roads a new road may be joined to at all (rule 5).
        // Read again before every step: a split gives the pieces new ids.
        const existingNow = () => {
            const createdIds = getCreatedSegmentIdSet();
            return allSegments().filter(s =>
                Array.isArray(s?.geometry?.coordinates) && s.geometry.coordinates.length >= 2 &&
                !createdIds.has(Number(s.id)) &&
                !NO_JOIN_TYPES.has(Number(s.roadType)) &&
                segmentElevation(s) === 0
            );
        };

        // Angle between two lines near a point, 0..90 degrees.
        const angleAt = (lineA, lineB, at) => {
            const direction = line => {
                const near = nearestPointOnLine(at, line);
                const p = asLonLat(line[near?.segIndex ?? 0]);
                const q = asLonLat(line[(near?.segIndex ?? 0) + 1]);
                if (!p || !q) return [0, 0];
                const mm = metersPerDegree(p[1]);
                return [(q[0] - p[0]) * mm.x, (q[1] - p[1]) * mm.y];
            };
            const u = direction(lineA);
            const v = direction(lineB);
            const lu = Math.hypot(u[0], u[1]);
            const lv = Math.hypot(v[0], v[1]);
            if (!lu || !lv) return 90;
            return Math.acos(Math.min(1, Math.abs(u[0] * v[0] + u[1] * v[1]) / (lu * lv))) * 180 / Math.PI;
        };

        // Why this existing road must be left to the editor at this point
        // (rule 4). An empty text means it may be split there.
        const refusal = (t, at, angle) => {
            const tc = t.geometry.coordinates;
            if (!segmentNodesLoaded(t)) {
                memo.unloaded.add(Number(t.id));
                return 'one of its ends is outside the loaded map';
            }
            if (t.junctionId != null) return 'it is part of a roundabout';
            if (Number.isFinite(userRank) && Number(t.lockRank ?? 0) > userRank) return 'it is locked above your rank';
            if (Math.min(distanceM(at, tc[0]), distanceM(at, tc[tc.length - 1])) < NODE_KEEP_M) {
                return `the meeting point is less than ${NODE_KEEP_M} m from a node that is already there (drag the new road onto that node)`;
            }
            if (angle < MIN_ANGLE_DEG) {
                return `the two roads meet at ${angle.toFixed(0)} degrees, which looks like the same road drawn twice`;
            }
            return '';
        };

        /* ----- 1. free ends ----- */

        const joinEnd = ep => {
            const seg = liveSegment(ep.segmentId);
            const coords = seg?.geometry?.coordinates || [];
            const line = coords.map(asLonLat).filter(Boolean);
            if (line.length < 2 || line.length !== coords.length || isGradeSeparated(seg)) return;
            if (!ep.atStart) line.reverse(); // line[0] is the free end

            const P = line[0];
            const A = line[1];
            const lastLeg = distanceM(P, A);
            if (lastLeg < 1) return;

            // A straight probe along the road's last leg: from `back` metres
            // before the end (never past the last shape point, so a cut
            // never removes a bend) to END_REACH_M beyond it.
            const m = metersPerDegree(P[1]);
            const ux = (P[0] - A[0]) * m.x / lastLeg;
            const uy = (P[1] - A[1]) * m.y / lastLeg;
            const back = Math.min(END_TRIM_M, lastLeg - 1);
            const B = [P[0] - ux * back / m.x, P[1] - uy * back / m.y];
            const F = [P[0] + ux * END_REACH_M / m.x, P[1] + uy * END_REACH_M / m.y];
            const box = expandBox(geometryBounds({ coordinates: [B, F] }), 1);

            let best = null;
            for (const t of existingNow()) {
                if (!boxesOverlap(box, geometryBounds(t.geometry))) continue;
                const tc = t.geometry.coordinates;
                for (let i = 0; i < tc.length - 1; i++) {
                    const hit = findLineIntersectionPoint(B, F, tc[i], tc[i + 1]);
                    if (!hit) continue;
                    // below zero: the new road runs past the existing road
                    const shift = hit.t * (back + END_REACH_M) - back;
                    if (!best || Math.abs(shift) < Math.abs(best.shift)) best = { t, at: hit.coordinates, shift };
                }
            }
            if (!best) return;

            const tc = best.t.geometry.coordinates;
            let why = lineLengthM(line) + Math.min(0, best.shift) < MIN_LEFT_M
                ? `less than ${MIN_LEFT_M} m of the new road would be left`
                : refusal(best.t, best.at, angleAt([B, F], tc, best.at));

            if (!why) {
                const near = nearestPointOnLine(best.at, tc);
                const r = near
                    ? connectEndpointByOvershoot(ep, P, coords, best.t, near, memo)
                    : { ok: false, reason: 'no point found on the existing road' };
                if (r.ok) {
                    stats.endpointConnections++;
                    if (r.warning) stats.warnings.push(r.warning);
                    stats.warnings.push(
                        `Check: existing road ${best.t.id} was split at ${fmtPoint(best.at)} to take the end of a new road ` +
                        `(the new road was ${best.shift < 0 ? 'cut back' : 'extended'} ${Math.abs(best.shift).toFixed(1)} m). ` +
                        'Nothing else on the existing road was changed.'
                    );
                    return;
                }
                why = r.reason;
            }

            stats.warnings.push(
                `New road end at ${fmtPoint(P)} was not joined to existing road ${best.t.id}: ${why}. Join it by hand.`
            );
        };

        // One end at a time, looked up again after every junction, because
        // a junction gives the joined segment a new id. An end is tried once.
        const tried = new Set();
        for (let guard = 0; guard < 1000; guard++) {
            let ep = null;
            search:
            for (const entry of getCreatedEntries()) {
                if (!entry.value.batch) continue;
                for (const raw of entry.value.segmentIds) {
                    const seg = liveSegment(raw);
                    if (!seg?.geometry || !segmentNodesLoaded(seg)) continue;
                    for (const atStart of [true, false]) {
                        const nodeId = segmentEndNodeId(seg, atStart);
                        if (tried.has(nodeId) || getNodeConnectedSegmentIds(nodeId).length !== 1) continue;
                        ep = { segmentId: Number(seg.id), nodeId, atStart, owner: entry.value };
                        break search;
                    }
                }
            }
            if (!ep) break;
            tried.add(ep.nodeId);
            joinEnd(ep);
        }

        /* ----- 1b. the dead end of an EXISTING road lies on a new road -----
           3.10.3, allowed by the owner on 2026-10-07 as an exception to
           rule 3: when the dead end of an existing road is less than
           EXISTING_END_GAP_M from a new road, that end is joined to the new
           road. It is done like every other T (7d): the end is pushed
           across the new road, addIntersection makes the node, the piece
           that sticks out is deleted. The existing road therefore ends on
           the new road instead of right beside it; its end moves by less
           than the gap plus 0.3 m, and nothing else on it changes.
           It happens whenever areas are done one beside the other: a road
           drawn in the last session ends where a road of this one passes.
           Farther away than the gap, the end is only reported
           (logOpenEndsNearExisting).                                      */

        const EXISTING_END_GAP_M = 1;
        const triedOld = new Set();
        for (let guard = 0; guard < 500; guard++) {
            const ours = [];
            for (const id of getCreatedSegmentIdSet()) {
                const s = liveSegment(id);
                if (s?.geometry?.coordinates?.length >= 2 && segmentNodesLoaded(s) && !isGradeSeparated(s)) {
                    ours.push({ s, box: expandBox(geometryBounds(s.geometry), EXISTING_END_GAP_M + 1) });
                }
            }

            let job = null;
            lookup:
            for (const t of existingNow()) {
                const tc = t.geometry.coordinates;
                for (const atStart of [true, false]) {
                    const nodeId = segmentEndNodeId(t, atStart);
                    if (nodeId == null || triedOld.has(nodeId) || !getNodeById(nodeId) ||
                        getNodeConnectedSegmentIds(nodeId).length !== 1) continue;
                    const P = asLonLat(atStart ? tc[0] : tc[tc.length - 1]);
                    if (!P) continue;
                    for (const o of ours) {
                        if (!o.box || P[0] < o.box.minX || P[0] > o.box.maxX || P[1] < o.box.minY || P[1] > o.box.maxY) continue;
                        const near = nearestPointOnLine(P, o.s.geometry.coordinates);
                        if (!near || near.distance > EXISTING_END_GAP_M) continue;
                        job = { t, tc, atStart, nodeId, P, s: o.s, near };
                        break lookup;
                    }
                }
            }
            if (!job) break;
            triedOld.add(job.nodeId);

            const { t, tc, atStart, nodeId, P, s, near } = job;
            const A = asLonLat(atStart ? tc[1] : tc[tc.length - 2]);
            let why = '';
            if (!segmentNodesLoaded(t)) why = 'one of its ends is outside the loaded map';
            else if (t.junctionId != null) why = 'it is part of a roundabout';
            else if (Number.isFinite(userRank) && Number(t.lockRank ?? 0) > userRank) why = 'it is locked above your rank';
            else if (Math.min(near.distToStart, near.distToEnd) < NODE_KEEP_M) {
                why = `it meets the new road less than ${NODE_KEEP_M} m from one of that road's nodes (drag the end onto that node)`;
            } else if (!A || distanceM(A, P) < 1) why = 'its last leg is too short to work with';
            else if (angleAt([A, P], s.geometry.coordinates, near.coordinates) < MIN_ANGLE_DEG) {
                why = 'the two roads meet at a very flat angle';
            }

            if (!why) {
                const r = connectEndpointByOvershoot(
                    { segmentId: Number(t.id), nodeId, atStart, owner: null }, P, tc, s, near, memo
                );
                if (r.ok) {
                    stats.endpointConnections++;
                    if (r.warning) stats.warnings.push(r.warning);
                    stats.warnings.push(
                        `Check: the dead end of existing road ${t.id} at ${fmtPoint(P)} was joined to the new road it touches ` +
                        `(it was ${near.distance.toFixed(1)} m away). Nothing else on the existing road was changed.`
                    );
                    continue;
                }
                why = r.reason;
            }

            stats.warnings.push(
                `The dead end of existing road ${t.id} at ${fmtPoint(P)} was not joined to the new road beside it: ${why}. Join it by hand.`
            );
        }

        /* ----- 2. a new road crosses an existing road in its middle ----- */

        const leftAlone = new Set(); // crossings already reported, by place
        for (let pass = 0; pass < TOPO.MAX_ITERATIONS; pass++) {
            const existing = existingNow();
            let changed = false;

            outer:
            for (const entry of getCreatedEntries()) {
                if (!entry.value.batch) continue;
                for (const rawId of [...entry.value.segmentIds]) {
                    const sid = Number(rawId);
                    const s = liveSegment(sid);
                    if (!s?.geometry || !segmentNodesLoaded(s) || isGradeSeparated(s)) continue;
                    const sBox = geometryBounds(s.geometry);

                    for (const t of existing) {
                        if (!boxesOverlap(sBox, geometryBounds(t.geometry))) continue;
                        const cross = findInteriorCrossing(s.geometry, t.geometry, 0.05);
                        if (!cross) continue;
                        const place = fmtPoint(cross.coordinates);
                        if (leftAlone.has(place)) continue;

                        // the same crossing, but only when it is clear of the
                        // nodes at the ends of both roads
                        const clear = findInteriorCrossing(s.geometry, t.geometry, NODE_KEEP_M);
                        const why = !clear
                            ? `the crossing is less than ${NODE_KEEP_M} m from the end of one of the two roads`
                            : refusal(t, clear.coordinates, angleAt(s.geometry.coordinates, t.geometry.coordinates, clear.coordinates));
                        const r = why
                            ? { ok: false, reason: why }
                            : addIntersectionPreservingRoadTypes(sid, Number(t.id), Number(s.roadType), Number(t.roadType));

                        if (!r.ok) {
                            leftAlone.add(place);
                            stats.warnings.push(
                                `A new road crosses existing road ${t.id} at ${place} and was not joined: ${r.reason}. Make that junction by hand.`
                            );
                            continue;
                        }

                        replaceCreatedSegmentId(entry.value, sid, r.sourceSplits);
                        stats.intersections++;
                        if (r.restoreFailures?.length) {
                            stats.warnings.push(`Road type restore failed: ${r.restoreFailures.join(' | ')}`);
                        }
                        stats.warnings.push(
                            `Check: existing road ${t.id} was split at ${fmtPoint(clear.coordinates)} where a new road crosses it. ` +
                            'Nothing else on the existing road was changed.'
                        );
                        changed = true;
                        break outer; // ids changed: read everything again
                    }
                }
            }

            if (!changed) break;
        }

        /* ----- 2b. shape points left right beside the new junctions -----
           3.10.3, allowed by the owner on 2026-10-07 as an exception to
           rule 3. A junction cannot be made exactly on a shape point of
           the existing road, so it is made 0.3 m beside it
           (offsetCrossingPoint, 7d) and the old shape point stays there,
           0.3 m from the new node. On new roads the clean-up removes such
           points; on existing roads nothing did (seen: "shortest leg
           0.29 m" on a piece of 485596294).
           Only a piece of an existing road that ends on a node shared with
           a road drawn in this session is looked at, and only its shape
           points closer than OLD_POINT_CLEAR_M to that node are removed.
           The rest of its shape is written back as the SDK hands it out,
           which can differ from the stored shape by a few centimetres.    */

        const OLD_POINT_CLEAR_M = 1;
        {
            const createdIds = getCreatedSegmentIdSet();
            const joinsNew = nodeId => getNodeConnectedSegmentIds(nodeId).some(id => createdIds.has(id));

            for (const t of existingNow()) {
                const tid = Number(t.id);
                const tc = t.geometry.coordinates.map(asLonLat);
                if (tc.length < 3 || tc.some(p => !p)) continue;

                const from = segmentEndNodeId(t, true);
                const to = segmentEndNodeId(t, false);
                // never rewrite a segment that one of its nodes does not list
                // (see cleanCreatedGeometry, Section 8, for what that does)
                if (![from, to].every(n => getNodeConnectedSegmentIds(n).includes(tid))) continue;

                const atStart = joinsNew(from);
                const atEnd = joinsNew(to);
                if (!atStart && !atEnd) continue;

                const first = tc[0];
                const last = tc[tc.length - 1];
                const kept = tc.filter((p, i) =>
                    i === 0 || i === tc.length - 1 ||
                    !((atStart && distanceM(p, first) < OLD_POINT_CLEAR_M) ||
                        (atEnd && distanceM(p, last) < OLD_POINT_CLEAR_M))
                );
                if (kept.length < 2 || kept.length === tc.length) continue;

                const where = fmtPoint(atStart && distanceM(tc[1], first) < OLD_POINT_CLEAR_M ? first : last);
                try {
                    wmeSegments().updateSegment({
                        segmentId: tid,
                        geometry: { type: 'LineString', coordinates: kept }
                    });
                    runLog.ok(`Existing road ${tid}: ${tc.length - kept.length} shape point(s) left beside the new junction at ${where} removed`);
                } catch (error) {
                    stats.warnings.push(
                        `Existing road ${tid}: a shape point right beside the new junction at ${where} could not be removed ` +
                        `(${error?.message || error}). Remove it by hand.`
                    );
                }
            }
        }

        /* ----- 3. what is still open ----- */

        for (const point of network.selfJoinPoints || []) {
            stats.warnings.push(
                `Two new road ends meet at ${fmtPoint(point)} and are not joined. Drag one end onto the other.`
            );
        }
        logOpenEndsNearExisting(network, stats);
    }

    // 3.10.0: the three functions below are NOT CALLED any more;
    // connectToExistingSafely() above replaced them. They are kept for
    // reference only: tryConnectEndpoint can shorten an existing road by
    // 2 m (connectEndpointToTargetEnd) and collectDanglingEndpoints can
    // move the dead end of an existing road, which the owner does not want.
    // (experimental) Only runs when BATCH.TOUCH_EXISTING_ROADS is true.
    // Existing roads are split at the junctions and keep their road type.
    function batchConnectToExisting(network, stats, memo) {
        const selfJoinPoints = network.selfJoinPoints || [];

        // 1) a new road crosses an existing WME road
        for (let pass = 0; pass < TOPO.MAX_ITERATIONS; pass++) {
            const all = allSegments();
            const createdIds = getCreatedSegmentIdSet();
            const existing = all.filter(s => s?.geometry && !createdIds.has(Number(s.id)));
            let changed = false;

            outer:
            for (const entry of getCreatedEntries()) {
                if (!entry.value.batch) continue;
                for (const rawId of [...entry.value.segmentIds]) {
                    const sid = Number(rawId);
                    const s = liveSegment(sid);
                    if (!s?.geometry || !segmentNodesLoaded(s) || isGradeSeparated(s)) continue;
                    const sBox = geometryBounds(s.geometry);

                    for (const t of existing) {
                        const tid = Number(t.id);
                        const key = `${sid}|${tid}`;
                        if (memo.failed.has(key)) continue;
                        if (!boxesOverlap(sBox, geometryBounds(t.geometry))) continue;
                        if (!findInteriorCrossing(s.geometry, t.geometry, TOPO.CROSS_END_MARGIN_M)) continue;

                        if (!segmentNodesLoaded(t)) {
                            memo.unloaded.add(tid);
                            memo.failed.add(key);
                            continue;
                        }
                        if (isGradeSeparated(t)) {
                            memo.failed.add(key);
                            continue;
                        }

                        const r = addIntersectionPreservingRoadTypes(sid, tid, Number(s.roadType), Number(t.roadType));
                        if (!r.ok) {
                            memo.failed.add(key);
                            stats.warnings.push(`Crossing new ${sid} / existing ${tid}: ${r.reason}`);
                            continue;
                        }

                        replaceCreatedSegmentId(entry.value, sid, r.sourceSplits);
                        stats.intersections++;
                        changed = true;
                        break outer;
                    }
                }
            }

            if (!changed) break;
        }

        // 2) free road ends (new -> existing, existing dead end -> new,
        //    and new -> new where a closed ring was split)
        for (let pass = 0; pass < TOPO.MAX_ITERATIONS; pass++) {
            const all = allSegments();
            const createdIds = getCreatedSegmentIdSet();
            const existing = all.filter(s => !createdIds.has(Number(s?.id)));
            const created = all.filter(s => createdIds.has(Number(s?.id)));

            const endpoints = collectDanglingEndpoints(all, createdIds)
                .filter(ep => !memo.skipNodes.has(ep.nodeId) && (!ep.owner || ep.owner.batch));

            const failedBefore = memo.failed.size;
            let changed = false;

            for (const ep of endpoints) {
                let targets = all;
                if (ep.owner) {
                    const c = liveSegment(ep.segmentId)?.geometry?.coordinates || [];
                    const P = c.length ? (ep.atStart ? c[0] : c[c.length - 1]) : null;
                    const selfJoin = P && selfJoinPoints.some(pt => distanceM(pt, P) <= BATCH.POINT_EPS_M);
                    targets = selfJoin ? created : existing;
                }
                if (tryConnectEndpoint(ep, targets, createdIds, stats, memo)) {
                    changed = true;
                    break;
                }
            }

            if (!changed && memo.failed.size === failedBefore) break;
        }
    }

// ████████████████████████  SECTION 8 — BUILD  ████████████████████████

    /* ================================================================
       SECTION 8 — BUILD: the "Draw" button

       PURPOSE   buildMissingRoads() decides WHAT to draw for each
                 missing road, then runs the steps of Sections 7 and 6
                 in order, checks the result and writes the run log.
       USES      Sections 1 to 7, Section 10 (updateStatus, render).
       USED BY   Section 10 (the Draw button; the result panel; the
                 "Copy run log" button reads runLog).

       WHAT IS DRAWN FOR EACH ROAD (decisions D10, D12, D13)
         1. less than 20 m inside the area ........ left out
         2. inside part already in WME ............ left out
         3. otherwise the WHOLE road is drawn, also outside the area,
            except that
              - it is never drawn past the edge of the screen (WME has
                no data there, so a road could be drawn twice);
              - if its outside part is already in WME, it is cut at the
                edge of the area instead.
         The same tests ran during the scan; they run again here
         because the map may have changed since (an earlier build, an
         undo, the editor moving the map).

       THE STEPS            see "THE FLOW" in the guide at the top.

       THE CHECKS AFTERWARDS
         auditTopology        every segment must be listed by its end
                              nodes and the other way round. Run before
                              and after; only NEW problems count.
         repairBroken...      a new segment with a broken node link is
                              deleted (decision D14).
         auditCreatedGeometry a segment end must sit on its node, no
                              collapsed or zero-length segments. Only
                              reported, never changed.
         startEditTracking    counts edits that touched existing
                              (positive-id) objects, to prove in the log
                              that existing roads were left alone.

       stats   one object collects every count and message of a run:
               created, crossings, tees, splits, loopSplits,
               intersections, endpointConnections, nearMissIntersections,
               propertiesFailed, openEnds, cutAtScreen, skipped[],
               saveBlockers[], warnings[]. Section 10 shows it.
       memo    { failed, unloaded, skipNodes }: what Section 7 should
               not try again in this run.

       CHANGES TO THIS SECTION
         3.8.0  created by the restructure (code unchanged; the run log
                heading no longer prints an engine number).
         3.8.1  cleanCreatedGeometry(): duplicate shape points are
                removed from every new segment before the checks. WME
                refused the save with "Segment is too short (might be
                a point)" when a piece left by a crossing kept the old
                shape point right on top of its new end node.
       ================================================================ */

    /* ---------------- run log (the editor can copy it) ---------------- */

    const runLog = {
        lines: [],
        startedAt: null,
        start(title) {
            this.lines = [];
            this.startedAt = Date.now();
            this.add(`=== ${title} ===`);
            this.add(`${SCRIPT_NAME} ${SCRIPT_VERSION} | WME ${safeCall(() => sdk.getWMEVersion())} | ${new Date().toISOString()}`);
        },
        add(text) {
            const t = this.startedAt ? `+${((Date.now() - this.startedAt) / 1000).toFixed(1)}s` : '';
            this.lines.push(`${t} ${text}`.trim());

            // 3.8.6 (temporary diagnostics): the same three places lose a
            // node link on every run, and the audit at the end cannot say
            // which step did it. So during a build the topology is audited
            // after every step line (OK / FAIL / WARN) and any inconsistency
            // not seen before is written right under the step that came just
            // before it. Makes a build slower. Switch off with
            // runLog.auditEachStep = false, and remove once the cause is found.
            if (this.lines.length === 1) this.seenIssues = new Set();
            if (this.auditEachStep !== false && batchRunning && sdk && !this.auditing &&
                /^(OK|FAIL|WARN)\b/.test(text)) {
                this.auditing = true;
                try {
                    for (const issue of auditTopology()) {
                        if (this.seenIssues.has(issue)) continue;
                        this.seenIssues.add(issue);
                        this.lines.push(`      ^ first seen after the step above: ${issue}`);
                    }
                } catch (error) {
                    /* diagnostics only */
                } finally {
                    this.auditing = false;
                }
            }
        },
        ok(text) { this.add(`OK   ${text}`); },
        warn(text) { this.add(`WARN ${text}`); },
        fail(text) { this.add(`FAIL ${text}`); },
        text() { return this.lines.join('\n'); }
    };

    /* ---------------- topology audit (finds "node not connected" issues) ---------------- */

    function auditTopology() {
        const issues = [];
        const nodes = sdk?.DataModel?.Nodes;
        if (!nodes?.getById) return issues;

        for (const seg of allSegments()) {
            const sid = Number(seg?.id);
            if (!Number.isFinite(sid)) continue;
            for (const atStart of [true, false]) {
                const nid = segmentEndNodeId(seg, atStart);
                if (nid == null) {
                    issues.push(`segment ${sid}: ${atStart ? 'from' : 'to'} node id is null`);
                    continue;
                }
                const node = getNodeById(nid);
                if (!node) continue; // outside loaded area, normal
                const connected = (node.connectedSegmentIds || []).map(Number);
                if (!connected.includes(sid)) {
                    issues.push(`node ${nid} does not list segment ${sid} (${atStart ? 'from' : 'to'})`);
                }
            }
        }

        for (const node of safeCall(() => nodes.getAll(), [])) {
            const nid = Number(node?.id);
            for (const raw of node?.connectedSegmentIds || []) {
                const sid = Number(raw);
                const seg = liveSegment(sid);
                if (!seg) {
                    issues.push(`node ${nid} lists missing segment ${sid}`);
                    continue;
                }
                if (segmentEndNodeId(seg, true) !== nid && segmentEndNodeId(seg, false) !== nid) {
                    issues.push(`node ${nid} lists segment ${sid}, but the segment does not end there`);
                }
            }
        }

        return issues;
    }

    // Writes the audit to the run log and returns the issues that were
    // not there in the baseline (the audit taken before the run).
    function logAudit(label, issues, baseline) {
        const base = new Set(baseline || []);
        const fresh = issues.filter(i => !base.has(i));
        runLog.add(`Audit ${label}: ${issues.length} inconsistencies${baseline ? ` (${fresh.length} new since start)` : ''}`);
        (baseline ? fresh : issues).slice(0, 25).forEach(i => runLog.add(`  AUDIT ${i}`));
        return fresh;
    }

    // A new segment whose node link is broken would block Save. Remove it
    // (SDK deleteSegment) and tell the editor to redraw that small piece.
    function repairBrokenNewSegments(freshIssues, stats) {
        const createdIds = getCreatedSegmentIdSet();
        const broken = new Set();
        for (const issue of freshIssues) {
            const m = issue.match(/segment (-?\d+)/);
            const sid = m ? Number(m[1]) : NaN;
            if (Number.isFinite(sid) && createdIds.has(sid)) broken.add(sid);
        }

        for (const sid of broken) {
            const seg = liveSegment(sid);
            const c = seg?.geometry?.coordinates || [];
            const where = c.length ? `${fmtPoint(c[0])} -> ${fmtPoint(c[c.length - 1])}` : '?';

            // 3.8.5: before the segment is deleted, write down what WME
            // thinks is connected where. The same places break on every
            // run; these lines are there to find out why.
            for (const atStart of [true, false]) {
                const nid = segmentEndNodeId(seg, atStart);
                const end = c.length ? asLonLat(atStart ? c[0] : c[c.length - 1]) : null;
                const listed = getNodeConnectedSegmentIds(nid);
                runLog.add(`  BROKEN ${sid} ${atStart ? 'from' : 'to'} node ${nid} at ${fmtPoint(end)} | that node lists: ${listed.join(', ') || 'nothing'}`);
                for (const other of listed) {
                    const o = liveSegment(other);
                    runLog.add(`    listed ${other}: nodes ${segmentEndNodeId(o, true)} -> ${segmentEndNodeId(o, false)}, ${lineLengthM(o?.geometry?.coordinates).toFixed(1)} m`);
                }
                for (const node of safeCall(() => sdk.DataModel.Nodes.getAll(), []) || []) {
                    const d = distanceM(node?.geometry?.coordinates, end);
                    if (Number(node?.id) === nid || !(d < 3)) continue;
                    runLog.add(`    other node ${node.id}, ${d.toFixed(2)} m away, lists: ${(node.connectedSegmentIds || []).join(', ') || 'nothing'}`);
                }
            }
            try {
                wmeSegments().deleteSegment({ segmentId: sid });
                const owner = findCreatedOwner(sid);
                if (owner) removeCreatedSegmentId(owner.value, sid);
                runLog.warn(`Broken new segment ${sid} (${where}) was DELETED to keep Save working. Redraw this piece manually.`);
                stats.warnings.push(`Broken new segment ${sid} was deleted (${where}). Redraw it manually.`);
            } catch (error) {
                runLog.fail(`Broken new segment ${sid} (${where}) could not be deleted: ${error?.message || error}. Delete it manually before Save.`);
                stats.warnings.push(`Broken new segment ${sid} at ${where}: delete it manually before Save.`);
            }
        }
    }

    // Geometry check on the roads this script drew. The topology audit
    // above only compares ID lists; the save can also be refused when a
    // segment end does not sit on its node, when a new segment points at a
    // node that is gone, or when a segment has collapsed. Nothing is
    // changed here: problems are only reported.
    //
    // WME keeps node positions and segment shapes at slightly different
    // precision, so an end can sit up to about 0.07 m from its node on a
    // perfectly healthy road. Only a gap of NODE_GAP_PROBLEM_M or more is
    // reported; the largest gap seen goes to the run log.
    function auditCreatedGeometry() {
        const issues = [];
        let closeShapePoints = 0;
        let largestGap = 0;

        for (const sid of getCreatedSegmentIdSet()) {
            const seg = liveSegment(sid);
            if (!seg) continue;

            const c = seg.geometry?.coordinates || [];
            if (c.length < 2) {
                issues.push(`segment ${sid}: geometry has ${c.length} point(s)`);
                continue;
            }

            const from = segmentEndNodeId(seg, true);
            const to = segmentEndNodeId(seg, false);
            const length = lineLengthM(c);

            if (from != null && from === to) {
                issues.push(`segment ${sid}: both ends use node ${from} (${fmtPoint(c[0])})`);
            }
            if (length < SHORT_SEGMENT_M) {
                issues.push(`segment ${sid}: only ${length.toFixed(2)} m long at ${fmtPoint(c[0])}`);
            }

            for (const atStart of [true, false]) {
                const nid = atStart ? from : to;
                const end = atStart ? c[0] : c[c.length - 1];
                const side = atStart ? 'start' : 'end';
                if (nid == null) continue; // reported by the topology audit

                const node = getNodeById(nid);
                if (!node) {
                    issues.push(`segment ${sid}: ${side} node ${nid} is not in the data model (${fmtPoint(end)})`);
                    continue;
                }
                const gap = distanceM(node.geometry?.coordinates, end);
                if (Number.isFinite(gap) && gap > largestGap) largestGap = gap;
                if (!(gap < NODE_GAP_PROBLEM_M)) {
                    issues.push(`segment ${sid}: ${side} is ${Number.isFinite(gap) ? gap.toFixed(2) + ' m' : 'an unknown distance'} away from its node ${nid} (${fmtPoint(end)})`);
                }
            }

            for (let i = 1; i < c.length; i++) {
                if (distanceM(c[i - 1], c[i]) < 0.01) {
                    issues.push(`segment ${sid}: zero-length leg at ${fmtPoint(c[i])}`);
                    break;
                }
            }

            if (c.length > 2 &&
                (distanceM(c[0], c[1]) < 0.5 || distanceM(c[c.length - 1], c[c.length - 2]) < 0.5)) {
                closeShapePoints++;
            }
        }

        return { issues, closeShapePoints, largestGap };
    }

    // Listens to WME's edit events during a run and notes every edit that
    // touched an existing (positive-id) object. stop() writes the count
    // to the run log.
    function startEditTracking() {
        const events = sdk?.Events;
        const seen = [];
        let handler = null;
        try {
            handler = payload => {
                try {
                    const objects = Array.isArray(payload?.affectedObjects) ? payload.affectedObjects : [];
                    const existing = objects.filter(o => Number(o?.objectId) > 0);
                    if (existing.length) seen.push(JSON.stringify(existing).slice(0, 300));
                } catch (e) { /* ignore */ }
            };
            events?.on?.({ eventName: 'wme-after-edit', eventHandler: handler });
        } catch (error) {
            runLog.add(`Edit tracking unavailable: ${error?.message || error}`);
        }
        return {
            stop() {
                try { events?.off?.({ eventName: 'wme-after-edit', eventHandler: handler }); } catch (e) { /* ignore */ }
                runLog.add(`Edits that touched existing (positive-id) objects: ${seen.length}`);
                seen.slice(0, 15).forEach(t => runLog.add(`  EDIT ${t}`));
            }
        };
    }

    /* ---------------- clean-up before the checks ---------------- */

    // Removes duplicate shape points from every segment this script drew.
    // addIntersection can leave a piece whose old shape point lies right
    // on top of its new end node (a zero-length leg). A piece that goes
    // through another junction is cleaned there (Section 7c), but a piece
    // that is not touched again kept the duplicate, and WME then refused
    // the whole save with "Segment is too short (might be a point)".
    // End points are never moved, so the segments stay on their nodes.
    // Returns how many segments were changed.
    function cleanCreatedGeometry() {
        let cleaned = 0;
        for (const id of getCreatedSegmentIdSet()) {
            const seg = liveSegment(id);
            const before = segmentCoords(id);

            // 3.8.7: leave a segment alone when one of its end nodes does not
            // list it (a broken link, see repairBrokenNewSegments). Writing
            // its shape made WME hang that end on a brand-new node at the
            // same place: the audit then found nothing wrong, so the segment
            // was not deleted and not reported, and it was saved unconnected.
            if (![true, false].every(atStart =>
                getNodeConnectedSegmentIds(segmentEndNodeId(seg, atStart)).includes(Number(id)))) continue;
            if (before.length < 3) continue;
            // 3.8.4: besides duplicate points, drop every shape point within
            // NODE_CLEAR_M of either end of the segment (see Section 1).
            // The two end points themselves are never touched.
            const tidy = cleanLineCoords(before);
            const first = tidy[0];
            const last = tidy[tidy.length - 1];
            const wanted = tidy.filter((p, i) =>
                i === 0 || i === tidy.length - 1 ||
                (distanceM(p, first) >= NODE_CLEAR_M && distanceM(p, last) >= NODE_CLEAR_M)
            );
            if (wanted.length < 2 || wanted.length === before.length) continue;

            // 3.8.2: in 3.8.1 this went through sanitizeSegmentGeometry(),
            // which reported 0 cleaned and kept the reason to itself. Now
            // there are two tries and the outcome is written to the run
            // log: the shape as read, then the same shape with its two end
            // points taken from the end nodes (WME reports node positions
            // and segment ends at slightly different precision).
            const onNodes = wanted.map(p => p.slice());
            const from = asLonLat(getNodeById(segmentEndNodeId(seg, true))?.geometry?.coordinates);
            const to = asLonLat(getNodeById(segmentEndNodeId(seg, false))?.geometry?.coordinates);
            if (from) onNodes[0] = from;
            if (to) onNodes[onNodes.length - 1] = to;

            let how = '';
            let error = null;
            for (const [label, coords] of [['as read', wanted], ['end points taken from the nodes', onNodes]]) {
                try {
                    wmeSegments().updateSegment({ segmentId: id, geometry: { type: 'LineString', coordinates: coords } });
                    if (segmentCoords(id).length < before.length) {
                        how = label;
                        break;
                    }
                    error = new Error('WME accepted the call but kept the old shape');
                } catch (e) {
                    error = e;
                }
            }

            if (how) {
                cleaned++;
                runLog.ok(`Cleaned ${id}: ${before.length} -> ${segmentCoords(id).length} points (${how})`);
            } else {
                runLog.fail(
                    `Clean ${id} refused: ${error?.message || error} | ${before.length} points, ${wanted.length} wanted | ` +
                    `shape: ${before.slice(0, 12).map(p => `${p[1].toFixed(7)},${p[0].toFixed(7)}`).join(' ; ')}`
                );
            }
        }
        return cleaned;
    }

    /* ---------------- the build ---------------- */

    async function buildMissingRoads() {
        if (batchRunning) return;
        if (!sdk || !comparisonData || !selectedBounds || !selectedRing) return;

        const items = getBuildQueue();
        if (!items.length) return;

        ui.buildBlock = '';
        if (!areaIsOnScreen()) {
            ui.buildBlock = OFF_SCREEN_MESSAGE;
            render();
            return;
        }

        // Roads that run off screen: say so once, then go ahead on the
        // next press. If the editor moved the map in between and they are
        // all visible now, nothing is cut.
        const extent = ui.extentCheck ? mapExtent() : null;
        const offScreen = extent ? items.filter(item => roadRunsOffScreen(item.osm, extent)).length : 0;
        if (offScreen && !ui.offScreenAsked) {
            const one = offScreen === 1;
            ui.offScreenAsked = true;
            ui.buildBlock =
                `${plural(offScreen, 'road')} ${one ? 'runs' : 'run'} past the edge of the screen. ` +
                'WME can only check the part of the map that is on screen. ' +
                `Move the map until ${one ? 'it is' : 'they are'} fully visible (keep the marked area visible and the zoom at ${ALL_STREETS_ZOOM} or closer), then draw. ` +
                `Or draw now, and ${one ? 'that road stops' : 'those roads stop'} at the edge of the screen.`;
            render();
            return;
        }
        ui.offScreenAsked = false;

        batchRunning = true;
        ui.result = null;
        updateStatus('Preparing...');
        render();

        const bounds = selectedBounds;
        const ring = selectedRing;
        const startedAt = Date.now();
        const stats = {
            created: 0,
            crossings: 0,
            tees: 0,
            splits: 0,
            loopSplits: 0,
            intersections: 0,
            endpointConnections: 0,
            nearMissIntersections: 0,
            propertiesFailed: 0,
            openEnds: 0,
            cutAtScreen: 0,
            skipped: [],
            saveBlockers: [],
            warnings: []
        };
        const memo = { failed: new Set(), unloaded: new Set(), skipNodes: new Set() };
        const skip = (item, reason) => {
            stats.skipped.push(`${item.osm.osmId} (${reason})`);
            skippedOsmIds.add(String(item.osm.osmId));
        };
        const percent = share => `${Math.round(share * 100)}%`;
        const measured = pieces => pieces.map(piece => ({
            piece,
            length: lineLengthM(piece.coords),
            coverage: wayCoverageByExisting(piece)
        }));
        const sumLength = infos => infos.reduce((sum, info) => sum + info.length, 0);
        const sumCovered = infos => infos.reduce((sum, info) => sum + info.coverage * info.length, 0);

        runLog.start('Batch build');
        runLog.add(`Roads to build: ${items.length} | touch existing roads: ${BATCH.TOUCH_EXISTING_ROADS ? 'yes' : 'NO'}`);
        runLog.add(ui.scanInfo
            ? `Scan: OpenStreetMap answered in ${ui.scanInfo.seconds}s from ${ui.scanInfo.host}`
            : 'Scan: no timing recorded');
        runLog.add(
            `Marked area: S ${bounds.south.toFixed(6)} W ${bounds.west.toFixed(6)} N ${bounds.north.toFixed(6)} E ${bounds.east.toFixed(6)} | ` +
            (selectedIsBox ? 'box' : `free shape, ${ring.length} corners`)
        );
        if (!selectedIsBox) {
            runLog.add(`Shape corners: ${ring.map(c => `${c[1].toFixed(6)},${c[0].toFixed(6)}`).join(' | ')}`);
        }
        runLog.add(extent
            ? `Screen:      S ${extent.south.toFixed(6)} W ${extent.west.toFixed(6)} N ${extent.north.toFixed(6)} E ${extent.east.toFixed(6)} | roads running off screen: ${offScreen}`
            : 'Screen: extent not available, roads are not limited to the screen');
        runLog.add(`Unsaved WME edits before run: ${safeCall(() => sdk.Editing.getUnsavedChangesCount())}`);
        runLog.add(`Map center: ${safeCall(() => { const c = sdk.Map.getMapCenter(); return `${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`; })} zoom ${safeCall(() => sdk.Map.getZoomLevel())}`);

        // 3.10.2: the decisions of the scan, one line per OpenStreetMap road
        // (built in scanArea, Section 5)
        runLog.add(`--- scan decisions: ${(comparisonData.report || []).length} OpenStreetMap roads read (footways, paths and steps are never read) ---`);
        (comparisonData.report || []).forEach(line => runLog.add(`  SCAN ${line}`));

        const baselineAudit = auditTopology();
        logAudit('before run', baselineAudit);
        const tracker = startEditTracking();

        // mirror every warning into the log as it is pushed
        const warnPush = stats.warnings.push.bind(stats.warnings);
        stats.warnings.push = (...args) => {
            args.forEach(w => runLog.warn(w));
            return warnPush(...args);
        };

        try {
            existingLegIndexCache = null; // compare against the roads WME has right now
            const ways = [];
            const drawnItems = new Set();

            /* ----- a. decide what part of each road to draw ----- */
            for (const item of items) {
                const road = item.osm;
                const osmId = String(road.osmId);
                const tags = road.tags || {};
                const name = getOsmStreetName(tags) || '-';

                if (!Array.isArray(road.coords) || !Array.isArray(road.nodeIds) || road.coords.length < 2) {
                    skip(item, 'no geometry');
                    runLog.warn(`Skip OSM ${osmId}: no geometry`);
                    continue;
                }
                if (road.nodeIds[0] === road.nodeIds[road.nodeIds.length - 1]) {
                    skip(item, 'closed loop / roundabout: use the WME roundabout tool');
                    runLog.warn(`Skip OSM ${osmId}: closed loop`);
                    continue;
                }

                // 1) does the road belong to the area?
                const area = measureRoadInArea(road, ring);
                if (!area.belongs) {
                    skip(item, `only ${area.insideLength.toFixed(0)} m inside the marked area`);
                    runLog.warn(`Skip OSM ${osmId}: only ${area.insideLength.toFixed(0)} m of ${area.fullLength.toFixed(0)} m inside the marked area`);
                    continue;
                }

                // 2) is its inside part already in WME?
                const insideInfo = measured(area.pieces);
                const insideCovered = sumCovered(insideInfo);
                const insideShare = area.insideLength > 0 ? insideCovered / area.insideLength : 0;

                if (insideShare >= 0.5) {
                    skip(item, `already in WME: ${percent(insideShare)}`);
                    runLog.warn(`Skip OSM ${osmId}: inside part already in WME ${percent(insideShare)}`);
                    continue;
                }

                // 3) what to draw
                let chosen = insideInfo; // fallback: the inside part, cut at the area edge
                let note = '';

                if (!area.entire) {
                    // the road as far as WME can be checked: all of it, or up to the screen edge
                    const offScreenRoad = roadRunsOffScreen(road, extent);
                    let reach = [{ nodeIds: road.nodeIds, coords: road.coords }];
                    if (offScreenRoad) {
                        reach = clipWayToBounds(
                            { osmId: `${osmId}:screen`, nodeIds: road.nodeIds, coords: road.coords },
                            extent
                        ).filter(piece => clipWayToRing(
                            { osmId: `${osmId}:in`, nodeIds: piece.nodeIds, coords: piece.coords },
                            ring
                        ).length > 0);
                    }

                    const reachInfo = measured(reach);
                    const reachLength = sumLength(reachInfo);
                    const outsideLength = reachLength - area.insideLength;
                    const outsideCovered = Math.max(0, sumCovered(reachInfo) - insideCovered);
                    const outsideShare = outsideLength > 1 ? outsideCovered / outsideLength : 0;

                    if (!reachInfo.length) {
                        note = ` (cut at the edge of the marked area; whole road is ${area.fullLength.toFixed(0)}m)`;
                    } else if (outsideShare >= OUTSIDE_COVERED_SHARE) {
                        note = ` (cut at the edge of the marked area; whole road is ${area.fullLength.toFixed(0)}m)`;
                        stats.warnings.push(
                            `OSM way ${osmId}: its part outside the marked area is already in WME (${percent(outsideShare)}), so it was cut at the edge of the area.`
                        );
                    } else {
                        chosen = reachInfo;
                        if (offScreenRoad) {
                            stats.cutAtScreen++;
                            note = ` (drawn up to the edge of the screen; whole road is ${area.fullLength.toFixed(0)}m)`;
                            stats.warnings.push(
                                `OSM way ${osmId} runs past the edge of the screen. It was drawn up to the screen edge (${reachLength.toFixed(0)} m of ${area.fullLength.toFixed(0)} m).`
                            );
                        } else {
                            note = ` (whole road; ${area.insideLength.toFixed(0)}m of it inside the marked area)`;
                        }
                    }
                }

                const parts = [];
                for (const info of chosen) {
                    if (!area.entire && info.length < CLIP_MIN_PIECE_M) {
                        runLog.warn(`Skip part of OSM ${osmId}: only ${info.length.toFixed(0)} m long`);
                        continue;
                    }
                    if (chosen === insideInfo && !area.entire && info.coverage >= 0.5) {
                        runLog.warn(`Skip part of OSM ${osmId}: already in WME ${percent(info.coverage)}`);
                        continue;
                    }
                    if (info.coverage >= 0.15) {
                        stats.warnings.push(
                            `OSM way ${osmId} partly overlaps existing WME roads (${percent(info.coverage)}). Check it.`
                        );
                    }
                    parts.push(info.piece);
                }

                if (!parts.length) {
                    skip(item, 'nothing left to draw');
                    runLog.warn(`Skip OSM ${osmId}: nothing left to draw`);
                    continue;
                }

                // a way cut into several pieces: "id", "id~2", "id~3"...
                parts.forEach((part, index) => {
                    const way = {
                        osmId: index === 0 ? osmId : `${osmId}~${index + 1}`,
                        nodeIds: part.nodeIds,
                        coords: part.coords,
                        tags,
                        item
                    };
                    ways.push(way);
                    runLog.add(
                        `Way OSM ${way.osmId} "${name}" highway=${tags.highway || '-'} ` +
                        `nodes=${way.nodeIds.length} len=${lineLengthM(way.coords).toFixed(0)}m${note}`
                    );
                });
                drawnItems.add(osmId);
            }

            if (!ways.length) throw new Error('Nothing is left to draw: every road was skipped.');

            /* ----- b. roads -> lines ----- */
            const network = buildBatchNetwork(ways, stats.warnings);
            runLog.add(`Network: ${network.edges.length} edges, ${network.strokes.length} lines`);
            network.strokes.forEach(s => {
                runLog.add(`  line ${s.index + 1}: ${s.list.map(i => `${network.ways[network.edges[i.edge].wayIndex].osmId}${i.reversed ? '(r)' : ''}`).join(' > ')} | ${s.coords.length} pts`);
            });

            updateStatus(`Drawing <b>${network.strokes.length}</b> road lines for <b>${drawnItems.size}</b> OSM roads...`);
            await sleep(0);

            /* ----- c. draw every line as one segment ----- */
            const stamp = Date.now();
            for (const stroke of network.strokes) {
                try {
                    const id = Number(wmeSegments().addSegment({
                        geometry: { type: 'LineString', coordinates: cleanLineCoords(stroke.coords) },
                        roadType: BATCH.BASE_ROAD_TYPE
                    }));
                    if (!Number.isFinite(id)) throw new Error('WME returned no segment id.');
                    stroke.key = `batch-${stamp}-${stroke.index}`;
                    stroke.owner = {
                        segmentId: id,
                        segmentIds: [id],
                        osmId: null,
                        batch: true,
                        createdAt: new Date().toISOString(),
                        propertiesApplied: false
                    };
                    createdWmeSegments.set(stroke.key, stroke.owner);
                    stats.created++;
                    runLog.ok(`addSegment line ${stroke.index + 1} -> WME ${id}`);

                    // every road in this line is drawn now, also a short one
                    // that will not get a segment of its own
                    for (const item of stroke.list) {
                        const way = network.ways[network.edges[item.edge].wayIndex];
                        drawnOsmIds.add(String(way.osmId).split('~')[0]);
                    }
                } catch (error) {
                    stats.warnings.push(`Line ${stroke.index + 1} could not be drawn: ${error?.message || error}`);
                }
            }

            /* ----- d, e. junctions between the new roads ----- */
            updateStatus('Connecting the new roads to each other...');
            await sleep(0);
            runLog.add('--- junctions between new roads ---');
            splitLinesJoinedAtBothEnds(network, stats);
            runBatchJunctions(network, stats, memo);
            runLog.add(`Result: X crossings ${stats.crossings}, T junctions ${stats.tees}, property splits ${stats.splits}`);
            reportUnjoinedPlaces(network, stats);

            /* ----- f. one owner per OSM way from here on ----- */
            rekeyBatchOwners(network);

            /* ----- g. loops ----- */
            runLog.add('--- loops ---');
            fixTwoSegmentLoops(stats);
            runLog.add(`Nodes added to loops: ${stats.loopSplits}`);

            /* ----- h. existing roads ----- */
            if (BATCH.TOUCH_EXISTING_ROADS) {
                updateStatus('Connecting the new roads to existing WME roads...');
                await sleep(0);
                runLog.add('--- junctions with existing roads ---');
                connectToExistingSafely(network, stats, memo); // 3.10.0: replaces batchConnectToExisting (Section 7h)
                runLog.add(`Result: crossings ${stats.intersections}, end connections ${stats.endpointConnections}`);
            } else {
                runLog.add('--- existing roads: NOT touched (connect manually) ---');
                logOpenEndsNearExisting(network, stats);
            }
            pruneCreatedSegmentIds();

            /* ----- i. properties ----- */
            updateStatus('Applying road properties (type, direction, speed, name, city)...');
            await sleep(0);
            runLog.add('--- properties ---');
            await applyBatchProperties(network, stats);
            runLog.add(`Properties applied; failures: ${stats.propertiesFailed}`);

            if (memo.unloaded.size) {
                stats.warnings.push(
                    `Not fully loaded: ${[...memo.unloaded].join(', ')}. Zoom out so both ends of these roads are visible.`
                );
            }

            /* ----- j. checks ----- */
            runLog.add('--- clean-up ---');
            runLog.add(`Segments tidied (duplicate points, points beside a junction): ${cleanCreatedGeometry()}`);
            const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
            tracker.stop();
            const freshIssues = logAudit('after run', auditTopology(), baselineAudit);
            if (freshIssues.length) {
                repairBrokenNewSegments(freshIssues, stats);
                logAudit('after repair', auditTopology(), baselineAudit);
            }

            const geometry = auditCreatedGeometry();
            stats.saveBlockers = geometry.issues;
            runLog.add(
                `Geometry check on new roads: ${geometry.issues.length} problems | ` +
                `largest gap between a segment end and its node: ${geometry.largestGap.toFixed(2)} m | ` +
                `shape points closer than 0.5 m to a junction: ${geometry.closeShapePoints}`
            );
            geometry.issues.slice(0, 40).forEach(issue => runLog.add(`  GEOM ${issue}`));

            runLog.add(`=== done in ${seconds}s | unsaved edits now: ${safeCall(() => sdk.Editing.getUnsavedChangesCount())} ===`);

            ui.result = {
                ok: true,
                seconds,
                wayCount: drawnItems.size,
                touchExisting: BATCH.TOUCH_EXISTING_ROADS,
                stats
            };

            log('Batch build result:', stats);
            log('Run log:\n' + runLog.text());
        } catch (error) {
            console.error(`[${SCRIPT_NAME}] Batch build failed`, error);
            try { tracker.stop(); } catch (e) { /* ignore */ }
            runLog.fail(`Batch build failed: ${error?.message || error}`);
            ui.result = {
                ok: false,
                message: error?.message || String(error),
                stats
            };
        } finally {
            batchRunning = false;
            updateStatus('');
            render();
        }
    }

// ████████████████████████  SECTION 9 — SELECT  ████████████████████████

    /* ================================================================
       SECTION 9 — SELECT: marking the area on the map

       PURPOSE   Let the editor mark the area, store it, and keep its
                 outline visible.
       USES      Sections 1, 2, 4; Section 5 (scanArea starts as soon as
                 the area is marked); Section 10 (render).
       USED BY   Section 10 (the "Mark area" / "Change area" / "Cancel"
                 buttons; areaSizeText).

       HOW MARKING WORKS
         A temporary overlay covers the map and takes the mouse.
           drag ............ a box
           clicks .......... a free shape, one corner per click; close
                             it with a double-click, a click on the
                             first corner, or Enter
           Backspace ....... removes the last corner
           Esc ............. cancels
         The corners are screen positions; finishSelection() turns them
         into lon/lat and stores
           selectedRing    the shape, [[lon, lat], ...]
           selectedBounds  the box around it
           selectedIsBox   true for a dragged box

       TWO OUTLINES, ON PURPOSE
         1. A real WME map layer (drawAreaOnMap): drawn by WME from the
            stored coordinates, so it shows where the area REALLY is
            whatever happens to the pixel maths. A line, not a polygon,
            so it never sits between the mouse and the roads (D17).
         2. A dashed SVG outline on top of the page (showAreaOutline):
            sharper to look at; repositioned every animation frame from
            the same coordinates.
         If the two ever disagree, the pixel conversion is wrong (D16).

       CHANGES TO THIS SECTION
         3.8.0  created by the restructure (code unchanged).
       ================================================================ */

    let selectionCleanup = null; // removes the overlay and its listeners while marking

    function startSelection() {
        if (!sdk || batchRunning) return;
        cancelSelection();

        ui.selecting = true;
        ui.areaError = '';

        const rect = mapRect();
        const overlay = document.createElement('div');
        overlay.id = 'wmb-select-overlay';
        Object.assign(overlay.style, {
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`
        });
        overlay.innerHTML =
            '<div class="wmb-select-hint"></div>' +
            '<div class="wmb-select-box"></div>' +
            '<svg class="wmb-select-svg"><polyline class="wmb-select-line"></polyline><g class="wmb-select-dots"></g></svg>';
        document.body.appendChild(overlay);

        const hint = overlay.querySelector('.wmb-select-hint');
        const box = overlay.querySelector('.wmb-select-box');
        const line = overlay.querySelector('.wmb-select-line');
        const dots = overlay.querySelector('.wmb-select-dots');

        const corners = [];      // corners of the free shape so far (screen positions)
        let down = null;         // where the mouse button went down
        let dragging = false;    // a box is being dragged
        let cursor = null;       // last mouse position, for the rubber band
        let lastClick = { at: 0, x: 0, y: 0 };

        const clamp = event => ({
            x: Math.max(rect.left, Math.min(rect.left + rect.width, event.clientX)),
            y: Math.max(rect.top, Math.min(rect.top + rect.height, event.clientY))
        });

        const redraw = () => {
            const chain = cursor && corners.length ? [...corners, cursor] : corners;
            line.setAttribute('points', chain.map(p => `${p.x - rect.left},${p.y - rect.top}`).join(' '));
            dots.innerHTML = corners.map((p, i) =>
                `<circle cx="${p.x - rect.left}" cy="${p.y - rect.top}" r="${i === 0 ? 6 : 3.5}"${i === 0 ? ' class="is-first"' : ''}></circle>`
            ).join('');
            hint.textContent = corners.length
                ? 'Click to add corners. Double-click, or click the first corner, to close the shape. Backspace removes the last corner.'
                : 'Drag for a box, or click corners for a free shape. Esc cancels.';
        };

        const drawBox = (a, b) => {
            box.style.display = 'block';
            box.style.left = `${Math.min(a.x, b.x) - rect.left}px`;
            box.style.top = `${Math.min(a.y, b.y) - rect.top}px`;
            box.style.width = `${Math.abs(b.x - a.x)}px`;
            box.style.height = `${Math.abs(b.y - a.y)}px`;
        };

        const closeShape = () => {
            if (corners.length >= 3) finishSelection(corners.slice(), false);
        };

        const onDown = event => {
            if (event.button !== 0) return;
            down = clamp(event);
            dragging = false;
            event.preventDefault();
        };

        const onMove = event => {
            const p = clamp(event);
            if (down && !corners.length) {
                // a drag only starts a box when no free shape is under way
                if (dragging || Math.hypot(p.x - down.x, p.y - down.y) > 6) {
                    dragging = true;
                    drawBox(down, p);
                }
            } else {
                cursor = p;
                redraw();
            }
            if (down) event.preventDefault();
        };

        const onUp = event => {
            if (!down || event.button !== 0) return;
            const p = clamp(event);
            const from = down;
            down = null;

            if (dragging) {
                dragging = false;
                finishSelection([from, { x: p.x, y: from.y }, p, { x: from.x, y: p.y }], true);
                return;
            }

            // a click
            const now = Date.now();
            const isDouble = now - lastClick.at < 350 && Math.hypot(p.x - lastClick.x, p.y - lastClick.y) < 6;
            lastClick = { at: now, x: p.x, y: p.y };

            const onFirst = corners.length >= 3 &&
                Math.hypot(p.x - corners[0].x, p.y - corners[0].y) <= 10;

            if ((isDouble || onFirst) && corners.length >= 3) {
                closeShape();
                return;
            }
            if (isDouble) return; // second half of a double-click with too few corners

            corners.push(p);
            cursor = p;
            redraw();
        };

        const onKey = event => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                event.preventDefault();
                cancelSelection();
            } else if (event.key === 'Enter') {
                event.stopPropagation();
                event.preventDefault();
                closeShape();
            } else if (event.key === 'Backspace') {
                event.stopPropagation();
                event.preventDefault();
                corners.pop();
                redraw();
            }
        };

        const onContext = event => event.preventDefault();

        overlay.addEventListener('mousedown', onDown);
        overlay.addEventListener('contextmenu', onContext);
        window.addEventListener('mousemove', onMove, true);
        window.addEventListener('mouseup', onUp, true);
        window.addEventListener('keydown', onKey, true);

        selectionCleanup = () => {
            window.removeEventListener('mousemove', onMove, true);
            window.removeEventListener('mouseup', onUp, true);
            window.removeEventListener('keydown', onKey, true);
            overlay.remove();
        };

        redraw();
        render();
    }

    function cancelSelection() {
        if (selectionCleanup) {
            selectionCleanup();
            selectionCleanup = null;
        }
        if (ui.selecting) {
            ui.selecting = false;
            render();
        }
    }

    // screenCorners: the corners of the area as screen positions { x, y }.
    function finishSelection(screenCorners, isBox) {
        const lonLat = screenCorners.map(p => clientToLonLat(p.x, p.y));
        cancelSelection();

        if (lonLat.some(p => !p)) {
            ui.areaError = 'The map could not read that selection. Mark the area again.';
            render();
            return;
        }

        if (!isBox && shapeCrossesItself(screenCorners)) {
            ui.areaError = 'That shape crosses itself. Mark it again without crossing lines.';
            render();
            return;
        }

        const ring = lonLat.map(p => [p.lon, p.lat]);
        const lons = ring.map(c => c[0]);
        const lats = ring.map(c => c[1]);
        const bounds = {
            south: Math.min(...lats),
            north: Math.max(...lats),
            west: Math.min(...lons),
            east: Math.max(...lons)
        };

        if (bounds.north - bounds.south < 0.00001 || bounds.east - bounds.west < 0.00001) {
            ui.areaError = 'That area is too small. Mark a bigger one.';
            render();
            return;
        }

        ui.areaError = '';
        selectedRing = ring;
        selectedBounds = bounds;
        selectedIsBox = !!isBox;

        // The area was just drawn on screen, so the SDK extent must contain
        // it. If it does not, the extent is not what we expect: stop using it.
        const extent = mapExtent();
        ui.extentCheck = !!extent && extentContains(extent, selectedBounds);

        drawAreaOnMap();
        showAreaOutline();
        // 3.9.0: marking an area no longer starts the scan by itself. The
        // panel waits (state 'ready') until the editor presses the scan
        // button, or marks the area again.
        //
        // 3.9.1: 3.9.0 ended this function with calls that do not exist in
        // this file (the panel is redrawn by render(), and there is no
        // ui.state). It stopped here with an error and the panel went on
        // showing what it showed before: "Mark area" on a first marking,
        // and the size of the previous area on a later one.
        // What scanArea() used to clear when it started on its own is
        // cleared here instead, so the result of the previous area can
        // never be drawn into the new one.
        ui.scanToken++;            // a scan still running for the old area is ignored
        ui.scanning = false;
        ui.scanError = '';
        ui.scanInfo = null;
        ui.buildBlock = '';
        ui.offScreenAsked = false;
        ui.result = null;
        comparisonData = null;
        skippedOsmIds.clear();
        drawnOsmIds.clear();
        updateStatus('');
        render();
    }

    // "1.2 km wide, 800 m tall", shown in the panel.
    function areaSizeText() {
        const b = selectedBounds;
        const midLat = (b.south + b.north) / 2;
        const width = distanceMeters(midLat, b.west, midLat, b.east);
        const height = distanceMeters(b.south, b.west, b.north, b.west);
        const fmt = m => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
        const size = `${fmt(width)} wide, ${fmt(height)} tall`;
        return selectedIsBox ? size : `Free shape with ${selectedRing.length} corners, ${size}`;
    }

    /* ---------------- outline 1: a real map layer ---------------- */

    let areaLayerReady = false;

    function drawAreaOnMap() {
        if (!sdk || !selectedRing) return;
        try {
            if (!areaLayerReady) {
                sdk.Map.addLayer({
                    layerName: AREA_LAYER,
                    styleRules: [{
                        style: {
                            strokeColor: '#e8a200',
                            strokeWidth: 6,
                            strokeOpacity: 0.45,
                            fillOpacity: 0
                        }
                    }]
                });
                areaLayerReady = true;
            }

            sdk.Map.removeAllFeaturesFromLayer({ layerName: AREA_LAYER });
            sdk.Map.addFeatureToLayer({
                layerName: AREA_LAYER,
                feature: {
                    id: 'wmb-area',
                    type: 'Feature',
                    properties: {},
                    geometry: {
                        type: 'LineString',
                        coordinates: [...selectedRing, selectedRing[0]]
                    }
                }
            });
        } catch (error) {
            log('Area map layer unavailable:', error);
        }
    }

    /* ---------------- outline 2: dashed line on top of the page ---------------- */

    let areaLayer = null;   // the page element
    let areaShape = null;   // its <polygon>
    let areaFrame = 0;      // id of the running animation frame loop
    let areaLastCss = '';   // last position written, to skip frames where nothing moved

    function showAreaOutline() {
        if (!areaLayer) {
            areaLayer = document.createElement('div');
            areaLayer.id = 'wmb-area-layer';
            areaLayer.innerHTML = '<svg><polygon></polygon></svg>';
            areaShape = areaLayer.querySelector('polygon');
            document.body.appendChild(areaLayer);
        }
        areaLastCss = '';
        if (!areaFrame) {
            const tick = () => {
                positionAreaOutline();
                areaFrame = requestAnimationFrame(tick);
            };
            areaFrame = requestAnimationFrame(tick);
        }
    }

    function positionAreaOutline() {
        if (!areaLayer || !areaShape || !selectedRing || !sdk) return;
        try {
            const rect = mapRect();
            const points = [];
            for (const corner of selectedRing) {
                const pixel = sdk.Map.getPixelFromLonLat({ lonLat: { lon: corner[0], lat: corner[1] } });
                if (!pixel || !Number.isFinite(pixel.x) || !Number.isFinite(pixel.y)) return;
                // SDK pixels are window coordinates; the shape lives inside a
                // layer that sits on the visible map, hence the subtraction.
                points.push(`${Math.round(pixel.x - rect.left)},${Math.round(pixel.y - rect.top)}`);
            }

            const frame = [rect.left, rect.top, rect.width, rect.height].map(Math.round);
            const css = `${frame.join(',')}|${points.join(' ')}`;
            if (css === areaLastCss) return;
            areaLastCss = css;

            areaLayer.style.left = `${frame[0]}px`;
            areaLayer.style.top = `${frame[1]}px`;
            areaLayer.style.width = `${frame[2]}px`;
            areaLayer.style.height = `${frame[3]}px`;
            areaShape.setAttribute('points', points.join(' '));
        } catch (error) { /* map not ready for this frame */ }
    }

// ████████████████████████  SECTION 10 — UI  ████████████████████████

    /* ================================================================
       SECTION 10 — UI: the panel

       PURPOSE   Everything the editor sees and clicks, except the map
                 overlay (Section 9) and the colours (Section 11).
       USES      Section 1 (ui and the other shared state), Section 2
                 (escapeHtml, plural, settings, hostOf), Section 3
                 (normalizeCustomOverpassUrl, getCustomOverpassUrl),
                 Section 5 (counts and the build queue), Section 8
                 (runLog, buildMissingRoads), Section 9 (startSelection,
                 cancelSelection, areaSizeText).
       USED BY   every section that reports progress (updateStatus) or
                 changes what the panel should show (render).

       HOW THE PANEL WORKS
- The panel is three steps: Mark the area / Find missing
           roads / Draw the roads. Each step has a content box that is
           REBUILT from scratch by its render function (renderArea,
           renderScan, renderBuild) out of the shared state. Nothing
           is patched in place, so to change what a step shows, change
           its render function.
- Other sections never touch the panel's HTML. They change the
           state (mostly the `ui` object in Section 1) and call
           render().
- Buttons carry data-act="..."; ONE click listener on the
           panel (in createUI) looks the action up in a switch. To add
           a button: add buttonHtml('my-act', ...) in a render function
           and a case 'my-act' in that switch.
- A new on/off option: keep its value in Section 1 (and in
           saveSettings if it should survive a reload), draw it in a
           render function, handle its change in createUI.
- updateStatus(html) is the one-line progress text shown while
           a scan or a build is running.
- Every text from outside (road names, error messages) goes
           through escapeHtml before it is put into HTML.

       CHANGES TO THIS SECTION
         3.8.0   created by the restructure (code unchanged).
         3.12.0  added the NextGIS / custom Overpass API input box and
                 Save / Clear controls in Step 2 (renderScan, createUI).
       ================================================================ */

    /* ---------------- small HTML builders ---------------- */

    function updateStatus(html) {
        ui.status = html || '';
        const element = document.getElementById('wmb-status');
        if (element) element.innerHTML = ui.status;
    }

    function progressHtml() {
        return `<div class="wmb-progress" id="wmb-status" role="status">${ui.status || 'Working...'}</div>`;
    }

    // kind: 'wmb-primary' (the big green one) or 'wmb-quiet'.
    function buttonHtml(act, label, kind, disabled) {
        return `<button type="button" class="wmb-btn ${kind}" data-act="${act}"${disabled ? ' disabled' : ''}>${escapeHtml(label)}</button>`;
    }

    // rows: [[label, value], ...] -> a small two-column list.
    function factsHtml(rows) {
        return '<div class="wmb-facts">' +
            rows.map(([label, value]) =>
                `<div class="wmb-fact"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`
            ).join('') +
            '</div>';
    }

    // A collapsed list ("12 warnings") that opens on click.
    function listHtml(summary, lines, limit) {
        // 3.8.2: a line that names a place ("30.916134, 30.303991", the
        // "lat, lon" written by fmtPoint) gets a Show button that moves the
        // map there. If the line also names a segment, that segment is
        // selected. The click is handled in createUI (case 'goto').
        const showButton = line => {
            const place = String(line).match(/(-?\d{1,2}\.\d{5,7}),\s*(-?\d{1,3}\.\d{5,7})/);
            if (!place) return '';
            const segment = String(line).match(/segment (-?\d+)/i);
            return ' <button type="button" class="wmb-btn wmb-quiet" data-act="goto" ' +
                `data-lat="${place[1]}" data-lon="${place[2]}"${segment ? ` data-segment="${segment[1]}"` : ''} ` +
                'style="display:inline-block;padding:1px 7px;font-size:11px">Show</button>';
        };
        const shown = lines.slice(0, limit).map(line => `<div>${escapeHtml(line)}${showButton(line)}</div>`).join('');
        const more = lines.length > limit
            ? `<div>${lines.length - limit} more in the run log.</div>`
            : '';
        return `<details class="wmb-more"><summary>${escapeHtml(summary)}</summary>` +
            `<div class="wmb-more-list">${shown}${more}</div></details>`;
    }

    /* ---------------- the step rail ---------------- */

    // state: 'done' | 'active' | 'locked'
    function setStep(id, state, busy) {
        const element = document.getElementById(id);
        if (!element) return;
        element.classList.toggle('is-done', state === 'done');
        element.classList.toggle('is-active', state === 'active');
        element.classList.toggle('is-locked', state === 'locked');
        element.classList.toggle('is-busy', !!busy);
    }

    function isScanned() {
        return !!comparisonData && !ui.scanning && !ui.scanError;
    }

    function updateSteps() {
        const hasArea = !!selectedBounds;
        const scanned = isScanned();
        const built = !!ui.result?.ok && !getBuildQueue().length;

        setStep('wmb-step-area', hasArea ? 'done' : 'active', false);
        setStep('wmb-step-scan', !hasArea ? 'locked' : (scanned ? 'done' : 'active'), ui.scanning);
        setStep('wmb-step-build', !scanned ? 'locked' : (built ? 'done' : 'active'), batchRunning);
    }

    /* ---------------- step 1: mark the area ---------------- */

    function renderArea() {
        const element = document.getElementById('wmb-area-content');
        if (!element) return;

        let html = '';

        if (ui.sdkError) {
            html = `<p class="wmb-error">${escapeHtml(ui.sdkError)}</p>`;
        } else if (!sdk) {
            html = '<p class="wmb-muted">Waiting for the editor to finish loading.</p>';
        } else if (ui.selecting) {
            html = '<p>Drag for a box, or click corners for a free shape. Esc cancels.</p>' +
                buttonHtml('cancel-select', 'Cancel', 'wmb-quiet', false);
        } else {
            if (ui.areaError) html += `<p class="wmb-error">${escapeHtml(ui.areaError)}</p>`;
            if (!selectedBounds) {
                html += '<p class="wmb-muted">Zoom in until the streets are visible, then mark the part of the map you want filled in: drag for a box, or click corners for a free shape.</p>' +
                    buttonHtml('select', 'Mark area', 'wmb-primary', false);
            } else {
                html += `<p>${escapeHtml(areaSizeText())}</p>` +
                    buttonHtml('select', 'Change area', 'wmb-quiet', batchRunning);
            }
        }

        element.innerHTML = html;
    }

    /* ---------------- step 2: find missing roads ---------------- */

    function customApiHtml() {
        const saved = getCustomOverpassUrl();
        const activeHost = saved ? hostOf(saved) : '';
        const disabled = ui.scanning || batchRunning;

        let html = '<div class="wmb-api-box">' +
            '<div class="wmb-api-head">' +
            '<span>NextGIS / custom Overpass API</span>' +
            (activeHost ? `<span class="wmb-api-badge" title="${escapeHtml(activeHost)}">Active</span>` : '') +
            '</div>' +
            '<div class="wmb-api-row">' +
            `<input type="password" class="wmb-input" id="wmb-custom-api" placeholder="NextGIS Overpass URL or API key" value="${escapeHtml(saved)}" autocomplete="off" spellcheck="false"${disabled ? ' disabled' : ''}>` +
            buttonHtml('save-api', 'Save', 'wmb-quiet', disabled) +
            (saved ? buttonHtml('clear-api', 'Clear', 'wmb-quiet', disabled) : '') +
            '</div>';

        if (ui.apiError) {
            html += `<p class="wmb-error" style="font-size:11px;margin-top:4px">${escapeHtml(ui.apiError)}</p>`;
        } else if (activeHost) {
            html += `<p class="wmb-muted" style="font-size:11px;margin-top:4px">Using ${escapeHtml(activeHost)} first.</p>`;
        }

        return html + '</div>';
    }

    function renderScan() {
        const element = document.getElementById('wmb-scan-content');
        if (!element) return;

        let html = '';

        if (!selectedBounds) {
            html = '<p class="wmb-muted">Compares OpenStreetMap with WME inside the area. Press Start once the area is marked.</p>' +
                customApiHtml();
        } else if (ui.scanning) {
            html = progressHtml();
        } else if (ui.scanError) {
            html = `<p class="wmb-error">${escapeHtml(ui.scanError)}</p>` +
                buttonHtml('scan', 'Scan again', 'wmb-quiet', false) +
                customApiHtml();
        } else if (!comparisonData) {
            // 3.10.1: the button is called Start (the scan has not started
            // on its own since 3.9.0)
            html = buttonHtml('scan', 'Start', 'wmb-primary', batchRunning) +
                customApiHtml();
        } else {
            const missing = comparisonData.roads.missing.length;
            const matched = comparisonData.roads.matched.length;

            html += `<p><b>${missing}</b> ${missing === 1 ? 'road' : 'roads'} inside the area ${missing === 1 ? 'is' : 'are'} missing from WME.</p>`;

            const rows = [];
            if (matched) rows.push(['Already in WME', matched]);
            if (comparisonData.touching) rows.push(['Outside the area or only touching it', comparisonData.touching]);
            if (comparisonData.loops) rows.push(['Closed loops, left for the roundabout tool', comparisonData.loops]);
            if (rows.length) html += factsHtml(rows);

            if (ui.scanInfo) {
                html += `<p class="wmb-muted">OpenStreetMap answered in ${escapeHtml(ui.scanInfo.seconds)} s from ${escapeHtml(ui.scanInfo.host)}.</p>`;
            }

            if (ui.scanZoom != null && ui.scanZoom < ALL_STREETS_ZOOM) {
                html += `<p class="wmb-warn">The map was at zoom ${ui.scanZoom} for this scan. WME loads every street only from zoom ${ALL_STREETS_ZOOM}, so streets that already exist may be counted as missing. Zoom in and scan again.</p>`;
            }

            // one chip per OSM road type; unticking leaves that type out
            const counts = new Map();
            for (const item of remainingMissing()) {
                const key = highwayOf(item);
                counts.set(key, (counts.get(key) || 0) + 1);
            }

            if (counts.size) {
                const chips = [...counts.entries()]
                    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                    .map(([key, count]) => {
                        const on = !excludedHighways.has(key);
                        return `<label class="wmb-chip${on ? '' : ' is-off'}">` +
                            `<input type="checkbox" data-highway="${escapeHtml(key)}"${on ? ' checked' : ''}${batchRunning ? ' disabled' : ''}>` +
                            `<span>${escapeHtml(key.replace(/_/g, ' '))}</span><b>${count}</b></label>`;
                    })
                    .join('');
                html += '<p class="wmb-muted">Untick a type to leave it out.</p>' +
                    `<div class="wmb-chips">${chips}</div>`;
            }

            html += buttonHtml('scan', 'Scan again', 'wmb-quiet', batchRunning) +
                customApiHtml();
        }

        element.innerHTML = html;
    }

    /* ---------------- step 3: draw the roads ---------------- */

    // The summary of the last build (ui.result, written by Section 8).
    function resultHtml(result) {
        const stats = result.stats || {};
        const skipped = stats.skipped || [];
        const warnings = stats.warnings || [];
        const blockers = stats.saveBlockers || [];
        const copy = buttonHtml('copy-log', 'Copy run log', 'wmb-quiet', false);
        let html = '<div class="wmb-result wmb-stack">';

        if (!result.ok) {
            html += `<p class="wmb-error">The build stopped: ${escapeHtml(result.message)}</p>`;
            if (stats.created) {
                html += '<p class="wmb-muted">Roads drawn before it stopped are unsaved edits. Undo them in WME if they look wrong.</p>';
            }
            if (skipped.length) html += listHtml(`${plural(skipped.length, 'road')} skipped`, skipped, 60);
            if (warnings.length) html += listHtml(plural(warnings.length, 'warning'), warnings, 60);
            return html + copy + '</div>';
        }

        html += `<p><b>Drew ${plural(result.wayCount, 'road')}</b> in ${escapeHtml(result.seconds)} s. Nothing is saved yet.</p>`;

        const facts = [
            ['Crossings', stats.crossings],
            ['T-junctions', stats.tees],
            ['Splits where properties change', stats.splits]
        ];
        if (stats.loopSplits) facts.push(['Extra nodes added', stats.loopSplits]);
        if (result.touchExisting) {
            facts.push(['Crossings with existing roads', stats.intersections]);
            facts.push(['Ends joined to existing roads', stats.endpointConnections]);
        } else {
            facts.push(['Open ends beside existing roads', stats.openEnds || 0]);
        }
        if (stats.cutAtScreen) facts.push(['Roads stopped at the edge of the screen', stats.cutAtScreen]);
        if (stats.propertiesFailed) facts.push(['Properties that failed', stats.propertiesFailed]);

        html += factsHtml(facts);

        if (blockers.length) {
            html += `<p class="wmb-warn">${plural(blockers.length, 'problem')} found on the new roads. ` +
                `${blockers.length === 1 ? 'It' : 'Each one'} will probably stop the save, so fix or delete ` +
                `${blockers.length === 1 ? 'that segment' : 'those segments'} first.</p>` +
                listHtml('Where the problems are', blockers, 60);
        }

        if (!result.touchExisting && stats.openEnds) {
            html += '<p class="wmb-muted">Existing roads are left untouched. Join those ends by hand. The run log gives the spot for each one.</p>';
        }

        if (skipped.length) html += listHtml(`${plural(skipped.length, 'road')} skipped`, skipped, 60);
        if (warnings.length) html += listHtml(plural(warnings.length, 'warning'), warnings, 60);

        html += copy + '<p class="wmb-muted">Check the map, then press Save in WME, or undo.</p>';
        return html + '</div>';
    }

    function renderBuild() {
        const element = document.getElementById('wmb-build-content');
        if (!element) return;

        let html = '';

        if (batchRunning) {
            html = progressHtml();
        } else {
            const scanned = isScanned();
            const queue = scanned ? getBuildQueue() : [];

            if (ui.result) html += resultHtml(ui.result);

            if (!scanned) {
                if (!ui.result) {
                    html += '<p class="wmb-muted">Draws every missing road, joins the new roads to each other, and fills in type, direction, speed, name and city.</p>';
                }
            } else if (queue.length) {
                if (ui.buildBlock) html += `<p class="wmb-warn">${escapeHtml(ui.buildBlock)}</p>`;
                const label = ui.offScreenAsked
                    ? `Draw ${plural(queue.length, 'road')} now`
                    : `Draw ${plural(queue.length, 'road')}`;
                html += buttonHtml('build', label, 'wmb-primary', false);
                // 3.10.0: the switch for joining to existing roads. Off by
                // default and remembered in the browser. The click is handled
                // in createUI (case 'touch-existing'); the value is read by
                // BATCH.TOUCH_EXISTING_ROADS when Draw is pressed.
                html += '<label class="wmb-muted" style="display:flex;gap:6px;align-items:flex-start;cursor:pointer">' +
                    '<input type="checkbox" data-act="touch-existing" style="margin:2px 0 0;flex:0 0 auto"' +
                    `${BATCH.TOUCH_EXISTING_ROADS ? ' checked' : ''}>` +
                    '<span>Also join the new roads to existing roads (experimental). An existing road is only split ' +
                    'where a new road meets it. It is never retyped or shortened. Two small things can change on it: a dead end that touches a new road ' +
                    'is moved onto that road (less than 1 m), and a shape point left right beside a new junction is removed.</span></label>';
                if (!ui.result && !ui.buildBlock) {
                    html += '<p class="wmb-muted">Each road is drawn to its end, also past the edge of the area, as far as the screen shows it. Nothing is saved until you press Save in WME.</p>';
                }
            } else if (!ui.result) {
                html += remainingMissing().length
                    ? '<p class="wmb-muted">Every road type is unticked, so there is nothing to draw.</p>'
                    : '<p class="wmb-muted">Nothing to draw. Every OpenStreetMap road inside the area is already in WME.</p>';
            }
        }

        element.innerHTML = html;
    }

    // Rebuilds the whole panel from the current state. Cheap; call it
    // after any change of state.
    function render() {
        if (!document.getElementById('wmb-panel')) return;
        try {
            renderArea();
            renderScan();
            renderBuild();
            updateSteps();
        } catch (error) {
            console.error(`[${SCRIPT_NAME}] render failed`, error);
        }
    }

    /* ---------------- run log: copy button and fallback window ---------------- */

    function copyRunLog(button) {
        const text = runLog.text() || 'No build has run yet.';
        const done = () => {
            if (!button) return;
            button.textContent = 'Copied';
            setTimeout(() => {
                if (document.body.contains(button)) button.textContent = 'Copy run log';
            }, 1600);
        };
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(() => showRunLog());
        } else {
            showRunLog();
        }
    }

    // Shown when the browser does not allow writing to the clipboard.
    function showRunLog() {
        let box = document.getElementById('wmb-log-box');
        if (!box) {
            box = document.createElement('div');
            box.id = 'wmb-log-box';
            box.innerHTML = `
                <div class="wmb-log-head">
                    <span>Run log. Select all with Ctrl+A, then copy.</span>
                    <button type="button" id="wmb-log-close" aria-label="Close run log">×</button>
                </div>
                <textarea id="wmb-log-text" readonly></textarea>
            `;
            document.body.appendChild(box);
            document.getElementById('wmb-log-close').addEventListener('click', () => box.remove());
        }
        const textarea = document.getElementById('wmb-log-text');
        textarea.value = runLog.text() || 'No build has run yet.';
        textarea.focus();
        textarea.select();
    }

    /* ---------------- building the panel ---------------- */

    function stepHtml(id, title, contentId) {
        return `
            <div class="wmb-step" id="${id}">
                <div class="wmb-node"></div>
                <div class="wmb-step-main">
                    <div class="wmb-step-title">${title}</div>
                    <div class="wmb-step-content wmb-stack" id="${contentId}"></div>
                </div>
            </div>
        `;
    }

    // Keeps the panel reachable: never fully outside the window.
    function placePanel(panel, left, top) {
        const maxLeft = Math.max(0, window.innerWidth - 60);
        const maxTop = Math.max(0, window.innerHeight - 36);
        panel.style.left = `${Math.min(maxLeft, Math.max(0, left))}px`;
        panel.style.top = `${Math.min(maxTop, Math.max(0, top))}px`;
        panel.style.right = 'auto';
    }

    function setMinimized(panel, minimized) {
        panel.classList.toggle('is-min', minimized);
        const button = panel.querySelector('#wmb-min');
        if (button) {
            button.textContent = minimized ? '+' : '–';
            button.title = minimized ? 'Open panel' : 'Minimize panel';
            button.setAttribute('aria-expanded', String(!minimized));
        }
    }

    // Creates the panel once and wires its three listeners: clicks on
    // buttons, changes of the road-type chips, dragging by the header.
    function createUI() {
        if (document.getElementById('wmb-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'wmb-panel';
        panel.innerHTML = `
            <div class="wmb-head" id="wmb-head">
                <span class="wmb-title">WMEgypt Map Build <span class="wmb-ver">${escapeHtml(SCRIPT_VERSION)}</span></span>
                <button type="button" class="wmb-icon-btn" id="wmb-min" data-act="minimize" title="Minimize panel">–</button>
            </div>
            <div class="wmb-body" id="wmb-body">
                ${stepHtml('wmb-step-area', 'Mark the area', 'wmb-area-content')}
                ${stepHtml('wmb-step-scan', 'Find missing roads', 'wmb-scan-content')}
                ${stepHtml('wmb-step-build', 'Draw the roads', 'wmb-build-content')}
            </div>
        `;
        document.body.appendChild(panel);

        const settings = loadSettings();
        if (Number.isFinite(settings.left) && Number.isFinite(settings.top)) {
            placePanel(panel, settings.left, settings.top);
        }
        setMinimized(panel, !!settings.minimized);

        const commitCustomApiInput = (silentEmpty = false) => {
            const input = panel.querySelector('#wmb-custom-api');
            if (!input) return true;
            const raw = input.value.trim();
            if (!raw && silentEmpty) return true;
            const normalized = normalizeCustomOverpassUrl(raw);
            if (normalized === null) {
                ui.apiError = 'Enter a valid NextGIS Overpass URL or API key.';
                renderScan();
                return false;
            }
            const prev = getCustomOverpassUrl();
            ui.apiError = '';
            saveSettings({ customOverpass: normalized });
            if (normalized !== prev) forceFreshOsm = true;
            return true;
        };

        // every button: data-act -> action
        panel.addEventListener('click', event => {
            const button = event.target.closest?.('[data-act]');
            if (!button || button.disabled) return;

            switch (button.dataset.act) {
                case 'minimize': {
                    const minimized = !panel.classList.contains('is-min');
                    setMinimized(panel, minimized);
                    saveSettings({ minimized });
                    break;
                }
                case 'select': startSelection(); break;
                case 'cancel-select': cancelSelection(); break;
                case 'save-api':
                    if (commitCustomApiInput(false)) renderScan();
                    break;
                case 'clear-api':
                    ui.apiError = '';
                    saveSettings({ customOverpass: '' });
                    renderScan();
                    break;
                // 3.9.0: the first scan after marking (state 'ready') may use
                // the cached OpenStreetMap answer; "Scan again" and "Try
                // again" always ask OpenStreetMap.
                // 3.9.1: 3.9.0 tested ui.state here, which this file does not
                // have, so "Scan again" never asked OpenStreetMap again. A
                // scan is a repeat when there is already a result or an error.
                case 'scan':
                    if (!commitCustomApiInput(true)) break;
                    forceFreshOsm = !!comparisonData || !!ui.scanError;
                    scanArea();
                    break;
                // 3.9.0: the "also join to existing roads" switch. Its box is
                // not in the panel yet; the value is read by
                // BATCH.TOUCH_EXISTING_ROADS (Section 1).
                // 3.9.1: reads the box that was clicked (there is no ui.panel).
                case 'touch-existing':
                    try {
                        localStorage.setItem('wmb-touch-existing', button.checked ? '1' : '0');
                    } catch (error) {
                        log('The switch could not be stored:', error);
                    }
                    break;
                case 'build': buildMissingRoads(); break;
                case 'copy-log': copyRunLog(button); break;
                case 'goto': {
                    // 3.8.2: the Show button of a warning / problem line
                    // (built in listHtml). Moves the map to the place and
                    // selects the segment when the line named one.
                    const lat = Number(button.dataset.lat);
                    const lon = Number(button.dataset.lon);
                    const id = Number(button.dataset.segment);
                    let moved = false;
                    try {
                        sdk.Map.setMapCenter({ lonLat: { lat, lon }, zoomLevel: 20 });
                        moved = true;
                    } catch (error) {
                        log('setMapCenter failed:', error);
                        try {
                            const d = 0.0004;
                            sdk.Map.zoomToExtent({ bbox: [lon - d, lat - d, lon + d, lat + d] });
                            moved = true;
                        } catch (error2) {
                            log('zoomToExtent failed:', error2);
                        }
                    }
                    if (button.dataset.segment) {
                        // after the map has settled
                        setTimeout(() => {
                            if (!liveSegment(id)) return;
                            try {
                                sdk.Editing.setSelection({ selection: { ids: [id], objectType: 'segment' } });
                            } catch (error) {
                                log('setSelection failed:', error);
                            }
                        }, 700);
                    }
                    button.textContent = moved ? 'Shown' : 'Could not move the map';
                    break;
                }
                default: break;
            }
        });

        panel.addEventListener('keydown', event => {
            if (event.key === 'Enter' && event.target?.id === 'wmb-custom-api') {
                event.preventDefault();
                if (commitCustomApiInput(false)) renderScan();
            }
        });

        // the road-type chips
        panel.addEventListener('change', event => {
            const input = event.target;
            if (!input?.matches?.('input[data-highway]')) return;
            const key = input.dataset.highway;
            if (input.checked) excludedHighways.delete(key);
            else excludedHighways.add(key);
            input.closest('.wmb-chip')?.classList.toggle('is-off', !input.checked);
            renderBuild();
            updateSteps();
        });

        // drag by the header
        const head = panel.querySelector('#wmb-head');
        let drag = null;

        head.addEventListener('mousedown', event => {
            if (event.button !== 0 || event.target.closest('button')) return;
            const rect = panel.getBoundingClientRect();
            drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
            event.preventDefault();
        });

        window.addEventListener('mousemove', event => {
            if (!drag) return;
            placePanel(panel, event.clientX - drag.dx, event.clientY - drag.dy);
        }, true);

        window.addEventListener('mouseup', () => {
            if (!drag) return;
            drag = null;
            const rect = panel.getBoundingClientRect();
            saveSettings({ left: Math.round(rect.left), top: Math.round(rect.top) });
        }, true);
    }

// ████████████████████████  SECTION 11 — STYLE  ████████████████████████

    /* ================================================================
       SECTION 11 — STYLE: colours and layout

       PURPOSE   One function, injectCSS(), that adds the stylesheet.
       USES      nothing.
       USED BY   Section 12 (init).
       NOTES     * Palette: road-sign green for actions and finished
                   steps, lane amber for the marked area and warnings.
                   The step rail is drawn like a road: dashed where
                   nothing is done yet, solid once it is. To recolour
                   the panel, change the --wmb-* variables at the top.
- Every rule starts with one of the script's own ids
                   (#wmb-panel, #wmb-log-box, #wmb-select-overlay,
                   #wmb-area-layer) so that nothing leaks into WME's own
                   page and WME's styles do not leak in.
- The colour of the map layer outline is not here: it
                   is set where the layer is created (Section 9,
                   drawAreaOnMap).
- z-index order: area outline 999970 < selection
                   overlay 999980 < panel 999990 < log window 1000020.

       CHANGES TO THIS SECTION
         3.8.0  created by the restructure (code unchanged).
         3.12.0 added styles for .wmb-api-box and .wmb-input (NextGIS /
                custom Overpass endpoint field).
       ================================================================ */

    function injectCSS() {
        if (document.getElementById('wmb-style')) return;

        const style = document.createElement('style');
        style.id = 'wmb-style';
        style.textContent = `
            #wmb-panel, #wmb-log-box, #wmb-select-overlay, #wmb-area-layer {
                --wmb-sheet: #ffffff;
                --wmb-verge: #f0f4f2;
                --wmb-kerb: #d2dadd;
                --wmb-ink: #17242b;
                --wmb-asphalt: #586770;
                --wmb-sign: #0a6e55;
                --wmb-sign-deep: #075341;
                --wmb-amber: #e8a200;
                --wmb-amber-ink: #7a5200;
                --wmb-stop: #b3261e;
                direction: ltr;
                text-align: left;
                font-family: Rubik, "Segoe UI", system-ui, -apple-system, sans-serif;
            }
            #wmb-panel, #wmb-panel *, #wmb-log-box, #wmb-log-box * { box-sizing: border-box; }

            #wmb-panel {
                position: fixed; top: 64px; right: 16px; z-index: 999990;
                width: 300px; max-height: calc(100vh - 80px);
                display: flex; flex-direction: column;
                background: var(--wmb-sheet); color: var(--wmb-ink);
                border: 1px solid var(--wmb-kerb); border-radius: 10px;
                box-shadow: 0 8px 26px rgba(23, 36, 43, .24);
                font-size: 13px; line-height: 1.45;
            }
            #wmb-panel.is-min { width: auto; }
            #wmb-panel.is-min .wmb-body { display: none; }

            #wmb-panel .wmb-head {
                flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 16px;
                padding: 8px 8px 8px 14px; cursor: move; user-select: none;
                border-bottom: 1px solid var(--wmb-kerb);
            }
            #wmb-panel.is-min .wmb-head { border-bottom: 0; }
            #wmb-panel .wmb-title { font-size: 14px; font-weight: 600; letter-spacing: .01em; }
            #wmb-panel .wmb-ver {
                margin-left: 4px; color: var(--wmb-asphalt); font-size: 11px; font-weight: 400;
                font-variant-numeric: tabular-nums;
            }
            #wmb-panel .wmb-icon-btn {
                appearance: none; margin: 0; padding: 0; width: 26px; height: 26px;
                border: 0; border-radius: 6px; background: transparent; color: var(--wmb-asphalt);
                font: inherit; font-size: 17px; line-height: 1; cursor: pointer;
            }
            #wmb-panel .wmb-icon-btn:hover { background: var(--wmb-verge); color: var(--wmb-ink); }

            #wmb-panel .wmb-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 16px 14px; }

            /* step rail */
            #wmb-panel .wmb-step {
                position: relative; display: grid; grid-template-columns: 14px minmax(0, 1fr);
                column-gap: 12px; padding-bottom: 18px;
            }
            #wmb-panel .wmb-step:last-child { padding-bottom: 0; }
            #wmb-panel .wmb-step::before {
                content: ''; position: absolute; left: 6px; top: 19px; bottom: -1px;
                border-left: 2px dashed var(--wmb-kerb);
            }
            #wmb-panel .wmb-step:last-child::before { display: none; }
            #wmb-panel .wmb-step.is-done::before { border-left: 2px solid var(--wmb-sign); }
            #wmb-panel .wmb-node {
                position: relative; z-index: 1; width: 14px; height: 14px; margin-top: 3px;
                border: 2px solid var(--wmb-kerb); border-radius: 50%; background: var(--wmb-sheet);
            }
            #wmb-panel .wmb-step.is-active .wmb-node { border-color: var(--wmb-sign); }
            #wmb-panel .wmb-step.is-done .wmb-node { border-color: var(--wmb-sign); background: var(--wmb-sign); }
            #wmb-panel .wmb-step.is-busy .wmb-node {
                border-color: var(--wmb-amber); background: var(--wmb-amber);
                animation: wmb-pulse 1.2s ease-out infinite;
            }
            @keyframes wmb-pulse {
                0% { box-shadow: 0 0 0 0 rgba(232, 162, 0, .55); }
                100% { box-shadow: 0 0 0 9px rgba(232, 162, 0, 0); }
            }
            @media (prefers-reduced-motion: reduce) {
                #wmb-panel .wmb-step.is-busy .wmb-node { animation: none; }
            }

            #wmb-panel .wmb-step-title { font-size: 13px; font-weight: 600; line-height: 20px; }
            #wmb-panel .wmb-step.is-locked .wmb-step-title { color: var(--wmb-asphalt); font-weight: 500; }
            #wmb-panel .wmb-step-content { margin-top: 4px; }

            #wmb-panel .wmb-stack > * { margin: 0; }
            #wmb-panel .wmb-stack > * + * { margin-top: 8px; }
            #wmb-panel p { margin: 0; font-size: 13px; }
            #wmb-panel b { font-weight: 600; font-variant-numeric: tabular-nums; }
            #wmb-panel .wmb-muted { color: var(--wmb-asphalt); font-size: 12px; }
            #wmb-panel .wmb-error { color: var(--wmb-stop); overflow-wrap: anywhere; }
            #wmb-panel .wmb-warn {
                padding: 7px 9px; border-left: 3px solid var(--wmb-amber);
                background: #fdf6e3; color: var(--wmb-amber-ink); font-size: 12px; border-radius: 0 6px 6px 0;
            }

            #wmb-panel .wmb-progress { color: var(--wmb-ink); font-size: 12px; overflow-wrap: anywhere; }
            #wmb-panel .wmb-progress small { display: block; color: var(--wmb-asphalt); font-size: 11px; }

            /* buttons */
            #wmb-panel .wmb-btn {
                appearance: none; display: block; margin-left: 0; margin-right: 0;
                border-radius: 7px; font: inherit; font-size: 13px; line-height: 1.2;
                cursor: pointer; text-align: center; text-transform: none; letter-spacing: 0;
            }
            #wmb-panel .wmb-btn.wmb-primary {
                width: 100%; padding: 9px 12px; border: 1px solid var(--wmb-sign);
                background: var(--wmb-sign); color: #fff; font-weight: 600;
            }
            #wmb-panel .wmb-btn.wmb-primary:hover:not(:disabled) { background: var(--wmb-sign-deep); border-color: var(--wmb-sign-deep); }
            #wmb-panel .wmb-btn.wmb-quiet {
                padding: 5px 10px; border: 1px solid var(--wmb-kerb);
                background: var(--wmb-sheet); color: var(--wmb-ink); font-weight: 500;
            }
            #wmb-panel .wmb-btn.wmb-quiet:hover:not(:disabled) { background: var(--wmb-verge); }
            #wmb-panel .wmb-btn:disabled { opacity: .45; cursor: not-allowed; }
            #wmb-panel .wmb-btn:focus-visible,
            #wmb-panel .wmb-icon-btn:focus-visible,
            #wmb-panel .wmb-chip input:focus-visible,
            #wmb-panel .wmb-input:focus-visible,
            #wmb-panel summary:focus-visible { outline: 2px solid var(--wmb-amber); outline-offset: 2px; }

            /* custom NextGIS / Overpass API box */
            #wmb-panel .wmb-api-box {
                padding: 7px 8px; border: 1px solid var(--wmb-kerb); border-radius: 7px;
                background: var(--wmb-verge);
            }
            #wmb-panel .wmb-api-head {
                display: flex; align-items: center; justify-content: space-between; gap: 6px;
                margin-bottom: 5px; font-size: 11px; font-weight: 600; color: var(--wmb-asphalt);
            }
            #wmb-panel .wmb-api-badge {
                padding: 1px 6px; border-radius: 999px; background: var(--wmb-sign);
                color: #fff; font-size: 10px; font-weight: 600;
            }
            #wmb-panel .wmb-api-row { display: flex; align-items: center; gap: 4px; }
            #wmb-panel .wmb-input {
                flex: 1 1 auto; min-width: 0; padding: 5px 7px;
                border: 1px solid var(--wmb-kerb); border-radius: 6px;
                background: var(--wmb-sheet); color: var(--wmb-ink);
                font: inherit; font-size: 11px; line-height: 1.2;
            }
            #wmb-panel .wmb-api-row .wmb-btn.wmb-quiet { padding: 5px 7px; font-size: 11px; flex: 0 0 auto; }

            /* road-type chips */
            #wmb-panel .wmb-chips { display: flex; flex-wrap: wrap; gap: 5px; }
            #wmb-panel .wmb-chip {
                display: inline-flex; align-items: center; gap: 6px; margin: 0; padding: 3px 9px 3px 6px;
                border: 1px solid var(--wmb-kerb); border-radius: 999px; background: var(--wmb-sheet);
                color: var(--wmb-ink); font-size: 12px; font-weight: 400; line-height: 18px; cursor: pointer;
            }
            #wmb-panel .wmb-chip input { margin: 0; width: 13px; height: 13px; accent-color: var(--wmb-sign); cursor: pointer; }
            #wmb-panel .wmb-chip.is-off { background: var(--wmb-verge); color: var(--wmb-asphalt); }
            #wmb-panel .wmb-chip.is-off span { text-decoration: line-through; }

            /* facts and result */
            #wmb-panel .wmb-result { padding-bottom: 2px; }
            #wmb-panel .wmb-fact {
                display: flex; justify-content: space-between; gap: 12px; padding: 4px 0;
                border-bottom: 1px solid var(--wmb-verge); font-size: 12px;
            }
            #wmb-panel .wmb-fact:last-child { border-bottom: 0; }
            #wmb-panel .wmb-fact span { color: var(--wmb-asphalt); }
            #wmb-panel .wmb-more { font-size: 12px; }
            #wmb-panel .wmb-more summary { display: list-item; cursor: pointer; color: var(--wmb-ink); font-weight: 500; }
            #wmb-panel .wmb-more-list {
                max-height: 150px; overflow-y: auto; margin-top: 6px; padding: 7px 9px;
                background: var(--wmb-verge); border-radius: 6px; color: var(--wmb-asphalt); overflow-wrap: anywhere;
            }
            #wmb-panel .wmb-more-list div + div { margin-top: 5px; }

            /* selection overlay */
            #wmb-select-overlay {
                position: fixed; z-index: 999980; cursor: crosshair; background: rgba(23, 36, 43, .12);
            }
            #wmb-select-overlay .wmb-select-hint {
                position: absolute; top: 14px; left: 50%; transform: translateX(-50%);
                max-width: 80%; padding: 7px 14px; border-radius: 7px; background: var(--wmb-ink); color: #fff;
                font-size: 13px; line-height: 1.4; text-align: center; pointer-events: none;
            }
            #wmb-select-overlay .wmb-select-box {
                position: absolute; display: none; box-sizing: border-box; pointer-events: none;
                border: 2px dashed var(--wmb-amber); background: rgba(232, 162, 0, .16);
            }
            #wmb-select-overlay .wmb-select-svg {
                position: absolute; left: 0; top: 0; width: 100%; height: 100%;
                overflow: visible; pointer-events: none;
            }
            #wmb-select-overlay .wmb-select-line {
                fill: rgba(232, 162, 0, .16); stroke: var(--wmb-amber); stroke-width: 2; stroke-dasharray: 7 5;
            }
            #wmb-select-overlay .wmb-select-dots circle { fill: #fff; stroke: var(--wmb-ink); stroke-width: 1.5; }
            #wmb-select-overlay .wmb-select-dots circle.is-first { fill: var(--wmb-amber); }

            /* outline of the marked area */
            #wmb-area-layer { position: fixed; z-index: 999970; overflow: hidden; pointer-events: none; }
            #wmb-area-layer svg { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; }
            #wmb-area-layer polygon {
                fill: none; stroke: var(--wmb-amber); stroke-width: 2; stroke-dasharray: 7 5;
                filter: drop-shadow(0 0 1px rgba(23, 36, 43, .9));
            }

            /* run log window */
            #wmb-log-box {
                position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 1000020;
                width: 720px; max-width: 95vw; height: 70vh; display: flex; flex-direction: column;
                background: var(--wmb-sheet); color: var(--wmb-ink); border: 1px solid var(--wmb-kerb);
                border-radius: 10px; box-shadow: 0 12px 40px rgba(23, 36, 43, .35); font-size: 13px;
            }
            #wmb-log-box .wmb-log-head {
                display: flex; justify-content: space-between; align-items: center;
                padding: 9px 9px 9px 14px; font-weight: 600; border-bottom: 1px solid var(--wmb-kerb);
            }
            #wmb-log-box .wmb-log-head button {
                appearance: none; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px;
                background: transparent; color: var(--wmb-asphalt); font-size: 20px; line-height: 1; cursor: pointer;
            }
            #wmb-log-box .wmb-log-head button:hover { background: var(--wmb-verge); color: var(--wmb-ink); }
            #wmb-log-text {
                flex: 1 1 auto; margin: 10px; padding: 8px; resize: none; white-space: pre;
                background: var(--wmb-verge); color: var(--wmb-ink); border: 1px solid var(--wmb-kerb);
                border-radius: 6px; font-family: Consolas, "Courier New", monospace; font-size: 11px;
            }
        `;

        document.head.appendChild(style);
    }

// ████████████████████████  SECTION 12 — START  ████████████████████████

    /* ================================================================
       SECTION 12 — START

       PURPOSE   The only code that runs when the file loads. Everything
                 above only declares things.
       ORDER     CSS and panel first, so the editor sees the panel at
                 once (it says "Waiting for the editor..."); then the
                 SDK, which can take a while on a slow page.
       NOTES     The closing "})();" of the whole script is the last
                 line of this section. Keep it last.

       CHANGES TO THIS SECTION
         3.8.0  created by the restructure. The check that the two old
                halves of the script matched is gone with the halves.
       ================================================================ */

    async function init() {
        log(`Starting v${SCRIPT_VERSION}...`);

        restorePreferredOverpassServer();
        injectCSS();
        createUI();
        render();

        try {
            await initSDK();
        } catch (error) {
            console.error(`[${SCRIPT_NAME}] SDK error`, error);
            ui.sdkError = `The editor's script interface did not load: ${error?.message || error} Reload the page.`;
        }

        render();
    }

    init();
})();
