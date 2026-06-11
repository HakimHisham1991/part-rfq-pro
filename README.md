# Part RFQ Pro — 3D Part Analyzer

> Browser-based STEP/STP analyzer and cycle-time estimation tool for aerospace manufacturing RFQ workflows.

All geometry parsing runs entirely in the browser via **occt-import-js** (WebAssembly) and **Three.js**. The ASP.NET Core host serves static files, the Razor page shell, and a SQLite-backed REST API — no native OCCT binaries, no Chromium, no server-side geometry processing.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Run Locally](#run-locally)
- [Camera Controls](#camera-controls-nx-style)
- [Module Reference](#module-reference)
  - [3D Viewer](#3d-viewer)
  - [Cycle Time Estimator](#cycle-time-estimator)
  - [Project Manager & RFQ Summary](#project-manager--rfq-summary)
  - [Settings](#settings)
- [REST API Endpoints](#rest-api-endpoints)
- [Database](#database)
- [JavaScript Libraries (committed)](#javascript-libraries-committed)
- [Refreshing JS Libraries](#refreshing-js-libraries)
- [Publish & Deploy (MonsterASP)](#publish--deploy-monsterasp)
- [GitHub Actions CI/CD](#github-actions-cicd)
- [Troubleshooting](#troubleshooting)

---

## Overview

Part RFQ Pro is an internal aerospace manufacturing tool that combines three workflows into a single web application:

1. **3D Part Viewer** — drag-and-drop a STEP/STP file to inspect geometry, measure distances/angles/radii, calculate part volume, define raw stock, and set a custom coordinate system.
2. **Cycle Time Estimator** — build an operation stack (Face Milling, Roughing, Pocketing, Profiling, Drilling, Tapping, etc.) with MRR-based formulas to produce a machining cycle time estimate tied to a specific part record.
3. **Project RFQ Manager** — organise parts by project, track delivery schedules, material specifications, and print a consolidated RFQ summary table.

Data is persisted in a SQLite database via Entity Framework Core 10. First startup seeds 171 material specifications and any configured machine/operation defaults.

---

## Features

### 3D Viewer

| Feature | Detail |
|---|---|
| Open STEP / STP | Drag-and-drop or file picker |
| Pan / Rotate / Zoom | NX-style controls (middle-drag, shift+drag, scroll) |
| Fit to model | `F` key or fit button |
| Axis gnomon | Clickable NX-style cube gnomon — click a face to snap to that standard view |
| Standard views | Top, Bottom, Front, Back, Left, Right, Isometric |
| Part volume | mm³ and cm³, computed from tessellated mesh |
| Axis-aligned bounding box | Live overlay with XYZ dimensions |
| Distance measurement | Vertex-snap pick-two-points distance |
| Angle measurement | Three-point angle |
| Radius measurement | Three-point circle radius |
| Vertex snap | Snap sphere highlights nearest mesh vertex |
| Raw stock expansion | Per-face offset inputs → stock volume and material utilisation % |
| Custom coordinate system | 3-point pick to define a local frame, shown as an in-scene axis triad |
| Measurement reset | Clear all annotations in one click |

### Cycle Time Estimator

| Feature | Detail |
|---|---|
| Operation stack | Add / remove / reorder operations; each card has its own parameter set |
| Operation types | Face Milling, Roughing, Pocketing, Profiling, Slotting, Ballnose Finishing, Drilling, Reaming, Tapping, Engraving, Manual Operation |
| MRR formulas | `ap × ae × feed` for material-removal operations; length/feed or hole-count/feed for others |
| Machine profiles | Rapid rate, spindle power, accel/decel factor, tool change time — applied to `other` overhead |
| Material specs | 171 seeded aerospace material specifications; density used for raw stock weight calculation |
| Raw material block | Auto-calculated from part finish dimensions + stock offsets; shows billet weight |
| Totals | Setup time, sub-total per operation, grand total cycle time (hrs), finish-part time |
| Persistence | Auto-saved to SQLite via REST API (`PUT /api/projects/{id}/parts/{id}/cycle-time`) |
| Operation templates | Reusable parameter presets per operation type |

### Project Manager & RFQ Summary

| Feature | Detail |
|---|---|
| Projects list | Name, date registered, owner, status (Open / Closed) |
| Parts per project | Part number, description, aircraft, QPA, launch qty, first delivery, material spec, finish/material dimensions, machining axis config |
| RFQ table | Consolidated view: all parts with setup time, cycle times (Turn+Mill, 3-axis, 4-axis, 5-axis, total hrs) |
| Navigation | Sidebar with collapse/expand; context-aware active state per module |

### Settings

| Module | Purpose |
|---|---|
| Users | Manage application users |
| Material Specs | View / edit the 171 aerospace material specifications (seeded from `material-specs-master.json`) |
| Operation Templates | Default parameter presets for each operation type |
| Machine Profiles | CNC machine definitions (rapid rate, spindle power, accel/decel, tool change time) |

---

## Architecture

```
Browser (WASM + Three.js)          ASP.NET Core 10 (.NET 10)
─────────────────────────          ──────────────────────────
occt-import-js  ──parse──►  STEP   Razor Pages  ──shell HTML──►  Browser
Three.js        ──render──► Scene  REST API      ──JSON────────►  Browser
viewer.js                          EF Core 10
cycle-time.js                      SQLite  (part-rfq.db)
project-rfq.js                     Data/  (seeded JSON masters)
data-store.js   ◄──fetch───────    /api/projects
                                   /api/parts
                                   /api/cycle-time
                                   /api/settings/...
```

- **No server-side geometry**: STEP parsing, volume computation, bounding box, and all measurements happen entirely in the browser via WebAssembly.
- **No Playwright / Chromium**: Removed in favour of pure `HttpClient` where external data fetching is needed.
- **Portable publish**: `dotnet publish` produces a framework-dependent DLL package (`UseAppHost=false`) suitable for MonsterASP OutOfProcess IIS hosting.

---

## Project Structure

```
part-rfq-pro/
├── src/
│   └── ThreeDAnalyzer.Web/
│       ├── Pages/
│       │   └── Index.cshtml            Razor shell page
│       ├── wwwroot/
│       │   ├── css/                    Application styles
│       │   ├── js/
│       │   │   ├── app-shell.js        Sidebar, nav, localStorage state
│       │   │   ├── viewer.js           3D viewer — scene, controls, measurements
│       │   │   ├── step-analyzer.js    occt-import-js wrapper, volume + bbox
│       │   │   ├── cycle-time.js       Cycle time estimator UI + persistence
│       │   │   ├── cycle-time-migration.js  State normalisation helpers
│       │   │   ├── operation-field-schemas.js  Column/param definitions per op type
│       │   │   ├── operation-formulas.js       MRR + cycle time formulas
│       │   │   ├── data-store.js       REST API client (projects, parts, settings)
│       │   │   ├── part-model-store.js STEP file blob store per part
│       │   │   ├── projects.js         Project Manager list view
│       │   │   ├── project-rfq.js      RFQ summary table view
│       │   │   ├── settings-users.js
│       │   │   ├── settings-material-specs.js
│       │   │   ├── settings-operation-templates.js
│       │   │   ├── settings-machine-profiles.js
│       │   │   └── settings-modal.js   Shared modal helpers
│       │   └── lib/
│       │       ├── three.module.min.js
│       │       ├── occt-import-js.js
│       │       └── occt-import-js.wasm
│       ├── Data/
│       │   ├── material-specs-master.json      171 aerospace material specs
│       │   ├── operation-templates-master.json Default operation templates
│       │   └── machines-master.json            Default machine profiles
│       └── ThreeDAnalyzer.Web.csproj
├── scripts/
│   └── copy-libs.ps1               Copy npm packages into wwwroot/lib/
├── docs/
│   └── DEPLOY-MONSTERASP.md        Deployment guide
├── .github/
│   └── workflows/
│       └── deploy.yml              CI publish + Web Deploy to MonsterASP
├── package.json
└── README.md
```

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| [.NET SDK](https://dotnet.microsoft.com/download) | 10.0 | Required to build and run |
| [Node.js](https://nodejs.org) | Any LTS | Optional — only needed to refresh JS libraries |

---

## Run Locally

```bat
run.bat
```

Or manually:

```powershell
dotnet run --project src\ThreeDAnalyzer.Web\ThreeDAnalyzer.Web.csproj --launch-profile http
```

Then open: **http://localhost:5118**

On first run the app seeds the SQLite database (`part-rfq.db`) with material specs, operation templates, and machine profiles. This takes a few seconds.

---

## Camera Controls (NX Style)

| Input | Action |
|---|---|
| `F` | Fit camera to model |
| Middle-drag | Rotate (quaternion-based, no gimbal lock) |
| Shift + Middle-drag | Pan |
| Scroll wheel | Zoom in / out |
| Click gnomon face | Snap to standard view (Top, Front, Right, etc.) |

The viewer uses a Z-up coordinate system, matching Siemens NX conventions.

---

## Module Reference

### 3D Viewer

Open a STEP/STP file with the **Open** button or drag it onto the canvas. The viewer loads the model via `occt-import-js` WebAssembly and renders it with Three.js.

**Property panel** (right sidebar):

- **Volume** — part volume in mm³ and cm³
- **Bounding box** — XYZ extents in mm
- **Stock volume / Utilisation** — after applying stock face offsets
- **Measurements** — accumulated list of distance / angle / radius annotations

**Tool buttons:**

| Tool | Picks required | Output |
|---|---|---|
| Distance | 2 vertices | Straight-line distance (mm) |
| Angle | 3 vertices | Angle at middle point (degrees) |
| Radius | 3 vertices | Circle radius (mm) |
| Custom coord | 3 vertices | Local XYZ axis triad in scene |

**Stock offsets** — enter per-face expansion values (mm) for ±X, ±Y, ±Z faces, then click **Apply** to update the semi-transparent stock overlay and utilisation percentage.

---

### Cycle Time Estimator

Accessed per part via **Project Manager → Part → Edit**.

**Operation stack** — add operations from the dropdown. Each operation card shows:

- Operation type
- Parameter inputs (ap, ae, feed, volume, area, length, hole count, etc. — varies by type)
- Calculated MRR (mm³/min) where applicable
- Calculated cycle time (min)

**Supported operation types and formulas:**

| Type | Formula |
|---|---|
| Face Milling | `volume / (ap × ae × feed)` |
| Roughing | `volume / (ap × ae × feed)` |
| Pocketing | `volume / (ap × ae × feed)` |
| Profiling | `length / feed` |
| Slotting | `volume / (ap × ae × feed)` |
| Ballnose Finishing | `(area × stockLeft) / (ap × ae × feed)` |
| Drilling / Reaming / Tapping | `(ap × holeCount) / feed` |
| Engraving | `length / feed` |
| Manual Operation | Direct input (minutes) |

**Other / overhead** — setup time, rapid moves, accel/decel, tool changes. Populated automatically when a machine profile is selected.

**Raw material block** — length, width, thickness, density (from material spec), calculated billet volume and weight.

**Totals** — sub-totals per operation, setup time, finish-part time, and grand total cycle time in hours.

All data auto-saves to the database as you edit.

---

### Project Manager & RFQ Summary

**Projects page** (`/Projects`) — lists all projects with name, date, owner, and status. Click a project name to open its RFQ summary.

**RFQ Summary page** (`/ProjectRfq?projectId=...`) — shows all parts for the project in a wide table covering:

- Aircraft, part no., part number, description, thumbnail
- QPA, first launch qty, first delivery date
- Material spec, finish dimensions (T/W/L), ruling dimension
- Material block dimensions, qty per billet
- Setup time, cycle times (Turn+Mill, 3-axis, 4-axis, 5-axis, total hrs)

Click **Edit** on any row to go directly to the Cycle Time Estimator for that part.

---

### Settings

Accessible from the sidebar under **Settings**:

| Page | Path |
|---|---|
| Users | `/Settings/Users` |
| Material Specs | `/Settings/MaterialSpecs` |
| Operation Templates | `/Settings/OperationTemplates` |
| Machine Profiles | `/Settings/MachineProfiles` |

Machine profiles store: name, rapid rate (mm/min), spindle power (kW), accel/decel factor, tool change time (s), status (Active/Inactive), created-by, date.

---

## REST API Endpoints

All endpoints return JSON. Base path: `/api`.

| Method | Path | Description |
|---|---|---|
| GET | `/api/projects` | List all projects |
| GET | `/api/projects/{id}` | Get project by ID |
| GET | `/api/projects/{id}/parts` | List parts for a project |
| GET | `/api/projects/{id}/parts/{partId}` | Get part detail |
| PUT | `/api/projects/{id}/parts/{partId}/cycle-time` | Save cycle time data (v2 format) |
| GET | `/api/projects/{id}/parts/{partId}/cycle-time` | Load cycle time data |
| GET/POST/PUT/DELETE | `/api/settings/machine-profiles` | CRUD machine profiles |
| GET/POST/PUT/DELETE | `/api/settings/material-specs` | CRUD material specifications |
| GET/POST/PUT/DELETE | `/api/settings/operation-templates` | CRUD operation templates |
| GET/POST/PUT/DELETE | `/api/settings/users` | CRUD users |

Cycle time payload (version 2):

```json
{
  "version": 2,
  "operations": [ { "type": "Face Milling", "params": { "ap": 1.0, "ae": 50.0, "feed": 2500, "volume": 5000 } } ],
  "other": { "machine": "DMU 50", "machineProfileId": 3, "rapidRate": 30000, "spindlePower": 15, "accelDecel": 1.3, "toolChange": 15 },
  "rawMaterial": { "materialSpecId": 12, "length": 200, "width": 150, "thickness": 30, "density": 2.71 },
  "finishPart": { "setupTimeHour": 0.5 },
  "model3d": { "volumeMm3": 184000 },
  "computed": { "totalCycleHrs": 2.4 },
  "updatedAt": "2026-06-11T08:00:00Z"
}
```

---

## Database

SQLite database file: `part-rfq.db` (created at runtime in the app root / working directory).

Seeded on first startup from:

| File | Contents |
|---|---|
| `Data/material-specs-master.json` | 171 aerospace material specifications |
| `Data/operation-templates-master.json` | Default operation parameter templates |
| `Data/machines-master.json` | Default CNC machine profiles |

> ⚠️ **MonsterASP note**: SQLite data does **not** persist across a full redeploy if the publish folder is wiped. Back up `part-rfq.db` via the file manager before redeploying, or migrate to MSSQL for production durability.

---

## JavaScript Libraries (committed)

Libraries are committed to `wwwroot/lib/` to avoid npm/Node.js build steps in CI.

| File | Purpose |
|---|---|
| `three.module.min.js` | Three.js ES module — 3D rendering |
| `occt-import-js.js` | occt-import-js loader |
| `occt-import-js.wasm` | WebAssembly binary — OpenCASCADE geometry kernel |

---

## Refreshing JS Libraries

Only needed when updating library versions in `package.json`:

```powershell
npm install
powershell -File scripts/copy-libs.ps1
```

This copies the relevant files from `node_modules/` into `wwwroot/lib/`. Commit the updated files — CI does not run `npm install`.

---

## Publish & Deploy (MonsterASP)

MonsterASP uses **OutOfProcess IIS** hosting. The app must be published as a **portable framework-dependent** package (no `.exe`, no self-contained).

### Local publish

```powershell
dotnet publish src/ThreeDAnalyzer.Web/ThreeDAnalyzer.Web.csproj `
  -c Release -o ./publish `
  --self-contained false /p:UseAppHost=false
```

### Upload

Upload the **contents** of `publish/` (not the folder itself) into the site `wwwroot` via the MonsterASP file manager or Web Deploy.

Required files in site root after upload:

```
web.config
ThreeDAnalyzer.Web.dll
ThreeDAnalyzer.Web.deps.json
ThreeDAnalyzer.Web.runtimeconfig.json
Data/material-specs-master.json
wwwroot/  (css, js, lib — including occt-import-js.wasm)
```

`web.config` must specify OutOfProcess + stdout logging:

```xml
<aspNetCore processPath="dotnet" arguments=".\ThreeDAnalyzer.Web.dll"
            hostingModel="OutOfProcess" stdoutLogEnabled="true"
            stdoutLogFile=".\logs\stdout" />
```

> **Do not** publish a self-contained `.exe` — MonsterASP may disable the app pool and return 403.

### HTTPS

HTTPS redirection is **disabled** in Production — MonsterASP terminates SSL at the load balancer. Do not re-enable it, or the app will redirect-loop.

---

## GitHub Actions CI/CD

Trigger: push to `main` or `master`.

Workflow (`.github/workflows/deploy.yml`) steps:

1. Validate Web Deploy secrets are present
2. `dotnet publish` (Release, portable, `UseAppHost=false`)
3. Assert `ThreeDAnalyzer.Web.dll` exists and no `.exe` is present
4. Patch `web.config` for OutOfProcess + stdout logging
5. Web Deploy to MonsterASP

### Required repository secrets

Set in **Settings → Secrets and variables → Actions**:

| Secret | Example value |
|---|---|
| `WEBSITE_NAME` | `site12345` |
| `SERVER_COMPUTER_NAME` | `https://site12345.siteasp.net:8172` |
| `SERVER_USERNAME` | `site12345` |
| `SERVER_PASSWORD` | *(Web Deploy password from MonsterASP panel)* |

`MONSTER_*` prefixed names are also accepted.

> Set `SERVER_COMPUTER_NAME` to the base URL only — do **not** append `/msdeploy.axd?site=...`.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| **403 Forbidden** after deploy | Self-contained `.exe` deployed, app pool disabled | Redeploy as portable DLL (`UseAppHost=false`) |
| **HTTP 400** but logs show `Application started` | IIS/SSL forwarding conflict | Ensure HTTPS redirection is disabled in Production; re-upload all files and restart app pool |
| **HTTP 500.30** on startup | Missing `part-rfq.db` or seed files | Confirm `Data/*.json` files are present in site root; allow 30–60 s for first-run seeding |
| STEP file loads but volume is 0 | Tessellation issue with that geometry | Try re-exporting STEP from CAD with finer tessellation |
| WASM fails to load | `occt-import-js.wasm` missing or wrong path | Confirm `wwwroot/lib/occt-import-js.wasm` is deployed; check browser network tab for 404 |
| Measurements not snapping | Model very small or very large | Vertex snap radius auto-scales to model; ensure model is in mm |

For deployment failures, check `logs/stdout_*.log` on the MonsterASP file manager.
