/**
 * 3D Part Analyzer — Three.js WebGL Viewer
 * Three.js r165 — MIT License (https://threejs.org/LICENSE)
 * OrbitControls — MIT License (Three.js examples)
 */
import * as THREE from '/js/three.module.min.js';
import { OrbitControls } from '/js/OrbitControls.js';

/**
 * Siemens NX-style Z-up isometric: equal inclination to X,Y,Z; XY azimuth is 180° from (−1,1,1)
 * (i.e. octant (+X,−Y,+Z) toward the model). camera.up stays +Z.
 */
const NX_ISO_VIEW_DIR = new THREE.Vector3(1, -1, 1).normalize();

/** Siemens NX-ish corner HUD: CSS pixels (buffer scales with devicePixelRatio inside). */
const NX_GNOMON_PX = 128;

/** Reusable math for `_syncNxGnomonOrientation` (no GC per frame). */
const _gnScr = {
    qCube: new THREE.Quaternion(),
    nMain: new THREE.Vector3(),
    zCap: new THREE.Vector3(0, 0, 1),
};

const ThreeDViewer = {
    _scene:       null,
    _camera:      null,
    _renderer:    null,
    _controls:    null,
    _meshObj:     null,
    _bboxHelper:  null,
    _obbHelper:    null,
    _csBboxHelper: null,
    _markers:     [],
    _snapMode:    false,
    _dotNetRef:   null,
    _ro:          null,
    _floorGrid:   null,
    _canvas:      null,
    _rafId:       null,
    _onCanvasMouseDown: null,
    _onWindowKeyDown:   null,
    /** @type {null | { host: HTMLElement, canvas: HTMLCanvasElement, renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.OrthographicCamera, rotScreen: THREE.Group, cubeGroup: THREE.Group, pickMesh: THREE.Mesh, raycaster: THREE.Raycaster }} */
    _nxGnomon: null,
    /** Scene triad at orbit target (+X,+Y,+Z world; same RGB as gnomon). */
    _worldAxesTriad: null,
    /** @type {null | { t0: number, dur: number, p0: THREE.Vector3, p1: THREE.Vector3, tar0: THREE.Vector3, tar1: THREE.Vector3, up0: THREE.Vector3, up1: THREE.Vector3 }} */
    _snapAnim: null,
    _nxGnomonBoundDown: null,

    /** Initialise the viewer. Call once from OnAfterRenderAsync. */
    init(canvasId, dotNetRef) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) { console.error('[viewer] canvas not found:', canvasId); return; }
        this.dispose();
        this._dotNetRef = dotNetRef;

        // Scene
        this._scene = new THREE.Scene();
        this._scene.background = new THREE.Color(0x1c1c2e);

        // Siemens NX-style: XY floor (+Z vertical); grid lives in XY (see rotation below).
        this._floorGrid = new THREE.GridHelper(420, 20, 0x444466, 0x333355);
        this._floorGrid.name = 'camFloorPlane';
        this._floorGrid.rotation.x = Math.PI / 2;
        this._scene.add(this._floorGrid);

        // Camera
        const w = canvas.clientWidth || 800;
        const h = canvas.clientHeight || 600;
        this._camera = new THREE.PerspectiveCamera(55, w / h, 0.01, 1_000_000);
        this._camera.up.set(0, 0, 1);
        // Pre-load: standard NX isometric stance (aligned with fitCamera once a model exists).
        this._camera.position.copy(NX_ISO_VIEW_DIR).multiplyScalar(495);

        // Renderer
        let renderer;
        try {
            renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        }
        catch (e) {
            const msg = e && e.message ? e.message : String(e);
            throw new Error(`WebGLRenderer failed (${msg}). WebGL may be disabled or blocked.`);
        }
        this._renderer = renderer;
        this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this._renderer.setSize(w, h, false);

        // Lighting
        const ambient = new THREE.AmbientLight(0xffffff, 0.45);
        this._scene.add(ambient);
        const dir1 = new THREE.DirectionalLight(0xffffff, 0.80);
        dir1.position.set(2.5, 3.5, 9);
        this._scene.add(dir1);
        const dir2 = new THREE.DirectionalLight(0x8899ff, 0.25);
        dir2.position.set(-2.5, -2, -6);
        this._scene.add(dir2);

        const MOUSE_ROTATE = THREE.MOUSE?.ROTATE ?? 0;

        // Siemens NX CAM style: zoom = wheel, rotate = middle drag, pan = Shift + middle drag
        // (OrbitControls: MIDDLE mapped to ROTATE; Shift/Ctrl/Meta swaps to PAN for that button.)
        this._controls = new OrbitControls(this._camera, canvas);
        this._controls.mouseButtons = {
            LEFT: -1,
            MIDDLE: MOUSE_ROTATE,
            RIGHT: -1,
        };
        this._controls.enableDamping = true;
        this._controls.dampingFactor = 0.07;
        this._controls.screenSpacePanning = true;
        this._controls.target.set(0, 0, 0);
        this._controls.update();

        // Resize observer — keeps renderer in sync with container size
        this._ro = new ResizeObserver(() => this._onResize(canvas));
        this._ro.observe(canvas.parentElement ?? canvas);
        requestAnimationFrame(() => this._onResize(canvas));

        this._canvas = canvas;
        this._onCanvasMouseDown = e => this._onCanvasClick(e);
        this._onWindowKeyDown = e => this._onKey(e);
        canvas.addEventListener('mousedown', this._onCanvasMouseDown);
        window.addEventListener('keydown', this._onWindowKeyDown);

        this._updateWorldAxesTriad();

        this._animate();

        this._installNxViewGnomon(canvas);
    },

    /** Load a tessellated mesh (vertices: flat xyz…, indices: triangle corner indices). */
    loadMesh(vertices, indices) {
        if (this._meshObj) {
            this._scene.remove(this._meshObj);
            this._meshObj.traverse((obj) => {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) {
                    const m = obj.material;
                    if (Array.isArray(m)) m.forEach((mm) => mm.dispose?.());
                    else m.dispose?.();
                }
            });
            this._meshObj = null;
        }

        const vlen = vertices?.length ?? 0;
        const ilen = indices?.length ?? 0;
        if (vlen < 9 || ilen < 3) {
            console.warn('[viewer] loadMesh: empty buffers', vlen, ilen);
            return;
        }

        /** @type {Float32Array} */
        let pos = vertices instanceof Float32Array ? vertices : null;
        if (!pos) {
            pos = new Float32Array(vlen);
            for (let i = 0; i < vlen; i++)
                pos[i] = typeof vertices[i] === 'number' ? vertices[i] : Number(vertices[i]);
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setIndex(Array.from(indices, n => n | 0));
        geo.computeVertexNormals();

        const mat = new THREE.MeshPhongMaterial({
            color:     0x5588cc,
            specular:  0x224466,
            shininess: 70,
            side:      THREE.DoubleSide,
            emissive:  0x1a2840,
        });

        this._meshObj = new THREE.Mesh(geo, mat);

        try {
            const edgeGeo = new THREE.EdgesGeometry(geo, 18);
            const edgeMat = new THREE.LineBasicMaterial({
                color:     0x99aaba,
                depthTest: true,
                opacity:   0.9,
                transparent: true,
            });
            const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
            edgeLines.name = 'partSilhouetteEdges';
            this._meshObj.add(edgeLines);
        } catch (_) {
            // Non-fatal — main mesh still shows
        }

        this._scene.add(this._meshObj);
        const bbox = new THREE.Box3().setFromObject(this._meshObj);
        this._syncFloorPlaneToBBox(bbox);
        this._updateWorldAxesTriad();

        requestAnimationFrame(() => this.fitCamera());
    },

    /** Canvas sprite (circular badge + letter) — billboards toward the gnomon camera; X/Y/Z labels. */
    _gnomonAxisLabel(label, fgCss) {
        const W = 256;
        const H = 256;
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');

        ctx.clearRect(0, 0, W, H);

        ctx.fillStyle = 'rgba(10,14,26,0.82)';
        const r = 86;
        ctx.beginPath();
        ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = fgCss;
        ctx.lineWidth = 9;
        ctx.stroke();

        ctx.font = 'bold 146px Segoe UI, system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = fgCss;
        ctx.fillText(label, W / 2, H / 2 + 8);

        const tex = new THREE.CanvasTexture(canvas);
        if ('colorSpace' in tex && THREE.SRGBColorSpace)
            tex.colorSpace = THREE.SRGBColorSpace;

        const mat = new THREE.SpriteMaterial({
            map: tex,
            depthTest: false,
            transparent: true,
            opacity:    1.0,
        });
        mat.toneMapped = false;

        const spr = new THREE.Sprite(mat);
        spr.center.set(0.5, 0.5);
        return spr;
    },

    _disposeWorldAxesTriad() {
        const t = this._worldAxesTriad;
        if (!t?.group || !this._scene) return;
        this._scene.remove(t.group);
        t.group.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose?.();
            const m = obj.material;
            if (!m) return;
            if (Array.isArray(m)) {
                m.forEach((mm) => {
                    mm.map?.dispose?.();
                    mm.dispose?.();
                });
            }
            else {
                m.map?.dispose?.();
                m.dispose?.();
            }
        });
        this._worldAxesTriad = null;
    },

    _ensureWorldAxesTriad() {
        if (this._worldAxesTriad || !this._scene) return;

        const group = new THREE.Group();
        group.name = 'worldAxesTriad';
        group.renderOrder = 50;

        const L0 = 90;
        const headL = L0 * 0.26;
        const headW = L0 * 0.17;
        const axX = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), L0, 0xee5533, headL, headW);
        const axY = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), L0, 0x33aa55, headL, headW);
        const axZ = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), L0, 0x4466ee, headL, headW);
        for (const h of [axX, axY, axZ]) {
            h.line.material.depthTest = true;
            h.cone.material.depthTest = true;
            h.line.renderOrder = 50;
            h.cone.renderOrder = 50;
            group.add(h);
        }

        const labS = L0 * 0.098;
        const lx = this._gnomonAxisLabel('X', '#ee5533');
        lx.position.set(L0 * 1.02, 0, 0);
        lx.scale.setScalar(labS);
        const ly = this._gnomonAxisLabel('Y', '#33aa55');
        ly.position.set(0, L0 * 1.02, 0);
        ly.scale.setScalar(labS);
        const lz = this._gnomonAxisLabel('Z', '#4466ee');
        lz.position.set(0, 0, L0 * 1.02);
        lz.scale.setScalar(labS);
        for (const sp of [lx, ly, lz]) {
            sp.renderOrder = 51;
            group.add(sp);
        }

        this._scene.add(group);
        this._worldAxesTriad = { group, axX, axY, axZ, lx, ly, lz };
    },

    /** World RGB triad at orbit target (+X,+Y,+Z); length scales with loaded mesh diagonal. */
    _updateWorldAxesTriad() {
        if (!this._scene || !this._controls) return;
        this._ensureWorldAxesTriad();
        const t = this._worldAxesTriad;
        if (!t) return;

        const cen = this._getOrbitTargetCenter(new THREE.Vector3());

        let diag = 220;
        if (this._meshObj) {
            const box = new THREE.Box3().setFromObject(this._meshObj);
            diag = box.getSize(new THREE.Vector3()).length();
            if (!Number.isFinite(diag) || diag < 1e-9) diag = 220;
        }
        const L = THREE.MathUtils.clamp(diag * 0.11, 26, 360);
        const headL = L * 0.26;
        const headW = L * 0.17;
        const labelS = L * 0.098;

        t.group.position.copy(cen);
        if (typeof t.axX.setLength === 'function') {
            t.axX.setLength(L, headL, headW);
            t.axY.setLength(L, headL, headW);
            t.axZ.setLength(L, headL, headW);
        }
        t.lx.position.set(L * 1.02, 0, 0);
        t.ly.position.set(0, L * 1.02, 0);
        t.lz.position.set(0, 0, L * 1.02);
        t.lx.scale.setScalar(labelS);
        t.ly.scale.setScalar(labelS);
        t.lz.scale.setScalar(labelS);
    },

    _disposeFloorGrid() {
        if (!this._floorGrid) return;
        this._scene.remove(this._floorGrid);
        this._floorGrid.geometry?.dispose?.();
        const m = this._floorGrid.material;
        if (m) {
            if (Array.isArray(m)) m.forEach((mm) => mm.dispose?.());
            else m.dispose?.();
        }
        this._floorGrid = null;
    },

    /** Floor is the XY plane at z = box.min.z, centered on part in XY. */
    _syncFloorPlaneToBBox(box) {
        const cen = box.getCenter(new THREE.Vector3());
        const sz = box.getSize(new THREE.Vector3());
        const horizSpan = Math.max(sz.x, sz.y, 1e-6);
        const gridSize = Math.min(Math.max(horizSpan * 2.5, 220), 12_000);
        const divs = Math.min(Math.max(14, Math.round(gridSize / 45)), 80);

        this._disposeFloorGrid();
        this._floorGrid = new THREE.GridHelper(gridSize, divs, 0x444466, 0x333355);
        this._floorGrid.name = 'camFloorPlane';
        this._floorGrid.rotation.x = Math.PI / 2;
        this._floorGrid.position.set(cen.x, cen.y, box.min.z);
        this._scene.add(this._floorGrid);
    },

    /** Frame camera to Siemens NX Z-up isometric (eye along (1,−1,1); Z+ unchanged). Press F to apply. */
    fitCamera() {
        if (!this._meshObj) return;
        this._snapAnim = null;
        if (this._controls) this._controls.enabled = true;
        const canvas = this._renderer?.domElement;
        if (canvas) this._onResize(canvas);

        const box = new THREE.Box3().setFromObject(this._meshObj);
        const cen = box.getCenter(new THREE.Vector3());
        const diag = box.getSize(new THREE.Vector3()).length();
        const safeDiag = Number.isFinite(diag) && diag >= 1e-9 ? diag : 250;

        // Siemens NX Z-up isometric — eye on axis diagonal (+X,−Y,+Z octant; 180° XY from −X,+Y,+Z).
        const dist = Math.max(safeDiag * 1.35, safeDiag + 120);

        this._camera.up.set(0, 0, 1);
        this._camera.position.copy(cen).addScaledVector(NX_ISO_VIEW_DIR, dist);

        this._controls.target.copy(cen);
        this._camera.near = Math.max(safeDiag / 2500.0, 1e-3);
        this._camera.far = Math.max(safeDiag * 400.0, this._camera.near + 1.0);

        if (!Number.isFinite(this._camera.near)) this._camera.near = 0.01;
        if (!Number.isFinite(this._camera.far) || this._camera.far <= this._camera.near)
            this._camera.far = 1e6;

        this._camera.updateProjectionMatrix();
        this._controls.update();
    },

    _getOrbitTargetCenter(out) {
        if (this._controls?.target)
            return out.copy(this._controls.target);
        return out.set(0, 0, 0);
    },

    _computeSnapEyeDistance() {
        if (!this._meshObj) return 450;
        const box = new THREE.Box3().setFromObject(this._meshObj);
        const d = box.getSize(new THREE.Vector3()).length();
        return Math.max(d * 1.22, 220);
    },

    /** World +Z up: pick an up vector not parallel to view (eye→target ≈ −faceDir). */
    _cameraUpFromFaceDir(faceDir) {
        const ax = Math.abs(faceDir.x), ay = Math.abs(faceDir.y), az = Math.abs(faceDir.z);
        if (az >= ax && az >= ay)
            return new THREE.Vector3(0, 1, 0);
        return new THREE.Vector3(0, 0, 1);
    },

    _beginCameraSnapToDirection(faceDir) {
        if (!this._camera || !this._controls) return;
        const cen = this._getOrbitTargetCenter(new THREE.Vector3());
        const dist = this._computeSnapEyeDistance();
        const d = faceDir.clone().normalize();
        const p1 = cen.clone().addScaledVector(d, dist);
        const tar1 = cen.clone();
        const up1 = this._cameraUpFromFaceDir(d);

        this._controls.enabled = false;
        this._snapAnim = {
            t0: performance.now(),
            dur: 260,
            p0: this._camera.position.clone(),
            p1,
            tar0: this._controls.target.clone(),
            tar1,
            up0: this._camera.up.clone(),
            up1,
        };
    },

    /** Map picked gnomon face normal (world axes) → main-camera snap (+X −X +Y −Y +Z −Z). */
    _snapMainViewFromGnomonNormal(nWorld) {
        const nx = Math.abs(nWorld.x), ny = Math.abs(nWorld.y), nz = Math.abs(nWorld.z);
        let sx = 0, sy = 0, sz = 0;
        if (nx >= ny && nx >= nz)
            sx = Math.sign(nWorld.x) || 1;
        else if (ny >= nz)
            sy = Math.sign(nWorld.y) || 1;
        else
            sz = Math.sign(nWorld.z) || 1;
        const dir = new THREE.Vector3(sx, sy, sz);
        if (dir.lengthSq() < 1e-12) return;
        dir.normalize();
        this._beginCameraSnapToDirection(dir);
    },

    _installNxViewGnomon(mainCanvas) {
        this._disposeNxViewGnomon();

        const wrap = mainCanvas.parentElement;
        if (!wrap) return;
        if (getComputedStyle(wrap).position === 'static')
            wrap.style.position = 'relative';

        const host = document.createElement('div');
        host.className = 'nx-view-gnomon-host';
        host.style.cssText =
            'position:absolute;left:10px;bottom:10px;width:' + NX_GNOMON_PX +
            'px;height:' + NX_GNOMON_PX +
            'px;z-index:12;pointer-events:auto;touch-action:none;';

        const gCanvas = document.createElement('canvas');
        gCanvas.width = NX_GNOMON_PX;
        gCanvas.height = NX_GNOMON_PX;
        gCanvas.style.cssText = 'display:block;width:100%;height:100%;cursor:pointer;';

        host.appendChild(gCanvas);
        wrap.appendChild(host);

        let gR;
        try {
            gR = new THREE.WebGLRenderer({
                canvas: gCanvas,
                antialias: true,
                alpha: true,
                premultipliedAlpha: false,
            });
        }
        catch (e) {
            wrap.removeChild(host);
            console.warn('[viewer] gnomon WebGL unavailable', e);
            return;
        }
        gR.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        gR.setSize(NX_GNOMON_PX, NX_GNOMON_PX, false);
        gR.setClearColor(0x000000, 0);
        gR.autoClear = true;

        const gScene = new THREE.Scene();

        const s = 1.25;
        const gCam = new THREE.OrthographicCamera(-s, s, s, -s, 0.1, 20);
        gCam.position.copy(new THREE.Vector3(-1.08, 1.12, 1.06)).multiplyScalar(1.85);
        gCam.up.set(0, 0, 1);
        gCam.lookAt(0, 0, 0);

        const amb = new THREE.AmbientLight(0xffffff, 0.85);
        gScene.add(amb);
        const dl = new THREE.DirectionalLight(0xffffff, 0.35);
        dl.position.set(0.4, 0.2, 2);
        gScene.add(dl);

        /** World-aligned RGB (+X red, +Y green, +Z blue); matches in-scene world triad. */
        const rotScreen = new THREE.Group();
        rotScreen.name = 'nxViewGnomonRotScreen';

        /** Box only: twist so the world face that points at the main camera also faces the fixed HUD camera. */
        const cubeGroup = new THREE.Group();
        cubeGroup.name = 'nxViewCubeGroup';
        rotScreen.add(cubeGroup);

        const boxSize = 0.92;
        const boxGeo = new THREE.BoxGeometry(boxSize, boxSize, boxSize);
        const faceMat = new THREE.MeshStandardMaterial({
            color: 0xf2f4f8,
            metalness: 0.05,
            roughness: 0.55,
            transparent: true,
            opacity: 0.52,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        const pickMesh = new THREE.Mesh(boxGeo, faceMat);
        pickMesh.name = 'nxGnomonPick';
        cubeGroup.add(pickMesh);

        const edgeGeo = new THREE.EdgesGeometry(boxGeo, 22);
        const edges = new THREE.LineSegments(
            edgeGeo,
            new THREE.LineBasicMaterial({ color: 0xa8b0c4, transparent: true, opacity: 0.95 }));
        edges.renderOrder = 1;
        cubeGroup.add(edges);

        const L = boxSize * 0.92;
        const headL = boxSize * 0.26;
        const headW = boxSize * 0.17;
        const axX = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), L, 0xee5533, headL, headW);
        const axY = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), L, 0x33aa55, headL, headW);
        const axZ = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), L, 0x4466ee, headL, headW);
        for (const h of [axX, axY, axZ]) {
            h.line.renderOrder = 2;
            h.cone.renderOrder = 2;
            rotScreen.add(h);
        }

        const labelS = boxSize * 0.098;
        const lx = this._gnomonAxisLabel('X', '#ee5533');
        lx.position.set(L * 1.02, 0, 0);
        lx.scale.setScalar(labelS);
        const ly = this._gnomonAxisLabel('Y', '#33aa55');
        ly.position.set(0, L * 1.02, 0);
        ly.scale.setScalar(labelS);
        const lz = this._gnomonAxisLabel('Z', '#4466ee');
        lz.position.set(0, 0, L * 1.02);
        lz.scale.setScalar(labelS);
        for (const sp of [lx, ly, lz]) {
            sp.renderOrder = 3;
            rotScreen.add(sp);
        }

        gScene.add(rotScreen);

        const raycaster = new THREE.Raycaster();
        raycaster.layers.enableAll();

        this._nxGnomonBoundDown = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (!pickMesh.geometry) return;
            const rect = gCanvas.getBoundingClientRect();
            const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
            const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(new THREE.Vector2(x, y), gCam);
            const hits = raycaster.intersectObject(pickMesh, false);
            if (!hits.length) return;

            const hit = hits[0];
            let n = null;
            if (hit.face?.normal)
                n = hit.face.normal.clone().transformDirection(pickMesh.matrixWorld);
            else if (hit.normal && hit.normal instanceof THREE.Vector3)
                n = hit.normal.clone();
            if (!n || n.lengthSq() < 1e-18) return;
            n.normalize();
            this._snapMainViewFromGnomonNormal(n);
        };
        gCanvas.addEventListener('pointerdown', this._nxGnomonBoundDown, { passive: false });

        this._nxGnomon = {
            host,
            canvas: gCanvas,
            renderer: gR,
            scene: gScene,
            camera: gCam,
            rotScreen,
            cubeGroup,
            pickMesh,
            raycaster,
        };
    },

    _disposeNxViewGnomon() {
        const g = this._nxGnomon;
        if (!g) return;
        if (this._nxGnomonBoundDown && g.canvas)
            g.canvas.removeEventListener('pointerdown', this._nxGnomonBoundDown);
        this._nxGnomonBoundDown = null;

        g.renderer?.dispose();
        g.scene?.traverse((o) => {
            if (o.geometry) o.geometry.dispose?.();
            const m = o.material;
            if (!m) return;
            if (Array.isArray(m)) m.forEach(mm => mm.dispose?.());
            else m.dispose?.();
        });
        g.host?.remove();
        this._nxGnomon = null;
    },

    /**
     * HUD camera matched to main viewport (direction + camera.up); rotScreen stays world XYZ so gnomon RGB matches
     * the in-scene world triad. Cube twists so the outward face aligns with eye→origin (parallel to main view).
     */
    _syncNxGnomonOrientation() {
        const g = this._nxGnomon;
        if (!g?.rotScreen || !g?.cubeGroup || !g.camera || !this._camera || !this._controls) return;

        const X = _gnScr;
        const gCam = g.camera;

        X.nMain.subVectors(this._camera.position, this._controls.target);
        if (X.nMain.lengthSq() < 1e-14) return;
        X.nMain.normalize();

        const hudEyeDist = 2.92;
        gCam.position.copy(X.nMain).multiplyScalar(hudEyeDist);
        gCam.up.copy(this._camera.up).normalize();
        gCam.lookAt(0, 0, 0);

        g.rotScreen.quaternion.identity();

        X.qCube.setFromUnitVectors(X.zCap, X.nMain);
        g.cubeGroup.quaternion.copy(X.qCube);
    },

    _renderGnomon() {
        const g = this._nxGnomon;
        if (!g?.renderer) return;
        this._syncNxGnomonOrientation();
        g.renderer.render(g.scene, g.camera);
    },

    /** Show or update the orange axis-aligned bounding box (world XYZ). */
    showBoundingBox(minX, minY, minZ, maxX, maxY, maxZ) {
        this._disposeOrientedBbox();
        if (this._bboxHelper) this._scene.remove(this._bboxHelper);
        const box = new THREE.Box3(
            new THREE.Vector3(minX, minY, minZ),
            new THREE.Vector3(maxX, maxY, maxZ));
        this._bboxHelper = new THREE.Box3Helper(box, 0xff8800);
        this._scene.add(this._bboxHelper);
    },

    /**
     * Orange stock box oriented to orthonormal axes (unit vectors U,V,W in world space),
     * with local corner ranges [mx,Mx],[my,My],[mz,Mz] along U,V,W from origin O.
     */
    showOrientedBoundingBox(
        ox, oy, oz,
        ux, uy, uz, vx, vy, vz, wx, wy, wz,
        mx, my, mz, Mx, My, Mz
    ) {
        if (this._bboxHelper) {
            this._scene.remove(this._bboxHelper);
            this._bboxHelper = null;
        }
        if (this._csBboxHelper) {
            this._scene.remove(this._csBboxHelper);
            this._csBboxHelper = null;
        }
        this._disposeOrientedBbox();

        const localCorners = [
            [mx, my, mz], [Mx, my, mz], [Mx, My, mz], [mx, My, mz],
            [mx, my, Mz], [Mx, my, Mz], [Mx, My, Mz], [mx, My, Mz],
        ];
        const verts = [];
        for (let i = 0; i < 8; i++) {
            const [tx, ty, tz] = localCorners[i];
            verts.push(new THREE.Vector3(
                ox + ux * tx + vx * ty + wx * tz,
                oy + uy * tx + vy * ty + wy * tz,
                oz + uz * tx + vz * ty + wz * tz));
        }
        const edgePairs = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
        const flat = [];
        for (let k = 0; k < edgePairs.length; k++) {
            const a = edgePairs[k][0], b = edgePairs[k][1];
            flat.push(
                verts[a].x, verts[a].y, verts[a].z,
                verts[b].x, verts[b].y, verts[b].z);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(flat), 3));
        const mat = new THREE.LineBasicMaterial({ color: 0xff8800 });
        this._obbHelper = new THREE.LineSegments(geo, mat);
        this._scene.add(this._obbHelper);
    },

    _disposeOrientedBbox() {
        const h = this._obbHelper;
        if (!h) return;
        this._scene.remove(h);
        h.geometry.dispose();
        if (Array.isArray(h.material))
            h.material.forEach(m => m.dispose?.());
        else
            h.material.dispose();
        this._obbHelper = null;
    },

    /** Enter or leave surface snap mode. */
    setSnapMode(enabled) {
        this._snapMode = enabled;
    },

    /**
     * Custom CS visuals: helper lines use all hits that are marked valid; zero or one coloured sphere when sphereIdx is 0–2.
     */
    syncCsPickMarkers(
        h0, x0, y0, z0,
        h1, x1, y1, z1,
        h2, x2, y2, z2,
        sphereIdx
    ) {
        // Full reset — replaces multi-marker stacking (single-sphere UX).
        this.clearSnapMarkers();

        const colors = [0xee3333, 0x33cc44, 0x3366ee];

        if (sphereIdx >= 0 && sphereIdx <= 2) {
            let mx, my, mz, mc;
            if (sphereIdx === 0 && h0) { mx = x0; my = y0; mz = z0; mc = colors[0]; }
            else if (sphereIdx === 1 && h1) { mx = x1; my = y1; mz = z1; mc = colors[1]; }
            else if (sphereIdx === 2 && h2) { mx = x2; my = y2; mz = z2; mc = colors[2]; }
            if (mx !== undefined) {
                const geo = new THREE.SphereGeometry(3, 14, 10);
                const mat = new THREE.MeshBasicMaterial({ color: mc });
                const sphere = new THREE.Mesh(geo, mat);
                sphere.position.set(mx, my, mz);
                sphere.name = `snapMarker_${sphereIdx}`;
                this._markers.push(sphere);
                this._scene.add(sphere);
            }
        }

        this._syncCsAxesFromHits(h0, x0, y0, z0, h1, x1, y1, z1, h2, x2, y2, z2);
    },

    /** Axis helper lines between valid P1/P2/P3 (uses stored coords, independent of spheres). */
    _syncCsAxesFromHits(h0, x0, y0, z0, h1, x1, y1, z1, h2, x2, y2, z2) {
        ['csAxes', 'csAxesY'].forEach(n => {
            const o = this._scene.getObjectByName(n);
            if (o) this._scene.remove(o);
        });

        if (h0 && h1) {
            const p1 = new THREE.Vector3(x0, y0, z0);
            const p2 = new THREE.Vector3(x1, y1, z1);
            const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
            const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xee3333 }));
            line.name = 'csAxes';
            this._scene.add(line);

            if (h2) {
                const p3 = new THREE.Vector3(x2, y2, z2);
                const geo2 = new THREE.BufferGeometry().setFromPoints([p1, p3]);
                const line2 = new THREE.Line(geo2, new THREE.LineBasicMaterial({ color: 0x33cc44 }));
                line2.name = 'csAxesY';
                this._scene.add(line2);
            }
        }
    },

    /** Legacy no-op pathway — use syncCsPickMarkers from Blazor. */
    addSnapMarker(x, y, z, index) {
        console.warn('[viewer] addSnapMarker is deprecated — use ThreeDViewer.syncCsPickMarkers from C#.');
    },

    /** Remove all snap markers and CS axis lines. */
    clearSnapMarkers() {
        if (!this._scene) {
            this._markers = [];
            return;
        }
        this._markers.forEach(m => {
            this._scene.remove(m);
            m.geometry.dispose();
            m.material.dispose();
        });
        this._markers = [];
        ['csAxes', 'csAxesY'].forEach(n => {
            const obj = this._scene.getObjectByName(n);
            if (obj) this._scene.remove(obj);
        });
    },

    _onCanvasClick(event) {
        if (!this._snapMode || !this._meshObj) return;
        if (event.button !== 0) return;

        const canvas = event.currentTarget ?? event.target;
        const rect = canvas.getBoundingClientRect();
        const nx =  ((event.clientX - rect.left) / rect.width)  * 2 - 1;
        const ny = -((event.clientY - rect.top)  / rect.height) * 2 + 1;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(nx, ny), this._camera);

        const o = raycaster.ray.origin;
        const d = raycaster.ray.direction;

        // Send ray to C# — OCCT will intersect it against the exact BRep geometry
        this._dotNetRef.invokeMethodAsync('OnRayPick', o.x, o.y, o.z, d.x, d.y, d.z);
    },

    _onKey(event) {
        if (event.key !== 'f' && event.key !== 'F') return;
        // Don't steal typing in form fields (sidebar uploads, number inputs).
        const t = event.target;
        const tag = t && String(t.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')
            return;
        if (t && t.isContentEditable)
            return;

        event.preventDefault();
        this.fitCamera();
    },

    _onResize(canvas) {
        if (!this._renderer) return;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (w === 0 || h === 0) return;
        this._camera.aspect = w / h;
        this._camera.updateProjectionMatrix();
        this._renderer.setSize(w, h, false);

        const g = this._nxGnomon;
        if (g?.renderer) {
            const pr = Math.min(window.devicePixelRatio, 2);
            g.renderer.setPixelRatio(pr);
            g.renderer.setSize(NX_GNOMON_PX, NX_GNOMON_PX, false);
        }
    },

    _animate() {
        this._rafId = requestAnimationFrame(() => this._animate());

        if (this._snapAnim && this._camera && this._controls) {
            const { t0, dur, p0, p1, tar0, tar1, up0, up1 } = this._snapAnim;
            let u = (performance.now() - t0) / dur;
            const done = u >= 1;
            u = done ? 1 : THREE.MathUtils.clamp(u, 0, 1);
            const k = u * u * (3 - 2 * u);
            this._camera.position.lerpVectors(p0, p1, k);
            this._controls.target.lerpVectors(tar0, tar1, k);
            this._camera.up.lerpVectors(up0, up1, k).normalize();
            this._camera.updateProjectionMatrix();
            if (done) {
                this._snapAnim = null;
                if (this._controls) {
                    this._controls.enabled = true;
                    this._controls.update();
                }
            }
        }

        this._controls?.update();
        this._updateWorldAxesTriad();
        this._renderer?.render(this._scene, this._camera);
        this._renderGnomon();
    },

    dispose() {
        if (this._rafId != null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }

        this._snapAnim = null;
        this._disposeNxViewGnomon();

        if (this._canvas && this._onCanvasMouseDown) {
            this._canvas.removeEventListener('mousedown', this._onCanvasMouseDown);
        }
        if (this._onWindowKeyDown) {
            window.removeEventListener('keydown', this._onWindowKeyDown);
        }
        this._onCanvasMouseDown = null;
        this._onWindowKeyDown = null;
        this._canvas = null;

        this._ro?.disconnect();
        this._ro = null;

        this._controls?.dispose?.();
        this._controls = null;

        if (this._scene) {
            if (this._meshObj) {
                this._scene.remove(this._meshObj);
                this._meshObj.traverse((obj) => {
                    if (obj.geometry) obj.geometry.dispose();
                    if (obj.material) {
                        const m = obj.material;
                        if (Array.isArray(m)) m.forEach((mm) => mm.dispose?.());
                        else m.dispose?.();
                    }
                });
            }
            this._meshObj = null;

            this.clearSnapMarkers();
            if (this._bboxHelper) {
                this._scene.remove(this._bboxHelper);
                this._bboxHelper = null;
            }
            if (this._csBboxHelper) {
                this._scene.remove(this._csBboxHelper);
                this._csBboxHelper = null;
            }
            this._disposeOrientedBbox();
            this._disposeWorldAxesTriad();
            this._disposeFloorGrid();
        }

        this._renderer?.dispose();
        this._renderer = null;
        this._camera = null;
        this._scene = null;
        this._dotNetRef = null;
        this._snapMode = false;
    }
};

// Expose globally so Blazor JSInterop can call window.ThreeDViewer.*
window.ThreeDViewer = ThreeDViewer;
export { ThreeDViewer };
