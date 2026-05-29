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

[Unreleased]: https://github.com/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/releases/tag/v1.0.0
