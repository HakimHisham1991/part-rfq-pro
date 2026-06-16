# Changelog

All notable changes to **3D Part Analyzer** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Version numbers use **MAJOR.MINOR.PATCH**:

| Segment | When to increment |
|---------|-------------------|
| **MAJOR** | Incompatible API or behavior changes |
| **MINOR** | New functionality, backwards compatible |
| **PATCH** | Backwards compatible bug fixes |

---

## [Unreleased]

### Added

### Changed

### Fixed

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
