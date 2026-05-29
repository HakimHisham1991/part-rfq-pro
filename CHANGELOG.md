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
