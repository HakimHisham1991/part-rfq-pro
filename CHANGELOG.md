# Changelog

All notable changes to **3D Part Analyzer** are documented in this file.

---

## [1.21.4] - 2026-07-27

### Fixed

- **Viewer failed to load (`Unexpected end of input`):** `isHolePlugsActive()` was missing its closing brace after the Plug Holes UI work.

---

## [1.21.3] - 2026-07-27

### Changed

- **Hole plugging is now manual:** Detect Holes no longer auto-prepares Body 2. New **Plug Holes** and **Clear Hole Plugs** buttons sit below Detect Holes.
- **Detect Pockets** requires Plug Holes to be active; attempting it while plugs are inactive shows a warning.
- **Clear Hole Plugs** confirms that all Pocket Detection data will be reset, then restores Body 1.

### Fixed

- **Mobile hole lists:** Detected Holes and Hole Groups sections were too short on Android (45vh panel cap). Expanded panel height and gave both lists a usable min-height.

---

## [1.21.2] - 2026-07-23

### Fixed

- **Hole plugs no longer stub far past the mouth:** plugs are placed from the opening into the bore with only a ~0.25 mm overhang (previously mid-centered on the opening with `depth + radius` height, which left a long protrusion on one side).
- **Step / counterbore plugging:** holes are processed smallest-radius first; within a step feature each cylinder stage is fused small → large.
- **Countersink / counterdrill defeature:** cylinder faces are removed first, the solid is healed, then the cone is removed in a second pass.
- **Hole 3D display:** detected holes render as solid simplified cylinders (not open wall tubes); row selection tints the full cylinder volume red.

---

## [1.21.1] - 2026-07-23

### Fixed

- **Hole plugging on milled parts:** `BRepAlgoAPI_Defeaturing` was failing on every hole (warning “N hole(s) could not be plugged”). Body 2 prep now fills bores by fusing cylindrical plugs (defeaturing kept as a fast path / last resort).
- **Convex hull subtraction returned 0 pockets:** faceted hull faces coincide with the part so the boolean cut collapsed. Now expands the hull slightly for the cut, then keeps only mesh triangles inside the tight hull and clusters them into cavities.
- **Slicing returned 0 pockets:** section results are edge compounds without wires. Contours are now chained from sampled edge endpoints into closed loops.
- **User-hinted “floor face(s) not found on Body 2 AAG”:** AAG/`hashCode` used upper bound `1<<30` while `meshShape` faceGroups use `2147483647`, so picked face hashes never matched. Unified on `OCCT_HASH_UPPER = 2147483647`.

---

## [1.21.0] - 2026-07-22

### Added

- **Pocket detection methods (hole-plugged Body 2 gate):** Pocket detection now requires Hole Detection first. Detected holes are plugged on a duplicate solid (Body 2); the viewer swaps to Body 2 automatically. Four methods in one panel:
  - **AAG Face Walk** (default) — existing floor-anchored recognizer on Body 2
  - **Convex Hull Subtraction** — QuickHull of Body 2 minus the solid; per-cavity volume/depth
  - **Slicing-Based (2.5D)** — section loops along one axis with floor bisection
  - **User-Hinted** — select floor → detect/select walls → axis → Calculate → add to table
- New modules: `pocket-state.js`, `pocket-body-preparation.js` (wired), `pocket-detection-pipeline.js`, `pocket-hull-subtraction.js`, `pocket-slicing.js`, `pocket-user-hinted.js`, `brep-sew-utils.js`; vendored `quickhull3d.bundle.js`.

---

## [1.20.12] - 2026-07-22

### Fixed

- **MonsterASP: all `/lib/*` URLs returned 404 (three.js / OCCT WASM unreachable, STEP import broken).** The `<location path="lib">` cache-header section in `web.config` made IIS intercept `/lib/*` and answer 404 itself instead of forwarding to the app. Removed the section; `/lib` cache headers are already set by the app in `Program.cs`.

---

## [1.20.11] - 2026-07-21

### Changed

- **Manual-only MonsterASP deployment:** GitHub Actions no longer deploys (build verification only — Web Deploy step and secrets removed from `deploy.yml`). `publish.bat` no longer creates a zip; it publishes to `publish_clean` and prints the manual zip → FTP → unzip → restart checklist. Deploy docs updated with the correct server folder layout.

---

## [1.20.10] - 2026-07-21

### Fixed

- **MonsterASP: "Failed to fetch …/step-analyzer.js" when adding STEP in Cycle Time:** live site had `lib/` nested under `wwwroot/wwwroot/lib` (FTP unzip one level too deep), so `/lib/three.module.min.js` 404'd and the module import failed. App now also serves `/lib` from that nested folder when the correct path is missing. Prefer fixing the server layout: move `wwwroot/wwwroot/lib` → `wwwroot/lib`.

---

## [1.20.9] - 2026-07-21

### Fixed

- **MonsterASP: Edit Cycle Time stuck on "Loading…":** ES modules often finish after `DOMContentLoaded` on slower hosts, so init never ran. All page modules now use `onDomReady` (runs immediately if the document is already ready). Cycle Time no longer eagerly imports THREE/`step-analyzer` (lazy-load only when a 3D model is analyzed).
- **MonsterASP: Open STEP loads nothing:** removed `?v=` query strings from `/lib` and `.wasm` URLs (breaks OCCT/Emscripten on some IIS hosts). Worker JS cache-bust kept for `/js` only.
- **MonsterASP FTP unzip "Unable to extract /Data/machines-master.json":** `publish.bat` now builds the zip with forward-slash entry names; checklist requires stopping the app pool before extract (running site locks `Data/*.json`).

---

## [1.20.8] - 2026-07-20

### Fixed

- **Open STEP / STP dead after MonsterASP FTP deploy:** file picker is wired in HTML + early in `viewer.js` (before WebGL init). `/lib` assets no longer use year-long `immutable` cache (was locking corrupt/partial `three.js` after FTP). Lib imports are cache-busted with `?v=1.20.8`. `publish.bat` now builds `publish_clean.zip` with files at zip root (not nested) and verifies `viewer.js` / `three.module.min.js`.

---

## [1.20.7] - 2026-07-20

### Changed

- **Detected Pockets table:** removed the Shape column (table and CSV). Columns are now Name | Max Bounded Size | Max Depth | Max Bounded Volume.

---

## [1.20.6] - 2026-07-20

### Fixed

- **Pocket plug solids empty in browser:** `analyzeStepFileFeatures` returned `recognizeFeaturesFromAag(...)` without `await`, so `finally { occt.releaseSince(mark) }` freed all B-Rep face handles while pocket recognition was still running. `outerWire`/`extrude` then threw, leaving no `plugMesh` and falling back to inflated face-center footprint sizes (e.g. 71×83 mm / 59k mm³ instead of ~54×72 / 20k). Hard-reload after updating; worker cache-bust is now `?v=1.20.6`.

---

## [1.20.5] - 2026-07-18

### Fixed

- **Stale worker code in browser:** `brep-feature-worker.js` and its module imports (`brep-feature-recognition.js`, `brep-pocket-recognition.js`) are now cache-busted with `?v=` — pocket fixes since v1.20.0 never reached users with a cached worker, which is why plugs rendered as offset boxes/slabs.
- **Circular misclassification:** broken floors whose wall walk reaches only blends/bores were labeled *Circular* and squared-up to `max × max` (e.g. 140.75 × 140.75). Circular now requires a genuine round floor (torus + cylinder); others stay *Irregular* with true in-plane extents.
- **Corner pockets dropped by hole exclusion:** when the wall walk hit a recognized hole wall it was silently skipped, leaving zero rim/patch edges and rejecting the pocket. Hole walls crossing a pocket are now recorded as patch openings — the four Ø17.93 filleted corner pockets on `CNC-milling-7.stp` are detected again (8 pockets total, plugged-body volumes within ~3% of NX for the two rectangular pockets).

---

## [1.20.4] - 2026-07-18

### Changed

- **Plugged-body volume (NX-style):** Max Bounded Volume is the OCCT solid from the floor **outer wire** extruded to depth (inner holes patched). Magenta plug mesh follows the real floor contour + radii, not an AABB/rounded-rect fake.
- Circular pocket floors (torus + cylinder) are included; hole-wall faces are still excluded from seeding.

---

## [1.20.3] - 2026-07-18

### Added

- **Pocket table:** Name | Shape | Max Bounded Size | Max Depth | Max Bounded Volume.
- **Max-bounded volume visuals:** rounded floor + corner radii + walls + ceiling (extruded outline), not an AABB wire box.

### Fixed

- **Broken / imperfect pockets:** floors with through-cuts are accepted and patched for size/volume; pocket walls with a single convex rim edge are no longer misclassified as stock (fixes notched walls on `CNC-milling-7.stp`).

---

## [1.20.2] - 2026-07-18

### Fixed

- **Filleted pocket floors:** CNC pockets with floor→fillet G1 blends have only *smooth* edges on the floor (no concave). Floor detection now accepts planar faces enclosed by smooth transitions into non-planar blends; wall walk follows those blends into walls. Verified on `CNC-milling-7.stp` (3 floor-anchored pockets).

---

## [1.20.1] - 2026-07-18

### Fixed

- **Detect Holes / Detect Pockets isolation:** each button runs only its own recognizer and updates only its own results (no cross-fill).
- **Pocket false positives:** through-pocket flood-fill disabled by default; floor candidates allow fillet (smooth) edges; reject part-scale / zero-depth footprints that produced huge green planes and all-`(thru)` lists.

---

## [1.20.0] - 2026-07-18

### Added

- **Pocket Detection (B-Rep AAG):** new collapsible panel below Hole Detection; Detect Pockets runs floor-anchored cavity recognition on the shared AAG. Teal floor + depth outline visuals, list, CSV export, and Clear Pockets.

### Changed

- **Hole Detection & Pocket Detection panels** default to collapsed so the 3D viewer starts wider.

---

## [1.19.3] - 2026-07-18

### Changed

- **Project RFQ — TOTAL HRS REQUIRE:** cell is read-only and auto-calculates as Setup Time + TurnMill + 3X + 4X + 5X (also enforced on save and Excel import).

---

## [1.19.2] - 2026-07-18

### Added

- **3D Analyzer — Perspective toggle:** toolbar button next to Show Floor; default is OFF (orthographic). Active state when perspective is on.
- **Hole Detection panel — Collapse:** header Collapse/Expand control minimizes the panel to the title so the 3D viewer gains width.

### Changed

- **Detection Method:** B-Rep Feature Recognition is always the default selection on page load.

---

## [1.19.1] - 2026-07-18

### Fixed

- **B-Rep hole recognition:** reject pocket-corner fillets (~90° arcs) and degenerate flat “cones” (semi-angle ≈ 90°) that produced dozens of floating false positives; require near-full cylindrical walls (≥300° U-span).
- **Counterbore bridging:** merge coaxial stages when axes coincide and axial spans are adjacent — works with filleted steps (cylinder→torus→plane→cylinder), not only a shared planar annulus.
- **CNC-milling-7.stp:** recognizes 6 real holes (4× Ø10.31/Ø21.8 counterbore + 2× Ø19.11) instead of 61 junk features.

### Changed

- **Detection Method dropdown:** added **B-Rep Feature Recognition (recommended)** as an explicit option; mesh circle-fit methods are labeled “Mesh — …”. RANSAC iterations hide when B-Rep is selected. Hint text clarifies that B-Rep does not use circle fitting.

---

## [1.19.0] - 2026-07-18

### Added

- **3D Analyzer — B-Rep hole feature recognition:** client-side `occt-wasm` pipeline builds an Attributed Adjacency Graph (AAG) from exact STEP B-Rep and recognizes plain / counterbore / countersink / step holes from analytic cylinder/cone faces (Analysis Situs–style), replacing mesh curvature fitting as the primary path.
- **`brep-feature-recognition.js` / `brep-feature-worker.js`:** Web Worker offloads B-Rep import + AAG construction so the UI stays responsive.
- **`THIRD_PARTY_NOTICES.md`:** Analysis Situs BSD-3-Clause attribution for the AAG approach; `occt-wasm` notices.
- **IIS / MonsterASP:** `web.config` + static-file middleware for `.wasm` MIME type and long-cache `/lib` assets.

### Changed

- **Hole detection:** prefers B-Rep AAG recognition when a STEP buffer is available; on failure, automatically falls back to the existing mesh curvature pipeline (`hole-detection.js`).

---

## [1.18.0] - 2026-07-17

### Added

- **3D Analyzer — Mobile touch controls:** 1-finger drag orbit, pinch zoom, 2-finger pan, double-tap fit-to-screen (desktop mouse/keyboard unchanged).
- **3D Analyzer — WebGL context-loss recovery:** listeners + re-init renderer and reload current STEP when the GPU context is lost (common on mid-tier Android).
- **3D Analyzer — Loading spinner + error banner** on the canvas for init/load/WASM failures with Retry.

### Fixed

- **3D Analyzer — Blank canvas on mobile:** container uses `100dvh` / `min-height: 60vh` flex chain so the WebGL canvas no longer collapses to zero height on Chrome Android.
- **3D Analyzer — GPU memory:** cap `devicePixelRatio` at 2 (1 on low-end / Mali mid-tier GPUs like Galaxy A51).
- **3D Analyzer — Resize:** `orientationchange`, `resize`, and visibility handlers plus measured `getBoundingClientRect` sizing.

### Changed

- **Viewport meta:** `viewport-fit=cover` for notched phones.
- **Mobile layout:** stack panels under a full-width canvas; touch-friendly (≥44px) toolbar/side buttons.

---

## [1.17.4] - 2026-07-17

### Added

- **3D Analyzer — Hole tables:** CSV export buttons under Detected Holes and Hole Groups headings.

---

## [1.17.3] - 2026-07-17

### Fixed

- **3D Analyzer — Hole Groups:** clicking a group row now fit-zooms to all related holes. Multi-hole framing used `Box3.expandBySphere`, which this Three.js build does not provide, so the camera never updated.

---

## [1.17.2] - 2026-07-17

### Changed

- **App shell:** module sidebar (Part RFQ Pro / nav) is always force-collapsed on load; can still be expanded for the current session.
- **3D Analyzer layout:** Measurements panel width ×0.75 (146px); Hole Detection panel width ×1.5 (440px).

---

## [1.17.1] - 2026-07-17

### Changed

- **3D Analyzer layout:** removed the redundant toolbar **Detect Holes** button; moved Hole Detection out of Properties into its own left panel (right of Measurements). Measurements is 195px; Hole Detection is 293px with Detected Holes / Hole Groups scrollable below the controls.

---

## [1.17.0] - 2026-07-17

### Added

- **3D Analyzer — Hole Groups:** second summary table that groups detected holes by Unique Diameter and/or Unique Depth (toggle either or both). Click a group row to fit-zoom all related holes and highlight them in light red.

---

## [1.16.9] - 2026-07-17

### Changed

- **3D Analyzer — Detected Holes:** replaced the stacked card list with a compact engineering table (`Name | Diameter | Depth | Quality`); click a row to focus the hole.
- **3D Analyzer:** widened the Measurements / Detected Holes panel from 260px to 390px for easier reading.

---

## [1.16.8] - 2026-07-17

### Fixed

- **Build:** cleared NU1903 high-severity warnings for transitive `SQLitePCLRaw.lib.e_sqlite3` 2.1.11 (GHSA-2m69-gcr7-jv3q / CVE-2025-6965) by upgrading EF Core SQLite packages to 10.0.10 and pinning `SQLitePCLRaw.bundle_e_sqlite3` 3.0.3.

---

## [1.16.7] - 2026-07-17

### Fixed

- **3D Analyzer — Hole Detection:** **Detect Holes** stayed greyed out after selecting surfaces. Button enable state is now tied to whether a part is loaded (not to selection count); with no selection it auto-selects all bodies then runs. Also cache-busted `viewer.js` so the UI change is picked up without a hard refresh.

---

## [1.16.6] - 2026-07-17

### Changed

- **3D Analyzer — Hole Detection:** streamlined the action flow. Removed the redundant **Detect Holes on Whole Part** / **Detect Holes on Selected Surfaces** pair; a single **Detect Holes** button now runs on whatever is currently selected. Workflow: **Select All Bodies** or **Select Surfaces**, then **Detect Holes**.

---

## [1.16.5] - 2026-07-17

### Fixed

- **3D Analyzer — Hole Detection:** wrong diameters and orientations on real sheet-metal parts (e.g. `V5745238620200.stp`). Root causes and fixes:
  - Neighbor search radius was derived from average pairwise distance between face centers (measures part size, not mesh density), producing search radii spanning half the part; replaced with true face adjacency from shared mesh vertices (scale-independent, works for 1 mm rivet holes and 100 mm bores alike).
  - Local axis PCA mixed normals across sharp edges (hole wall ↔ sheet surface), rotating the estimated axis into the sheet plane; neighbors more than ~75° from the seed normal are now excluded.
  - Rejected patches permanently consumed their faces, so a bad early patch could eat a real hole's wall; faces are now only consumed by accepted holes.
  - New validation gates: face normals must point radially inward toward the fitted axis (rejects bosses and curved-sheet false fits), fit RMS must stay under 5% of radius, hole interior must be free of mesh geometry, and the wall must wrap ≥150° around the axis (rejects sheet bends and corner blends).
  - Axis is refined by PCA over centered inlier normals (exact for conical/partial walls) and the circle refit on radially-consistent faces only.
  - Coaxial wall fragments (hole wall broken by an intersecting feature) are grouped and re-evaluated as one hole instead of reporting stray arcs.
  - `smallestEigenvector3x3` now uses a closed-form analytic solution; power iteration converged too slowly when eigenvalues are nearly degenerate (narrow arcs), returning in-plane axes.
  - Duplicate merging now compares centers perpendicular to the hole axis (two fits of the same deep bore sit at different heights) and keeps the best-supported candidate instead of averaging with weaker fits.
- Verified against STEP ground truth: `V5745238620200.stp` reports exactly its 14 drilled holes (radii 1.2 / 2.4 / 3.55 mm, all axes matching the CAD normal), and `PART_STRAIGHT.stp` / `PART_TILTED.stp` report their single bore with axis matching CAD to 3 decimals.

---

## [1.16.4] - 2026-07-17

### Fixed

- **3D Analyzer — Hole Detection:** wrong hole orientation from boundary loops — plane-normal PCA used plain power iteration, which converges to the *largest* eigenvector (an in-plane direction ~90° off the hole axis) instead of the smallest (the true normal). Now iterates on the shifted matrix `(trace·I − M)` via a shared `smallestEigenvector3x3` helper.
- **3D Analyzer — Hole Detection:** `ReferenceError: p is not defined` crash in boundary-hole centroid computation (missing loop braces) that silently discarded *all* detection results on meshes with non-welded face seams.
- **3D Analyzer — Hole Detection:** multiple stray circles at wrong orientations on obstructed holes — local and per-patch cylinder axis estimation replaced neighbor-pair cross products with robust normal-vector PCA, and region-growing thresholds tightened (axis parallelism 0.85 → 0.95, normal perpendicularity 0.4 → 0.25) so intersecting features no longer merge into the cylindrical patch.

---

## [1.16.3] - 2026-07-14

### Added

- **3D Analyzer:** live progress popup when opening STEP files (OCCT load, parse, mesh build, properties).
- **3D Analyzer — Hole Detection:** **Stop** button cancels the running job, terminates the worker, and clears all detection remnants.
- **3D Analyzer — Hole Detection:** settings and actions are greyed out / non-selectable while detection runs; re-enabled when finished or stopped.

---

## [1.16.2] - 2026-07-14

### Added

- **3D Analyzer — Hole Detection:** non-intrusive progress popup with live log and percent bar; **Hide** / **Show Progress** controls.
- **3D Analyzer:** **Show Floor** / **Hide Floor** toolbar toggle for the floor grid (default: hidden).

---

## [1.16.1] - 2026-07-14

### Added

- **3D Analyzer — Hole Detection:** **Select All Bodies** button selects every surface across all mesh bodies.
- **3D Analyzer — Surface selection:** click-and-drag rectangle pick adds all visible faces in the area to the current selection.

---

## [1.16.0] - 2026-07-14

### Added

- **3D Analyzer — Hole Feature Detection:** comprehensive cylindrical hole detection using curvature analysis on OCCT meshes.
- **Circle fitting methods:** RANSAC + Taubin (default), Taubin, Kåsa Least Squares, and Geometric Iterative — selectable in the Properties panel.
- **Adaptive RANSAC** with configurable iterations (50–5000); preference persisted in localStorage.
- **Depth estimation** via point projection along hole axis with raycasting fallback (handles partial/broken surfaces).
- **Surface selection mode:** toggle crosshair cursor, click faces to multi-select, visual highlight overlay, Clear Selection.
- **Detect Holes** toolbar button (next to Reset Measurement); panel actions for whole-part and selected-surface detection.
- **Hole visualization:** semi-transparent cylinders and torus rings aligned to hole axis.
- **Detected Holes sidebar:** list with count badge showing diameter, radius, depth, and fit quality per hole.
- **Add as Drilling Operations:** populates Cycle Time Estimator with grouped Drilling ops (by diameter).
- **Web Worker** offloads heavy detection from the main thread.

---

## [1.15.2] - 2026-06-16

### Fixed

- **Edit Cycle Time:** **Cycle Time to Quote** now correctly applies `ROUNDUP` to 0.1 hr (fixes stale cached formula still rounding to 0.5 hr).

---

## [1.15.1] - 2026-06-16

### Changed

- **Edit Cycle Time:** **Cycle Time to Quote** formula updated to `=ROUNDUP((Total Overall CT),0.1)` (was CEILING to 0.5 hr).

---

## [1.15.0] - 2026-06-16

### Added

- **Project RFQ:** Picture column shows the actual image; **Upload** and **Delete** controls in a web-only column (excluded from export). Supported formats: jpeg, jpg, png, gif, bmp, wmf, tif.
- **Project RFQ:** **Export to CSV** and **Export to TXT** buttons (pipe-separated, same columns as Excel).

### Changed

- **Project RFQ:** Picture path/URL is still included in Excel, CSV, and TXT exports.

---

## [1.14.0] - 2026-06-16

### Added

- **Project Manager:** **Rename** action in the Action column opens a dialog to rename a project.

---

## [1.13.0] - 2026-06-16

### Added

- **Project RFQ:** **Set as Closed** / **Set as Open** button (after **Save**) toggles project status with confirmation; header subtitle and Project Manager table reflect the updated status.

---

## [1.12.0] - 2026-06-16

### Added

- **Project Manager:** **Add Project** button opens a dialog to create a new RFQ project (name, owner, date registered, status).

---

## [1.11.1] - 2026-06-16

### Changed

- **3D Analyzer:** part title now displays as **Part Number:** followed by the value (e.g. `Part Number: 141T1380-31`).

---

## [1.11.0] - 2026-06-16

### Added

- **3D Analyzer:** **Part Number** title above the toolbar (defaults to **Unknown** when not linked to a project part); **Close** button clears the loaded model, measurements, properties, and resets the title to **Unknown** after confirmation.

---

## [1.10.1] - 2026-06-16

### Changed

- **Edit Cycle Time — Other Time Factors:** all eight fields now span the full panel width in equal columns (Load/Unload through Tool Change Time).

---

## [1.10.0] - 2026-06-16

### Added

- **Project RFQ:** **Save** toolbar button to save all part rows at once; **Export to Excel** button to download the current project RFQ table (Action column excluded).

### Changed

- **Project RFQ:** **Action** column moved to the first column (web UI only; not included in Excel export).

---

## [1.9.0] - 2026-06-16

### Added

- **Project RFQ:** all part columns are now inline-editable; changes save automatically when a cell is updated.

### Changed

- REST API: `PUT /api/projects/{projectId}/parts/{partId}` updates full part row data.

---

## [1.8.0] - 2026-06-16

### Added

- **Project RFQ:** **Add Part Number** and **Import from Excel** toolbar buttons; **Delete** action per part with confirmation dialog.
- REST API: create/delete project parts and Excel import (`POST` / `DELETE` / `POST …/import` on `/api/projects/{id}/parts`).

---

## [1.7.6] - 2026-06-16

### Fixed

- **Edit Cycle Time — Other Time Factors:** Axis Types field height now matches neighboring inputs (e.g. Rapid Rate).

---

## [1.7.5] - 2026-06-16

### Changed

- **Edit Cycle Time — Other Time Factors:** toggling back ON now sets **No. of Tool Changes** to **10** (with Generic Machine auto-selected).

---

## [1.7.4] - 2026-06-16

### Added

- **Settings — Machine Profiles:** seeded **Generic Machine** profile (5X, 60,000 mmpm, 30 kW, 1.2 accel/decel, 10 s tool change) listed first in the table.

### Changed

- **Edit Cycle Time — Other Time Factors:** when toggle is OFF, all fields are blank, greyed out, and non-editable; when toggled back ON, **Generic Machine** is auto-selected with its machine-library values.

---

## [1.7.3] - 2026-06-16

### Fixed

- **Edit Cycle Time — Other Time Factors:** Axis Types is now always synced from the selected machine profile (Machine Profile Management) and shown as a read-only value, not an editable field.

---

## [1.7.2] - 2026-06-16

### Fixed

- **Edit Cycle Time — Other Time Factors:** hardened enable/disable toggle (zeros all fields including machine selection when off), blocks edits to machine-library fields, and refreshes cached cycle-time script.

---

## [1.7.1] - 2026-06-16

### Fixed

- **Settings — Machine Profiles:** table headers and row cells now render from one shared column definition so columns stay aligned (including after the Axis Types column was added).

---

## [1.7.0] - 2026-06-16

### Added

- **Settings — Machine Profiles:** **Axis Types** column (2X, 3X, 4X, 5X) after Machine Model; three new seeded models (DMG NVX5100, Mazak VCS430A, Mazak QTN150).
- **Edit Cycle Time — Other Time Factors:** enable/disable toggle; **Axis Types** auto-filled from the selected machine profile.

### Changed

- **Settings — Machine Profiles:** **Machine** column renamed to **Machine Model**.
- **Edit Cycle Time — Other Time Factors:** panel is always expanded (no collapse); **Machine** renamed to **Machine Model**; Rapid Rate, Spindle Power, Accel/Decel Factor, and Tool Change Time are read-only from Machine Library.
- When Other Time Factors toggle is OFF, factor values reset to zero, fields are greyed out, and related cycle-time calculations are excluded.

---

## [1.6.0] - 2026-06-11

### Added

- **Settings — Machine Profiles:** CRUD page for machine profiles (rapid rate, spindle power, accel/decel factor, tool change time) with seeded examples Hartford Aero-426, Mazak VRX i500, and DMU65.
- **Edit Cycle Time — Other Time Factors:** Machine is now a dropdown loaded from Settings; selecting a profile auto-fills rapid rate, spindle power, accel/decel factor, and tool change time used in cycle-time calculations.

---

## [1.5.1] - 2026-06-11

### Added

- **Edit Cycle Time — Raw Material:** **RETRIEVE FROM RFQ** button resets Lraw, Wraw, Traw, and Vraw from the part’s Project RFQ material dimensions.

---

## [1.5.0] - 2026-06-11

### Added

- **Edit Cycle Time — 3D Model section:** Part summary row now includes a 3D Model table (CAD filename link plus ADD, DELETE, EDIT). STEP files are stored per part in IndexedDB; EDIT and the filename link open 3D Analyzer with the model loaded automatically.
- **Edit Cycle Time — RETRIEVE FROM 3D:** Raw Material panel fills Lraw, Wraw, Traw, and Vraw from bounding-box dimensions and raw stock volume; Finish Part panel fills Vfin from part volume. Shows a warning and clears values when no 3D file is linked.

### Changed

- 3D Analyzer persists stock offsets and analysis metrics back to cycle-time data when a part-linked model is loaded or stock is applied.

---

## [1.4.2] - 2026-06-10

### Changed

- **Cycle Time editor**: operations shown in a fixed-column table (No., Name, Type, Ø, ap, ae, F, MRR, V, Area to scan, Profile Length, No. of Holes, CT); columns not used by an operation type are greyed out (N/A).
- Operation parameters unified to table column keys (`ae`, `ap` for drill depth, etc.) with legacy `stepover`/`depth` migration on load.

---

## [1.4.1] - 2026-06-10

### Fixed

- **Startup crash on operation template seed**: escape `{}` in raw SQL `DEFAULT` clause so EF Core `ExecuteSqlRaw` does not treat it as a format placeholder.

---

## [1.4.0] - 2026-06-10

### Added

- **Operation-based cycle time estimation**: each machining step is a named operation with its own parameters and cycle time; total CT is the sum of all operations plus other time factors.
- **Operation types**: Face Milling, Roughing, Pocketing, Profiling, Slotting, Drilling, Reaming, Tapping, Ballnose Finishing, Engraving, and Manual Operation.
- **Operation Template Management** (Settings): CRUD for reusable templates with default parameters; 13 seed templates (face mill, roughing, drill, ballnose, etc.).
- Cycle Time editor quick-add buttons: **+ Add Drill**, **+ Add Ballnose**, **+ Add Face Mill**, **+ Add Roughing**, and generic **+ Add Operation**.
- Automatic migration of legacy volume-based cycle time data (v1) to the new operation-based format (v2) on load.

### Changed

- Cycle Time editor UI replaced flat volume-split spreadsheet with an ordered operations list, per-operation parameter fields, and collapsible other-time factors.
- Cycle time API payload extended to support v2 (`operations`, `other`, `computed`) while retaining v1 compatibility.

---

## [1.3.2] - 2026-05-29

### Fixed

- **MonsterASP / shared hosting**: disable HTTPS redirection and HSTS in Production; enable forwarded headers and session cookie `SameAsRequest` (fixes HTTP 400 behind IIS SSL termination).
- Added `/Error` page for production exception handler.
- `publish.bat` verifies `Data/material-specs-master.json` is included in upload.

---

## [1.3.1] - 2026-05-29

### Changed

- Material spec master seed **Created By** set to **Admin** (replaces `MASTER - MATERIAL SPEC.xlsx`; existing rows updated on startup).

---

## [1.3.0] - 2026-05-29

### Added

- **Material Specification Management** master data: **171** specifications loaded from `MASTER - MATERIAL SPEC.xlsx` (`Data/material-specs-master.json`), applied on startup when the table does not match the master set.

### Changed

- Material spec table column renamed to **Density kg/m³**; density values show as numbers only (no unit suffix in cells).
- Edit modal density label aligned to **Density kg/m³**.

---

## [1.2.2] - 2026-05-29

### Fixed

- Settings action toolbar: added top padding so **Add User** / **Add Material Specification** no longer sit against the header divider.

---

## [1.2.1] - 2026-05-29

### Fixed

- **Material Specification Management** page crash (`IHttpContextAccessor` not registered); page model now uses `PageModel.HttpContext`.
- Settings **Add User** / **Add Material Specification** toolbar moved below the page title (above the table).

---

## [1.2.0] - 2026-05-29

### Added

- **User Management**: **Add User** toolbar button; **Edit** and **Delete** in the Action column; modal dialog for create/edit (Tool-Master-Control style).
- **Material Specification Management**: **Add Material Specification** toolbar button; **Edit** and **Delete** in the Action column; modal dialog for create/edit.
- REST API: `POST` / `DELETE` for `/api/users` and `/api/material-specs`; create/update request models.

### Changed

- **3D Analyzer**: imported solid part shading color set to **#A5D4FF** (lighter blue; reduced metalness for a cleaner look).
- Settings pages: primary action toolbar above page header; delete actions use confirm dialog.

### Fixed

- Database seeder: skip `ALTER TABLE` when `Density` / `Password` columns already exist (cleaner startup logs).

---

## [1.1.0] - 2026-05-29

### Added

- NX-style **gnomon** in the viewport (clickable cube faces, face hover highlight, world X/Y/Z axes with labels).
- **Custom coordinate system** visualization: RGB axis triad at the picked origin with X/Y/Z sprite labels.
- Screen-space scaling for the custom coord triad so axis length stays visually consistent when zooming.
- `F` keyboard shortcut: fit camera to model and restore isometric home view.
- **Reset Measurement** control to clear all measurement values and snapped pick markers.
- **Apply** buttons for stock offsets and custom coordinate system (bounding box and raw stock volume refresh).
- Auto-update of stock bounding box when stock offset inputs change.

### Changed

- Default **Z-up** world orientation and **XY floor plane** (aligned with Siemens NX CAM).
- Camera orbit rewritten to **quaternion-based** screen-space controls (horizontal = camera up, vertical = camera right).
- Gnomon world axes rendered via a mirrored gnomon camera (world-aligned geometry, not counter-rotated groups).
- Custom coordinate UI: moved below stock offsets; pick workflow uses cursor snap like measurements.
- STEP mesh loading: `Float32Array` / `Uint32Array` buffers for Three.js compatibility; robust `occt-import-js` UMD/WASM loading.
- Publish profile: portable **AnyCPU** build (removed `win-x64` runtime identifier for MonsterASP compatibility).

### Fixed

- View **jump** and **lock** near top/bottom orbit poles (gimbal lock, `camera.up` discontinuity, world-Z horizontal rotation at poles).
- Vertical middle-drag **spiral rotation** (elevation axis now uses horizontal pivot `cross(worldZ, viewDir)`; later screen-space axes).
- Gnomon top-face snap **XY orientation** (`atan2(0,0)` at pole; use `theta = -π/2` for NX top view).
- Gnomon/world axis labels clipped or overlapping (label canvas size, stroke, placement past line ends).
- Custom coord axis **drift on zoom** (group anchored at origin; children in local space; scale from distance to origin).
- Render loop crash guard when scaling custom coord axes (`updateCoordAxisScreenScale` try/catch and finite checks).
- Bounding box display wrapping (`white-space: pre-line` for multi-line bbox text).
- Measurement and coord picks: vertex **snap markers** persist until tool reset or measurement type change.
- Custom coord pick: cursor preview and snap on click; markers cleared after third point.

---

## [1.0.0] - 2026-05-28

### Added

- Browser-based **STEP/STP** import and display (client-side **occt-import-js** + **Three.js**).
- ASP.NET Razor Pages host serving static UI (`ThreeDAnalyzer.Web`).
- NX-style camera controls: middle-drag rotate, Shift+middle pan, scroll zoom.
- Part **volume** (mm³ / cm³) and axis-aligned **bounding box**.
- **Distance**, **angle**, and **radius** measurement tools with vertex snap.
- **Raw stock** face expansion, utilization, and offset inputs.
- **3-point custom coordinate system** (origin, X+, Y+) for oriented bounding box and stock volume.
- GitHub Actions workflow and MonsterASP/IIS publish documentation.

[Unreleased]: https://github.com/compare/v1.3.2...HEAD
[1.3.2]: https://github.com/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/compare/v1.2.2...v1.3.0
[1.2.2]: https://github.com/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/releases/tag/v1.0.0
