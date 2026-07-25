import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { SSRPass } from "three/addons/postprocessing/SSRPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const bridge = window.TankGameBridge;
const canvas = document.getElementById("c3d");
const inputCanvas = document.getElementById("c");
const aimDot = document.getElementById("aimDot");
const cameraHint = document.getElementById("cameraHint");
const rayTracingToggle = document.getElementById("rayTracingToggle");
const garageHost = document.querySelector(".tankHero");
const garageStatus = document.getElementById("garage3dStatus");
const garageTankSelect = document.getElementById("tankSel");
const garageMenuOverlay = document.getElementById("menuOverlay");
const battlefieldCanvasParent = canvas?.parentElement || null;

if (!bridge || !canvas || !inputCanvas) {
  throw new Error("The 3D renderer could not find the game bridge or canvases.");
}

const WORLD_SCALE = 0.12;
const BASE_FOV = 52;
const MOBILE = matchMedia("(pointer: coarse)").matches;
const UP = new THREE.Vector3(0, 1, 0);
const tempMatrix = new THREE.Matrix4();
const tempPosition = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempScale = new THREE.Vector3(1, 1, 1);
const tempColor = new THREE.Color();
const enemyShellTint = new THREE.Color(0xff4138);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !MOBILE,
    alpha: false,
    powerPreference: "high-performance",
  });
} catch (error) {
  console.warn("WebGL is unavailable; keeping the original 2D renderer.", error);
  window.Tank3D = {
    ready: false,
    getAimWorld: () => null,
    getAimPitch: () => 0,
    getCameraInfo: () => null,
  };
}

if (renderer) {
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MOBILE ? 1.15 : 1.55));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb9c7d0);
scene.fog = new THREE.FogExp2(0xc4b797, 0.00215);

const camera = new THREE.PerspectiveCamera(BASE_FOV, 16 / 9, 0.12, 2600);
camera.position.set(-20, 12, 20);
camera.up.copy(UP);

const worldRoot = new THREE.Group();
const entityRoot = new THREE.Group();
const effectsRoot = new THREE.Group();
scene.add(worldRoot, entityRoot, effectsRoot);

const garageScene = new THREE.Scene();
garageScene.background = new THREE.Color(0x11130f);
garageScene.fog = new THREE.Fog(0x11130f, 18, 38);
const garageCamera = new THREE.PerspectiveCamera(36, 1, 0.08, 120);
const garageModelRoot = new THREE.Group();
garageScene.add(garageModelRoot);
const garageFloor = new THREE.Mesh(
  new THREE.CircleGeometry(12, 96),
  new THREE.MeshStandardMaterial({ color:0x343428, roughness:0.96, metalness:0.04 })
);
garageFloor.rotation.x = -Math.PI / 2;
garageFloor.receiveShadow = true;
garageScene.add(garageFloor);
const garageGrid = new THREE.GridHelper(22, 22, 0x8d7b50, 0x39382e);
garageGrid.position.y = 0.012;
garageGrid.material.transparent = true;
garageGrid.material.opacity = 0.28;
garageScene.add(garageGrid);
const garageKey = new THREE.DirectionalLight(0xffe3ae, 4.2);
garageKey.position.set(7, 11, 8);
garageKey.castShadow = true;
garageKey.shadow.mapSize.set(MOBILE ? 1024 : 2048, MOBILE ? 1024 : 2048);
garageScene.add(garageKey);
const garageFill = new THREE.DirectionalLight(0x8eb9d9, 1.8);
garageFill.position.set(-8, 5, -5);
garageScene.add(garageFill);
garageScene.add(new THREE.HemisphereLight(0xd8e2d5, 0x322b20, 1.55));

let composer = null;
let ssrPass = null;
let outputPass = null;
let ssrSelectionDirty = true;
let hybridRayTracingEnabled = false;
let rendererHealthy = true;
let threePresented = false;
let nextHighPolySelectionAt = 0;
let lastRenderWidth = 0;
let lastRenderHeight = 0;
let lastRenderPixelRatio = 0;

try {
  composer = new EffectComposer(renderer);
  ssrPass = new SSRPass({
    renderer,
    scene,
    camera,
    width: 1,
    height: 1,
    selects: [],
  });
  ssrPass.resolutionScale = MOBILE ? 0.28 : 0.42;
  ssrPass.opacity = 0.62;
  ssrPass.maxDistance = 48;
  ssrPass.thickness = 0.025;
  ssrPass.blur = true;
  ssrPass.fresnel = true;
  ssrPass.distanceAttenuation = true;
  outputPass = new OutputPass();
  composer.addPass(ssrPass);
  composer.addPass(outputPass);
} catch (error) {
  console.warn("Hybrid ray-traced reflections are unavailable; using direct rendering.", error);
  composer = null;
  ssrPass = null;
  outputPass = null;
}

function applyRenderQuality() {
  const pixelCap = hybridRayTracingEnabled
    ? (MOBILE ? 0.9 : 1.25)
    : (MOBILE ? 1.15 : 1.55);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, pixelCap);
  if(Math.abs(renderer.getPixelRatio() - pixelRatio) < 0.001) return;
  renderer.setPixelRatio(pixelRatio);
  if(composer && typeof composer.setPixelRatio === "function") composer.setPixelRatio(pixelRatio);
  lastRenderWidth = 0;
  lastRenderHeight = 0;
  lastRenderPixelRatio = 0;
}

function setHybridRayTracing(enabled, persist = true) {
  hybridRayTracingEnabled = Boolean(composer) && Boolean(enabled);
  if(rayTracingToggle) rayTracingToggle.checked = hybridRayTracingEnabled;
  if(persist){
    try {
      localStorage.setItem("tankHybridRayTracing", hybridRayTracingEnabled ? "on" : "off");
    } catch (_) {}
  }
  nextHighPolySelectionAt = 0;
  ssrSelectionDirty = true;
  applyRenderQuality();
}

let savedRayTracing = null;
try {
  savedRayTracing = localStorage.getItem("tankHybridRayTracing");
} catch (_) {}
// Keep the expensive multi-pass renderer opt-in. An explicit prior "on" is preserved.
setHybridRayTracing(savedRayTracing === "on", false);
if (rayTracingToggle) {
  rayTracingToggle.disabled = !composer;
  rayTracingToggle.addEventListener("change", () => {
    setHybridRayTracing(rayTracingToggle.checked, true);
  });
}

const hemi = new THREE.HemisphereLight(0xffe8c6, 0x514638, 1.65);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffd3a0, 4.1);
sun.position.set(-80, 125, -55);
sun.castShadow = true;
sun.shadow.mapSize.set(MOBILE ? 1024 : 2048, MOBILE ? 1024 : 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 310;
sun.shadow.camera.left = -72;
sun.shadow.camera.right = 72;
sun.shadow.camera.top = 72;
sun.shadow.camera.bottom = -72;
sun.shadow.bias = -0.00016;
sun.shadow.normalBias = 0.035;
scene.add(sun, sun.target);

const fillLight = new THREE.DirectionalLight(0x9ec8ff, 0.55);
fillLight.position.set(80, 55, 90);
scene.add(fillLight);

let mapKey = "";
let obstacleReference = null;
let terrain = null;
let terrainSeed = 1;
let terrainHeight = () => 0;
let worldWidth = 2400;
let worldHeight = 1600;
let worldMaterials = null;
let lastFrame = performance.now();
let aimWorld = null;
const tankTemplates = new Map();

const tankMeshes = new Map();
const highPolyEnemyIds = new Set();
const pumpAnimations = [];
const flareAnimations = [];
const waterAnimations = [];
const explosionEffects = [];
const recentExplosionEvents = [];
const objectiveMeshes = [];

const cameraViews = [
  { distance: 20, height: 8.5, lookAhead: 5.5, label: "Close" },
  { distance: 29, height: 12.5, lookAhead: 8.5, label: "Tactical" },
  { distance: 43, height: 20, lookAhead: 12, label: "Command" },
];
let cameraViewIndex = 1;
let cameraDistance = cameraViews[cameraViewIndex].distance;
let cameraHeight = cameraViews[cameraViewIndex].height;
const smoothedCamera = new THREE.Vector3(-20, 12, 20);
const smoothedLookAt = new THREE.Vector3();
let pointerX = 0;
let pointerY = 0;
let hasPointer = false;
let visualAimPitch = 0;
let garageCanvasActive = false;
let garageVisual = null;
let garageVisualId = "";
let garageOrbit = -0.42;
let garageDistance = 10.5;
let garageLookHeight = 2.2;
let garageDragging = false;
let garageLastPointerX = 0;
let garageAimYaw = 0.28;
let garageAimPitch = 0.06;
let garageHasPointer = false;
let garageRenderWidth = 0;
let garageRenderHeight = 0;
let garageRenderPixelRatio = 0;

const raycaster = new THREE.Raycaster();
const aimPlane = new THREE.Plane(UP, 0);
const rayHit = new THREE.Vector3();

const tankMaterials = {
  ally: new THREE.MeshStandardMaterial({ color: 0x66765a, roughness: 0.82, metalness: 0.18 }),
  enemy: new THREE.MeshStandardMaterial({ color: 0x72524a, roughness: 0.84, metalness: 0.16 }),
  track: new THREE.MeshStandardMaterial({ color: 0x181a18, roughness: 0.96, metalness: 0.38 }),
  wheel: new THREE.MeshStandardMaterial({ color: 0x31352f, roughness: 0.8, metalness: 0.42 }),
  gun: new THREE.MeshStandardMaterial({ color: 0x3d433a, roughness: 0.7, metalness: 0.5 }),
};

const tankGeometry = {
  hull: new THREE.BoxGeometry(5.7, 1.25, 2.85, 3, 2, 2),
  upperHull: new THREE.BoxGeometry(3.9, 0.82, 2.35, 2, 2, 2),
  track: new THREE.BoxGeometry(5.8, 0.75, 0.48, 4, 2, 2),
  wheel: new THREE.CylinderGeometry(0.42, 0.42, 0.34, 24, 2),
  turret: new THREE.CylinderGeometry(1.17, 1.35, 0.82, 32, 2),
  barrel: new THREE.CylinderGeometry(0.11, 0.14, 3.45, 18, 4),
  cupola: new THREE.CylinderGeometry(0.38, 0.45, 0.34, 24, 2),
};

for (const geometry of Object.values(tankGeometry)) {
  geometry.computeVertexNormals();
}

const bulletGeometry = new THREE.SphereGeometry(0.13, 12, 8);
const bulletMaterial = new THREE.MeshBasicMaterial({ color: 0xffe7aa, toneMapped: false });
const SHELL_RENDER_COLORS = Object.freeze({
  AP:0xffd06a, HE:0xff6b2f, HEAT:0xff74c8, APFSDS:0x70dfff,
  FLAME:0xff5a20, LASER:0x8cf6ff
});
const bulletInstances = new THREE.InstancedMesh(bulletGeometry, bulletMaterial, 640);
bulletInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
bulletInstances.frustumCulled = false;
effectsRoot.add(bulletInstances);

const MAX_GROUND_MARKS = MOBILE ? 900 : 1800;

function makeGroundMarkTexture(wheeled){
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = 256;
  textureCanvas.height = 64;
  const context = textureCanvas.getContext("2d");
  context.clearRect(0, 0, textureCanvas.width, textureCanvas.height);
  context.fillStyle = wheeled ? "rgba(255,255,255,.52)" : "rgba(255,255,255,.36)";
  context.fillRect(0, wheeled ? 22 : 10, textureCanvas.width, wheeled ? 20 : 44);
  context.strokeStyle = "rgba(255,255,255,.98)";
  context.lineCap = "square";
  if(wheeled){
    context.lineWidth = 5;
    for(let x = -8; x < textureCanvas.width + 12; x += 18){
      context.beginPath();
      context.moveTo(x, 22);
      context.lineTo(x + 11, 42);
      context.stroke();
    }
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(0, 32);
    context.lineTo(textureCanvas.width, 32);
    context.stroke();
  } else {
    context.lineWidth = 7;
    for(let x = -16; x < textureCanvas.width + 20; x += 22){
      context.beginPath();
      context.moveTo(x, 10);
      context.lineTo(x + 19, 54);
      context.stroke();
      context.beginPath();
      context.moveTo(x + 19, 10);
      context.lineTo(x, 54);
      context.stroke();
    }
    context.lineWidth = 3;
    context.strokeRect(1.5, 11.5, textureCanvas.width - 3, 41);
  }
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

function createGroundMarkInstances(wheeled){
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({
    map: makeGroundMarkTexture(wheeled),
    color: 0xffffff,
    transparent: true,
    opacity: wheeled ? 0.58 : 0.68,
    alphaTest: 0.025,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexColors: true,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const instances = new THREE.InstancedMesh(geometry, material, MAX_GROUND_MARKS);
  instances.name = wheeled ? "wheel-rut-instances" : "tank-tread-instances";
  instances.count = 0;
  instances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  instances.frustumCulled = false;
  instances.renderOrder = 2;
  instances.raycast = () => {};
  return instances;
}

const treadMarkInstances = createGroundMarkInstances(false);
const wheelMarkInstances = createGroundMarkInstances(true);
effectsRoot.add(treadMarkInstances, wheelMarkInstances);

const GROUND_MARK_PALETTES = Object.freeze({
  Desert: { fresh:new THREE.Color(0x332519), faded:new THREE.Color(0xa77e50) },
  Urban: { fresh:new THREE.Color(0x202120), faded:new THREE.Color(0x555653) },
  Forest: { fresh:new THREE.Color(0x192017), faded:new THREE.Color(0x394432) },
  Snow: { fresh:new THREE.Color(0x6d7880), faded:new THREE.Color(0xd3e0e5) },
  Jungle: { fresh:new THREE.Color(0x151d14), faded:new THREE.Color(0x2d3d2c) },
  Beach: { fresh:new THREE.Color(0x443827), faded:new THREE.Color(0xb6a273) },
});
const markNormal = new THREE.Vector3();
const markForward = new THREE.Vector3();
const markSide = new THREE.Vector3();
const markBasis = new THREE.Matrix4();

function terrainNormalAt(x, z, target){
  const sample = 0.38;
  const left = terrainHeight(x - sample, z);
  const right = terrainHeight(x + sample, z);
  const down = terrainHeight(x, z - sample);
  const up = terrainHeight(x, z + sample);
  return target.set(left - right, sample * 2, down - up).normalize();
}

function syncGroundMarks(state, frameTime){
  const tracks = state.tracks || [];
  const palette = GROUND_MARK_PALETTES[state.env] || GROUND_MARK_PALETTES.Desert;
  let treadCount = 0;
  let wheelCount = 0;

  for(let index = tracks.length - 1; index >= 0; index -= 1){
    const mark = tracks[index];
    const instances = mark.kind === "wheel" ? wheelMarkInstances : treadMarkInstances;
    const instanceIndex = mark.kind === "wheel" ? wheelCount : treadCount;
    if(instanceIndex >= MAX_GROUND_MARKS) continue;

    gameToWorld(mark.x, mark.y, 0.045, tempPosition);
    terrainNormalAt(tempPosition.x, tempPosition.z, markNormal);
    markForward.set(Math.cos(mark.ang), 0, Math.sin(mark.ang));
    markForward.addScaledVector(markNormal, -markForward.dot(markNormal)).normalize();
    markSide.crossVectors(markNormal, markForward).normalize();
    markBasis.makeBasis(markForward, markSide, markNormal);
    tempQuaternion.setFromRotationMatrix(markBasis);
    tempScale.set(
      Math.max(0.45, (mark.length || 9) * WORLD_SCALE),
      Math.max(0.22, (mark.width || 7) * WORLD_SCALE),
      1
    );
    tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
    instances.setMatrixAt(instanceIndex, tempMatrix);

    const age = clamp((frameTime - mark.born) / Math.max(1, mark.life || 1), 0, 1);
    const visibility = (1 - age) * clamp(mark.intensity || 1, 0.45, 1);
    tempColor.copy(palette.faded).lerp(palette.fresh, visibility);
    instances.setColorAt(instanceIndex, tempColor);

    if(mark.kind === "wheel") wheelCount += 1;
    else treadCount += 1;
  }

  treadMarkInstances.count = treadCount;
  wheelMarkInstances.count = wheelCount;
  treadMarkInstances.instanceMatrix.needsUpdate = true;
  wheelMarkInstances.instanceMatrix.needsUpdate = true;
  if(treadMarkInstances.instanceColor) treadMarkInstances.instanceColor.needsUpdate = true;
  if(wheelMarkInstances.instanceColor) wheelMarkInstances.instanceColor.needsUpdate = true;
}


const explosionGeometry = {
  fireball: new THREE.SphereGeometry(1, MOBILE ? 20 : 32, MOBILE ? 13 : 20),
  smoke: new THREE.SphereGeometry(1, MOBILE ? 12 : 18, MOBILE ? 8 : 12),
  shockwave: new THREE.RingGeometry(0.72, 1, MOBILE ? 40 : 64),
  spark: new THREE.BoxGeometry(0.055, 0.055, 0.52),
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function dampFactor(speed, dt) {
  return 1 - Math.exp(-speed * dt);
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return function random() {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(edge0, edge1, value) {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

function valueNoise(x, z, seed) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);

  const sample = (sx, sz) => {
    let h = Math.imul(sx + seed * 17, 374761393) + Math.imul(sz - seed * 11, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };

  const a = sample(xi, zi);
  const b = sample(xi + 1, zi);
  const c = sample(xi, zi + 1);
  const d = sample(xi + 1, zi + 1);
  const ab = THREE.MathUtils.lerp(a, b, u);
  const cd = THREE.MathUtils.lerp(c, d, u);
  return THREE.MathUtils.lerp(ab, cd, v) * 2 - 1;
}

function fbm(x, z, seed) {
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  let normal = 0;
  for (let octave = 0; octave < 5; octave += 1) {
    total += valueNoise(x * frequency, z * frequency, seed + octave * 37) * amplitude;
    normal += amplitude;
    amplitude *= 0.52;
    frequency *= 2.03;
  }
  return total / normal;
}

function gameToWorld(gameX, gameY, lift = 0, target = new THREE.Vector3()) {
  const x = (gameX - worldWidth * 0.5) * WORLD_SCALE;
  const z = (gameY - worldHeight * 0.5) * WORLD_SCALE;
  return target.set(x, terrainHeight(x, z) + lift, z);
}

function worldToGame(point) {
  return {
    x: clamp(point.x / WORLD_SCALE + worldWidth * 0.5, 0, worldWidth),
    y: clamp(point.z / WORLD_SCALE + worldHeight * 0.5, 0, worldHeight),
  };
}

function setShadows(object, cast = true, receive = true) {
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = cast;
    child.receiveShadow = receive;
  });
  return object;
}

function makeMesh(geometry, material, cast = true, receive = true) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

function box(width, height, depth, material, cast = true, receive = true) {
  return makeMesh(new THREE.BoxGeometry(width, height, depth, 2, 2, 2), material, cast, receive);
}

function cylinder(radiusTop, radiusBottom, height, segments, material, cast = true, receive = true) {
  return makeMesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments, 3, false),
    material,
    cast,
    receive
  );
}

function beamBetween(start, end, radius, material, radialSegments = 10) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  const beam = cylinder(radius, radius, length, radialSegments, material);
  beam.position.copy(start).add(end).multiplyScalar(0.5);
  beam.quaternion.setFromUnitVectors(UP, direction.normalize());
  return beam;
}

function createSandTexture(seed, oilMap) {
  const size = 512;
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = size;
  textureCanvas.height = size;
  const context = textureCanvas.getContext("2d", { alpha: false });
  const random = mulberry32(seed ^ 0xa17f39);
  const image = context.createImageData(size, size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const wave = Math.sin((x + y * 0.35) * 0.075) * 3.5;
      const grain = (random() - 0.5) * 19;
      const base = oilMap ? [164, 126, 76] : [190, 158, 105];
      const index = (y * size + x) * 4;
      image.data[index] = clamp(base[0] + wave + grain, 0, 255);
      image.data[index + 1] = clamp(base[1] + wave * 0.72 + grain, 0, 255);
      image.data[index + 2] = clamp(base[2] + wave * 0.42 + grain * 0.7, 0, 255);
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);

  context.globalAlpha = 0.18;
  context.strokeStyle = oilMap ? "#5e452b" : "#7d6847";
  context.lineWidth = 1;
  for (let y = 8; y < size; y += 22) {
    context.beginPath();
    for (let x = 0; x <= size; x += 8) {
      const rippleY = y + Math.sin(x * 0.055 + y * 0.01) * 3;
      if (x === 0) context.moveTo(x, rippleY);
      else context.lineTo(x, rippleY);
    }
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(34, 24);
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

function createWorldMaterials(state) {
  const oilMap = state.mapName === "Middle East Oil Fields";
  const sandTexture = createSandTexture(terrainSeed, oilMap);
  return {
    ground: new THREE.MeshStandardMaterial({
      color: oilMap ? 0xc39158 : 0xd0b27b,
      map: sandTexture,
      bumpMap: sandTexture,
      bumpScale: 0.12,
      vertexColors: true,
      roughness: 0.98,
      metalness: 0,
    }),
    asphalt: new THREE.MeshStandardMaterial({ color: 0x4a443b, roughness: 0.95, metalness: 0.04 }),
    shoulder: new THREE.MeshStandardMaterial({ color: 0x806440, roughness: 1 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0xa69b84, roughness: 0.93, metalness: 0.02 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x655e53, roughness: 0.58, metalness: 0.74 }),
    darkSteel: new THREE.MeshStandardMaterial({ color: 0x292d2d, roughness: 0.52, metalness: 0.82 }),
    rust: new THREE.MeshStandardMaterial({ color: 0x7a3f23, roughness: 0.82, metalness: 0.42 }),
    pipe: new THREE.MeshStandardMaterial({ color: 0xb18a52, roughness: 0.5, metalness: 0.72 }),
    warning: new THREE.MeshStandardMaterial({ color: 0xe0a62c, roughness: 0.58, metalness: 0.45 }),
    tank: new THREE.MeshStandardMaterial({ color: 0xd7d0bd, roughness: 0.68, metalness: 0.42 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x62584e, roughness: 0.8, metalness: 0.28 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x587380,
      roughness: 0.25,
      metalness: 0.1,
      transparent: true,
      opacity: 0.72,
    }),
    rock: new THREE.MeshStandardMaterial({ color: 0x78654e, roughness: 1, metalness: 0 }),
    tree: new THREE.MeshStandardMaterial({ color: 0x3d5a35, roughness: 1 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x4d3827, roughness: 1 }),
    snow: new THREE.MeshStandardMaterial({ color: 0xdde8ee, roughness: 0.92 }),
  };
}

function disposeWorld() {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  worldRoot.traverse((object) => {
    if (object.geometry && !geometries.has(object.geometry)) {
      geometries.add(object.geometry);
      object.geometry.dispose();
    }
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of objectMaterials) {
      if (!material || materials.has(material)) continue;
      materials.add(material);
      for (const key of ["map", "bumpMap", "normalMap", "roughnessMap", "metalnessMap", "alphaMap", "emissiveMap"]) {
        const texture = material[key];
        if (!texture || textures.has(texture)) continue;
        textures.add(texture);
        texture.dispose();
      }
      material.dispose();
    }
  });
  worldRoot.clear();
  ssrSelectionDirty = true;
  pumpAnimations.length = 0;
  flareAnimations.length = 0;
  waterAnimations.length = 0;
  objectiveMeshes.length = 0;
  clearExplosionEffects();
}

function configureAtmosphere(state) {
  const palettes = {
    Desert: { sky: 0xbfcbd0, fog: 0xc1ac87, top: 0x3d6684, horizon: 0xe8c188, ground: 0x7f6748 },
    Urban: { sky: 0x84919a, fog: 0x777b7a, top: 0x536779, horizon: 0xb8aaa0, ground: 0x4f4f4c },
    Forest: { sky: 0x9bb8c4, fog: 0x76816c, top: 0x517b91, horizon: 0xc8c49d, ground: 0x344232 },
    Snow: { sky: 0xaec9dd, fog: 0xcbd8df, top: 0x5e86a4, horizon: 0xeaf2f3, ground: 0x85949b },
    Jungle: { sky: 0x7e9c98, fog: 0x4d6957, top: 0x3e6c71, horizon: 0xb8b890, ground: 0x263c2d },
    Beach: { sky: 0x8ec4dd, fog: 0xbcc6bb, top: 0x3f89b5, horizon: 0xf2d7a6, ground: 0x80765b },
  };
  const palette = palettes[state.env] || palettes.Desert;
  scene.background.setHex(palette.sky);
  scene.fog.color.setHex(palette.fog);
  scene.fog.density = state.mapName === "Middle East Oil Fields" ? 0.00135 : 0.00115;

  const skyGeometry = new THREE.SphereGeometry(1100, 64, 32);
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(palette.top) },
      horizonColor: { value: new THREE.Color(palette.horizon) },
      groundColor: { value: new THREE.Color(palette.ground) },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 groundColor;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition).y;
        float skyMix = smoothstep(-0.02, 0.56, h);
        vec3 upper = mix(horizonColor, topColor, skyMix);
        vec3 color = h < 0.0 ? mix(groundColor, horizonColor, smoothstep(-0.35, 0.0, h)) : upper;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeometry, skyMaterial);
  sky.frustumCulled = false;
  worldRoot.add(sky);

  const sunCanvas = document.createElement("canvas");
  sunCanvas.width = 128;
  sunCanvas.height = 128;
  const context = sunCanvas.getContext("2d");
  const gradient = context.createRadialGradient(64, 64, 3, 64, 64, 62);
  gradient.addColorStop(0, "rgba(255,250,221,1)");
  gradient.addColorStop(0.18, "rgba(255,218,142,.92)");
  gradient.addColorStop(1, "rgba(255,190,90,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const sunTexture = new THREE.CanvasTexture(sunCanvas);
  const sunSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: sunTexture, transparent: true, depthWrite: false, toneMapped: false })
  );
  sunSprite.position.set(-360, 255, -440);
  sunSprite.scale.set(72, 72, 1);
  worldRoot.add(sunSprite);
}

function buildTerrain(state) {
  const oilMap = state.mapName === "Middle East Oil Fields";
  const width = state.world.w * WORLD_SCALE;
  const depth = state.world.h * WORLD_SCALE;
  const segmentsX = oilMap ? (MOBILE ? 150 : 240) : (MOBILE ? 110 : 170);
  const segmentsZ = oilMap ? (MOBILE ? 104 : 164) : (MOBILE ? 76 : 116);

  terrainHeight = (x, z) => {
    const macro = fbm(x * 0.018, z * 0.018, terrainSeed) * (oilMap ? 4.6 : 3.6);
    const dunes = Math.sin(x * 0.055 + Math.sin(z * 0.018) * 2.1) * (oilMap ? 1.25 : 0.95);
    const cross = Math.sin(z * 0.041 - x * 0.013) * 0.72;
    let height = macro + dunes + cross;
    if (oilMap) {
      const mainRoad = smoothstep(2.2, 11.5, Math.abs(z));
      const crossRoad = smoothstep(2.2, 9.5, Math.abs(x));
      const roadFlatten = Math.min(mainRoad, crossRoad);
      height *= 0.24 + roadFlatten * 0.76;
    }
    for (const water of state.water || []) {
      const lakeX = (water.x - state.world.w * 0.5) * WORLD_SCALE;
      const lakeZ = (water.y - state.world.h * 0.5) * WORLD_SCALE;
      const lakeRadius = Math.max(2.5, (water.r || 120) * WORLD_SCALE);
      const lakeDistance = Math.hypot(x - lakeX, z - lakeZ);
      const lakeBlend = 1 - smoothstep(lakeRadius * 0.76, lakeRadius * 1.12, lakeDistance);
      height = THREE.MathUtils.lerp(height, -0.72, lakeBlend);
    }
    return height;
  };

  const geometry = new THREE.PlaneGeometry(width, depth, segmentsX, segmentsZ);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const low = new THREE.Color(oilMap ? 0x9b6b3d : 0xb58e58);
  const high = new THREE.Color(oilMap ? 0xd0a36b : 0xd7bc86);

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const z = positions.getZ(index);
    const y = terrainHeight(x, z);
    positions.setY(index, y);
    const blend = clamp(0.48 + y * 0.055 + valueNoise(x * 0.12, z * 0.12, terrainSeed) * 0.14, 0, 1);
    tempColor.copy(low).lerp(high, blend);
    colors[index * 3] = tempColor.r;
    colors[index * 3 + 1] = tempColor.g;
    colors[index * 3 + 2] = tempColor.b;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  terrain = makeMesh(geometry, worldMaterials.ground, false, true);
  worldRoot.add(terrain);
}

function createLakeGeometry(radius, radialSegments, rings) {
  const positions = [0, 0, 0];
  const uvs = [0.5, 0.5];
  const indices = [];
  for (let ring = 1; ring <= rings; ring += 1) {
    const ringRadius = radius * (ring / rings);
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const angle = (segment / radialSegments) * Math.PI * 2;
      const x = Math.cos(angle) * ringRadius;
      const z = Math.sin(angle) * ringRadius;
      positions.push(x, 0, z);
      uvs.push(x / (radius * 2) + 0.5, z / (radius * 2) + 0.5);
    }
  }
  for (let segment = 0; segment < radialSegments; segment += 1) {
    const next = (segment + 1) % radialSegments;
    indices.push(0, 1 + next, 1 + segment);
  }
  for (let ring = 2; ring <= rings; ring += 1) {
    const innerStart = 1 + (ring - 2) * radialSegments;
    const outerStart = innerStart + radialSegments;
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const next = (segment + 1) % radialSegments;
      indices.push(
        innerStart + segment,
        outerStart + next,
        outerStart + segment,
        innerStart + segment,
        innerStart + next,
        outerStart + next
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.userData.triangleCount = indices.length / 3;
  return geometry;
}

function buildWater(state) {
  const waters = Array.isArray(state.water) ? state.water : [];
  if (!waters.length) return;
  const radialSegments = MOBILE ? 96 : 192;
  const rings = MOBILE ? 38 : 72;
  for (const water of waters) {
    const gameRadius = water.r || Math.min(water.w || 120, water.h || 120) * 0.5;
    const radius = Math.max(2.5, gameRadius * WORLD_SCALE);
    const geometry = createLakeGeometry(radius, radialSegments, rings);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(state.env === "Snow" ? 0x123d4d : 0x07536a) },
        uShallow: { value: new THREE.Color(state.env === "Desert" ? 0x48a9a2 : 0x3d9eb8) },
      },
      vertexShader: `
        uniform float uTime;
        varying vec3 vWorldPosition;
        varying float vWave;
        varying vec2 vUv;
        void main() {
          vec3 transformed = position;
          float radial = length(uv - vec2(0.5)) * 2.0;
          float edgeFade = 1.0 - smoothstep(0.82, 1.0, radial);
          float waveA = sin(position.x * 0.72 + uTime * 1.45);
          float waveB = sin(position.z * 0.93 - uTime * 1.12);
          float waveC = sin((position.x + position.z) * 0.38 + uTime * 0.78);
          vWave = (waveA * 0.48 + waveB * 0.34 + waveC * 0.18) * edgeFade;
          transformed.y += vWave * 0.115;
          vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
          vWorldPosition = worldPosition.xyz;
          vUv = uv;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 uDeep;
        uniform vec3 uShallow;
        varying vec3 vWorldPosition;
        varying float vWave;
        varying vec2 vUv;
        void main() {
          vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
          float fresnel = pow(1.0 - max(dot(viewDirection, vec3(0.0, 1.0, 0.0)), 0.0), 2.4);
          float ripple = 0.5 + vWave * 0.5;
          vec3 waterColor = mix(uShallow, uDeep, clamp(0.35 + fresnel * 0.55 - ripple * 0.12, 0.0, 1.0));
          vec3 sunDirection = normalize(vec3(-0.42, 0.82, -0.28));
          vec3 reflected = reflect(-viewDirection, vec3(0.0, 1.0, 0.0));
          float sparkle = pow(max(dot(reflected, sunDirection), 0.0), 72.0);
          float edge = 1.0 - smoothstep(0.72, 1.0, length(vUv - vec2(0.5)) * 2.0);
          waterColor += vec3(1.0, 0.84, 0.58) * sparkle * 1.8;
          gl_FragColor = vec4(waterColor, 0.76 + fresnel * 0.16 + edge * 0.04);
        }
      `,
    });
    const lake = new THREE.Mesh(geometry, material);
    lake.userData.ssr = true;
    gameToWorld(water.x, water.y, 0.32, lake.position);
    lake.receiveShadow = true;
    lake.renderOrder = 3;
    worldRoot.add(lake);

    const shoreGeometry = new THREE.RingGeometry(radius * 0.96, radius * 1.08, radialSegments, 4);
    shoreGeometry.rotateX(-Math.PI / 2);
    const shoreMaterial = new THREE.MeshStandardMaterial({
      color: state.env === "Desert" ? 0x8b6842 : 0x6a705f,
      roughness: 1,
      metalness: 0,
    });
    const shore = new THREE.Mesh(shoreGeometry, shoreMaterial);
    shore.position.copy(lake.position);
    shore.position.y -= 0.07;
    shore.receiveShadow = true;
    worldRoot.add(shore);

    const foamGeometry = new THREE.RingGeometry(radius * 0.975, radius * 1.01, radialSegments, 1);
    foamGeometry.rotateX(-Math.PI / 2);
    const foamMaterial = new THREE.MeshBasicMaterial({
      color: 0xbde3dd,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      toneMapped: false,
    });
    const foam = new THREE.Mesh(foamGeometry, foamMaterial);
    foam.position.copy(lake.position);
    foam.position.y += 0.02;
    foam.renderOrder = 4;
    worldRoot.add(foam);
    waterAnimations.push({ material });
  }
}

function createRoadMesh(gamePoints, width, material, yOffset = 0.09) {
  const points = gamePoints.map(([x, y]) => gameToWorld(x, y, yOffset));
  const positions = [];
  const uvs = [];
  const indices = [];
  let distance = 0;

  for (let index = 0; index < points.length; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const tangent = new THREE.Vector3().subVectors(next, previous).setY(0).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).multiplyScalar(width * 0.5);
    if (index > 0) distance += points[index].distanceTo(points[index - 1]);
    const left = points[index].clone().add(side);
    const right = points[index].clone().sub(side);
    positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
    uvs.push(0, distance / 8, 1, distance / 8);
    if (index < points.length - 1) {
      const base = index * 2;
      indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const road = makeMesh(geometry, material, false, true);
  worldRoot.add(road);
  return road;
}

function buildOilRoads(state) {
  const horizontal = [];
  const vertical = [];
  const refinerySpur = [];
  const storageSpur = [];
  for (let index = 0; index <= 44; index += 1) {
    const t = index / 44;
    horizontal.push([
      120 + t * (state.world.w - 240),
      state.world.h * 0.5 + Math.sin(t * Math.PI * 3.2) * 24,
    ]);
    vertical.push([
      state.world.w * 0.5 + Math.sin(t * Math.PI * 2.4) * 18,
      120 + t * (state.world.h - 240),
    ]);
  }
  for (let index = 0; index <= 22; index += 1) {
    const t = index / 22;
    refinerySpur.push([1250 + t * 820, 770 - t * 315 + Math.sin(t * Math.PI) * 22]);
    storageSpur.push([1960 + t * 760, 660 - t * 250]);
  }

  for (const route of [horizontal, vertical, refinerySpur, storageSpur]) {
    createRoadMesh(route, route === horizontal ? 12.5 : 10.5, worldMaterials.shoulder, 0.06);
    createRoadMesh(route, route === horizontal ? 8.2 : 6.8, worldMaterials.asphalt, 0.12);
  }
}

function createRuggedRockGeometry(widthSegments, heightSegments, seedOffset) {
  const geometry = new THREE.SphereGeometry(1, widthSegments, heightSegments);
  const position = geometry.attributes.position;
  const phase = seedOffset * 0.173;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const broad = Math.sin(x * 3.7 + phase) * Math.sin(z * 4.1 - phase * 0.6) * 0.09;
    const strata = Math.sin(y * 11.5 + x * 2.7 + phase) * 0.045;
    const chipped = (Math.abs(Math.sin((x - z) * 7.2 + phase)) - 0.5) * 0.07;
    const weathered = Math.sin(x * 17.0 + z * 13.0 + y * 9.0 + phase * 2.0) * 0.025;
    const radius = 1 + broad + strata + chipped + weathered;
    const px = x * radius * (0.96 + Math.sin(z * 3.0 + phase) * 0.045);
    let py = y * radius + Math.sin(x * 4.8 + z * 3.6 + phase) * 0.035;
    const pz = z * radius * (0.98 + Math.cos(x * 2.6 - phase) * 0.04);
    if (py < -0.58) py = -0.58 + (py + 0.58) * 0.12;
    position.setXYZ(index, px, py, pz);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.triangleCount = geometry.index ? geometry.index.count / 3 : position.count / 3;
  return geometry;
}

function createRockInstances(obstacles, state) {
  const rocks = obstacles.filter((obstacle) => obstacle.kind === "rock" || obstacle.kind === "ice");
  if (!rocks.length) return;
  const variantCount = MOBILE ? 2 : 3;
  const geometrySets = Array.from({ length: variantCount }, (_, variant) => ({
    high: createRuggedRockGeometry(MOBILE ? 84 : 160, MOBILE ? 52 : 96, 17 + variant * 31),
    medium: createRuggedRockGeometry(MOBILE ? 48 : 72, MOBILE ? 30 : 44, 17 + variant * 31),
    low: createRuggedRockGeometry(28, 18, 17 + variant * 31),
  }));
  const material = state.env === "Snow" ? worldMaterials.snow : worldMaterials.rock;
  const random = mulberry32(terrainSeed ^ 0x82bc3);

  rocks.forEach((obstacle, index) => {
    const hitWidth = (obstacle.hitW || obstacle.w) * WORLD_SCALE;
    const hitDepth = (obstacle.hitH || obstacle.h) * WORLD_SCALE;
    const centerX = obstacle.x + obstacle.w * 0.5;
    const centerY = obstacle.y + obstacle.h * 0.5;
    const height = Math.min(hitWidth, hitDepth) * (0.42 + random() * 0.18);
    const set = geometrySets[index % geometrySets.length];
    const lod = new THREE.LOD();
    const addLevel = (geometry, distance) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      lod.addLevel(mesh, distance);
    };
    addLevel(set.high, 0);
    addLevel(set.medium, MOBILE ? 18 : 30);
    addLevel(set.low, MOBILE ? 48 : 78);
    gameToWorld(centerX, centerY, 0.18, lod.position);
    lod.position.y += height * 0.54;
    lod.rotation.set((random() - 0.5) * 0.24, random() * Math.PI * 2, (random() - 0.5) * 0.2);
    lod.scale.set(
      hitWidth * (0.43 + random() * 0.15),
      height,
      hitDepth * (0.42 + random() * 0.16)
    );

    const cluster = new THREE.Group();
    const satelliteCount = MOBILE ? 1 : 2;
    for (let satelliteIndex = 0; satelliteIndex < satelliteCount; satelliteIndex += 1) {
      const satellite = new THREE.Mesh(set.low, material);
      const side = satelliteIndex === 0 ? -1 : 1;
      satellite.position.set(
        side * (0.62 + random() * 0.22),
        -0.32 + random() * 0.09,
        (random() - 0.5) * 0.72
      );
      satellite.rotation.set(random() * 0.45, random() * Math.PI * 2, random() * 0.35);
      satellite.scale.set(0.28 + random() * 0.16, 0.24 + random() * 0.15, 0.27 + random() * 0.16);
      satellite.castShadow = true;
      satellite.receiveShadow = true;
      cluster.add(satellite);
    }
    lod.add(cluster);
    worldRoot.add(lod);
  });
}

function createDerrick(width, depth) {
  const group = new THREE.Group();
  const baseWidth = clamp(Math.min(width, depth) * 0.68, 4.6, 6.2);
  const height = 20;
  const levels = 6;
  const bottom = [
    new THREE.Vector3(-baseWidth / 2, 0, -baseWidth / 2),
    new THREE.Vector3(baseWidth / 2, 0, -baseWidth / 2),
    new THREE.Vector3(baseWidth / 2, 0, baseWidth / 2),
    new THREE.Vector3(-baseWidth / 2, 0, baseWidth / 2),
  ];
  const top = bottom.map((point) => new THREE.Vector3(point.x * 0.18, height, point.z * 0.18));

  for (let side = 0; side < 4; side += 1) {
    group.add(beamBetween(bottom[side], top[side], 0.16, worldMaterials.darkSteel, 12));
  }

  for (let level = 0; level <= levels; level += 1) {
    const t = level / levels;
    const y = t * height;
    const half = THREE.MathUtils.lerp(baseWidth / 2, baseWidth * 0.09, t);
    const corners = [
      new THREE.Vector3(-half, y, -half),
      new THREE.Vector3(half, y, -half),
      new THREE.Vector3(half, y, half),
      new THREE.Vector3(-half, y, half),
    ];
    for (let side = 0; side < 4; side += 1) {
      group.add(beamBetween(corners[side], corners[(side + 1) % 4], 0.09, worldMaterials.rust, 8));
    }
    if (level < levels) {
      const nextT = (level + 1) / levels;
      const nextY = nextT * height;
      const nextHalf = THREE.MathUtils.lerp(baseWidth / 2, baseWidth * 0.09, nextT);
      for (let side = 0; side < 4; side += 1) {
        const a = corners[side];
        const b = new THREE.Vector3(
          side === 0 || side === 3 ? -nextHalf : nextHalf,
          nextY,
          side < 2 ? -nextHalf : nextHalf
        );
        const c = corners[(side + 1) % 4];
        group.add(beamBetween(a, b, 0.055, worldMaterials.steel, 7));
        group.add(beamBetween(c, b, 0.055, worldMaterials.steel, 7));
      }
    }
  }

  const platform = box(baseWidth * 0.42, 0.22, baseWidth * 0.42, worldMaterials.warning);
  platform.position.y = height * 0.68;
  group.add(platform);
  const crown = box(1.45, 0.85, 1.25, worldMaterials.darkSteel);
  crown.position.y = height + 0.35;
  group.add(crown);
  const drillPipe = cylinder(0.08, 0.08, height * 0.78, 12, worldMaterials.pipe);
  drillPipe.position.y = height * 0.39;
  group.add(drillPipe);
  return group;
}

function createPumpjack(width, depth, phase) {
  const group = new THREE.Group();
  const base = box(Math.max(5.6, width * 0.72), 0.45, Math.max(3.3, depth * 0.76), worldMaterials.concrete);
  base.position.y = 0.22;
  group.add(base);

  const leftFoot = new THREE.Vector3(-1.55, 0.45, -0.8);
  const rightFoot = new THREE.Vector3(-1.55, 0.45, 0.8);
  const pivotLeft = new THREE.Vector3(0.15, 4.6, -0.62);
  const pivotRight = new THREE.Vector3(0.15, 4.6, 0.62);
  group.add(beamBetween(leftFoot, pivotLeft, 0.18, worldMaterials.darkSteel, 12));
  group.add(beamBetween(rightFoot, pivotRight, 0.18, worldMaterials.darkSteel, 12));
  group.add(beamBetween(new THREE.Vector3(1.55, 0.45, -0.8), pivotLeft, 0.18, worldMaterials.darkSteel, 12));
  group.add(beamBetween(new THREE.Vector3(1.55, 0.45, 0.8), pivotRight, 0.18, worldMaterials.darkSteel, 12));

  const wheel = cylinder(1.15, 1.15, 0.34, 36, worldMaterials.rust);
  wheel.rotation.x = Math.PI / 2;
  wheel.position.set(-2.05, 1.62, 0);
  group.add(wheel);
  const wheelHub = cylinder(0.3, 0.3, 0.52, 24, worldMaterials.darkSteel);
  wheelHub.rotation.x = Math.PI / 2;
  wheelHub.position.copy(wheel.position);
  group.add(wheelHub);

  const rocker = new THREE.Group();
  rocker.position.set(0.1, 4.65, 0);
  const beam = box(Math.max(7.2, width * 0.78), 0.42, 0.62, worldMaterials.warning);
  beam.position.x = 0.5;
  rocker.add(beam);
  const horseHead = box(0.68, 2.15, 0.9, worldMaterials.rust);
  horseHead.position.set(4.05, -0.72, 0);
  horseHead.rotation.z = -0.24;
  rocker.add(horseHead);
  const counterweight = cylinder(0.78, 0.78, 0.72, 28, worldMaterials.darkSteel);
  counterweight.rotation.x = Math.PI / 2;
  counterweight.position.set(-3.0, -0.48, 0);
  rocker.add(counterweight);
  group.add(rocker);

  const wellHead = cylinder(0.24, 0.3, 1.0, 20, worldMaterials.pipe);
  wellHead.position.set(4.1, 0.72, 0);
  group.add(wellHead);
  pumpAnimations.push({ rocker, wheel, phase });
  return group;
}

function createStorageTank(width, depth) {
  const group = new THREE.Group();
  const radius = clamp(Math.min(width, depth) * 0.43, 3.8, 5.4);
  const height = radius * 1.18;
  const body = cylinder(radius, radius, height, MOBILE ? 40 : 72, worldMaterials.tank);
  body.position.y = height * 0.5;
  group.add(body);
  const roof = makeMesh(
    new THREE.CylinderGeometry(0.18, radius * 1.015, radius * 0.32, MOBILE ? 40 : 72, 3),
    worldMaterials.roof
  );
  roof.position.y = height + radius * 0.16;
  group.add(roof);

  for (let ring = 1; ring <= 3; ring += 1) {
    const band = makeMesh(
      new THREE.TorusGeometry(radius * 1.008, 0.055, 8, MOBILE ? 40 : 72),
      worldMaterials.darkSteel
    );
    band.rotation.x = Math.PI / 2;
    band.position.y = (height * ring) / 4;
    group.add(band);
  }

  const ladderRailA = box(0.07, height + 0.8, 0.07, worldMaterials.darkSteel);
  const ladderRailB = ladderRailA.clone();
  ladderRailA.position.set(radius + 0.12, height * 0.5, -0.27);
  ladderRailB.position.set(radius + 0.12, height * 0.5, 0.27);
  group.add(ladderRailA, ladderRailB);
  for (let rung = 0; rung < 12; rung += 1) {
    const step = box(0.07, 0.06, 0.58, worldMaterials.darkSteel);
    step.position.set(radius + 0.12, 0.35 + (rung * height) / 11, 0);
    group.add(step);
  }
  return group;
}

function createRefinery(width, depth, variant) {
  const group = new THREE.Group();
  const slab = box(width * 0.92, 0.35, depth * 0.92, worldMaterials.concrete);
  slab.position.y = 0.18;
  group.add(slab);

  const random = mulberry32(terrainSeed + variant * 829);
  const columns = variant % 2 ? 3 : 4;
  for (let index = 0; index < columns; index += 1) {
    const radius = 0.72 + random() * 0.42;
    const height = 8.5 + random() * 7;
    const column = cylinder(radius, radius * 1.04, height, MOBILE ? 24 : 40, worldMaterials.steel);
    column.position.set(
      -width * 0.32 + (index / Math.max(1, columns - 1)) * width * 0.64,
      height * 0.5 + 0.35,
      (random() - 0.5) * depth * 0.42
    );
    group.add(column);
    for (let band = 1; band <= 4; band += 1) {
      const ring = makeMesh(
        new THREE.TorusGeometry(radius * 1.035, 0.05, 8, MOBILE ? 24 : 40),
        worldMaterials.darkSteel
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.copy(column.position);
      ring.position.y = 0.35 + (height * band) / 5;
      group.add(ring);
    }
    const cap = makeMesh(
      new THREE.SphereGeometry(radius, MOBILE ? 20 : 32, MOBILE ? 10 : 18, 0, Math.PI * 2, 0, Math.PI / 2),
      worldMaterials.steel
    );
    cap.position.copy(column.position);
    cap.position.y = height + 0.35;
    group.add(cap);
  }

  const platformY = 6.5;
  const platform = box(width * 0.78, 0.22, depth * 0.52, worldMaterials.darkSteel);
  platform.position.y = platformY;
  group.add(platform);
  for (const x of [-width * 0.36, width * 0.36]) {
    for (const z of [-depth * 0.22, depth * 0.22]) {
      group.add(beamBetween(new THREE.Vector3(x, 0.35, z), new THREE.Vector3(x, platformY, z), 0.1, worldMaterials.darkSteel));
    }
  }

  const pipePoints = [
    new THREE.Vector3(-width * 0.4, 2.1, depth * 0.34),
    new THREE.Vector3(-width * 0.12, 2.1, depth * 0.34),
    new THREE.Vector3(width * 0.1, 4.2, depth * 0.34),
    new THREE.Vector3(width * 0.42, 4.2, depth * 0.34),
  ];
  const pipeCurve = new THREE.CatmullRomCurve3(pipePoints);
  const pipe = makeMesh(new THREE.TubeGeometry(pipeCurve, 48, 0.18, 12, false), worldMaterials.pipe);
  group.add(pipe);
  return group;
}

function createWarehouse(width, depth) {
  const group = new THREE.Group();
  const height = clamp(Math.min(width, depth) * 0.46, 4.2, 7.2);
  const walls = box(width * 0.92, height, depth * 0.88, worldMaterials.concrete);
  walls.position.y = height * 0.5;
  group.add(walls);

  const roofA = box(width * 0.98, 0.28, depth * 0.54, worldMaterials.roof);
  const roofB = roofA.clone();
  roofA.rotation.x = Math.PI * 0.105;
  roofB.rotation.x = -Math.PI * 0.105;
  roofA.position.set(0, height + 0.55, -depth * 0.22);
  roofB.position.set(0, height + 0.55, depth * 0.22);
  group.add(roofA, roofB);

  const door = box(0.18, height * 0.65, depth * 0.42, worldMaterials.darkSteel);
  door.position.set(width * 0.47, height * 0.33, 0);
  group.add(door);
  for (let index = -1; index <= 1; index += 1) {
    const windowMesh = box(0.2, 0.75, 1.1, worldMaterials.glass, false, true);
    windowMesh.position.set(-width * 0.47, height * 0.62, index * depth * 0.24);
    group.add(windowMesh);
  }
  return group;
}

function createCheckpoint(width, depth) {
  const group = new THREE.Group();
  const cabin = box(width * 0.48, 2.6, depth * 0.24, worldMaterials.concrete);
  cabin.position.set(-width * 0.18, 1.3, -depth * 0.27);
  group.add(cabin);
  const windowMesh = box(width * 0.22, 0.8, 0.08, worldMaterials.glass, false, true);
  windowMesh.position.set(-width * 0.18, 1.7, -depth * 0.395);
  group.add(windowMesh);
  const canopy = box(width * 0.92, 0.28, depth * 0.62, worldMaterials.warning);
  canopy.position.y = 4.0;
  group.add(canopy);
  for (const x of [-width * 0.38, width * 0.38]) {
    for (const z of [-depth * 0.2, depth * 0.2]) {
      const post = box(0.18, 4, 0.18, worldMaterials.darkSteel);
      post.position.set(x, 2, z);
      group.add(post);
    }
  }
  const barrier = box(width * 0.7, 0.18, 0.24, worldMaterials.warning);
  barrier.position.set(width * 0.12, 1.1, depth * 0.18);
  barrier.rotation.y = 0.12;
  group.add(barrier);
  return group;
}

function createGenericObstacle(obstacle, state, index) {
  const width = (obstacle.hitW || obstacle.w) * WORLD_SCALE;
  const depth = (obstacle.hitH || obstacle.h) * WORLD_SCALE;
  if (obstacle.kind === "tree") {
    const group = new THREE.Group();
    const trunk = cylinder(0.24, 0.34, 2.8, 12, worldMaterials.trunk);
    trunk.position.y = 1.4;
    group.add(trunk);
    const crown = makeMesh(new THREE.IcosahedronGeometry(1.7, 2), worldMaterials.tree);
    crown.position.y = 3.6;
    crown.scale.set(1, 1.25, 1);
    group.add(crown);
    return group;
  }
  if (obstacle.kind === "crate") {
    const crate = box(width, Math.max(1.4, Math.min(width, depth) * 0.8), depth, worldMaterials.rust);
    return crate;
  }
  const height = obstacle.kind === "building" ? 5 + (index % 5) * 1.8 : Math.max(2.2, Math.min(width, depth) * 0.65);
  const building = box(width, height, depth, obstacle.kind === "ice" ? worldMaterials.snow : worldMaterials.concrete);
  building.position.y = height * 0.5;
  return building;
}

function buildObstacles(state) {
  createRockInstances(state.obstacles, state);
  let refineryVariant = 0;
  state.obstacles.forEach((obstacle, index) => {
    if (obstacle.kind === "wall" || obstacle.kind === "rock" || obstacle.kind === "ice") return;
    const width = Math.max(0.8, (obstacle.hitW || obstacle.w) * WORLD_SCALE);
    const depth = Math.max(0.8, (obstacle.hitH || obstacle.h) * WORLD_SCALE);
    let object;
    if (obstacle.kind === "derrick") object = createDerrick(width, depth);
    else if (obstacle.kind === "pumpjack") object = createPumpjack(width, depth, index * 0.73);
    else if (obstacle.kind === "storage") object = createStorageTank(width, depth);
    else if (obstacle.kind === "refinery") object = createRefinery(width, depth, refineryVariant++);
    else if (obstacle.kind === "warehouse") object = createWarehouse(width, depth);
    else if (obstacle.kind === "checkpoint") object = createCheckpoint(width, depth);
    else object = createGenericObstacle(obstacle, state, index);

    const centerX = obstacle.x + obstacle.w * 0.5;
    const centerY = obstacle.y + obstacle.h * 0.5;
    gameToWorld(centerX, centerY, 0.02, object.position);
    if (["tree", "crate", "building", "ruin", "bunker"].includes(obstacle.kind)) {
      object.rotation.y = (hashString(`${centerX}:${centerY}`) % 628) / 100;
    }
    setShadows(object);
    worldRoot.add(object);
  });
}

function createPipeline(gamePoints, radius = 0.22, lift = 1.65) {
  const points = gamePoints.map(([x, y]) => gameToWorld(x, y, lift));
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  const geometry = new THREE.TubeGeometry(curve, MOBILE ? 64 : 128, radius, MOBILE ? 8 : 14, false);
  const pipe = makeMesh(geometry, worldMaterials.pipe);
  worldRoot.add(pipe);
  for (let step = 1; step < points.length - 1; step += 2) {
    const supportHeight = Math.max(0.5, points[step].y - terrainHeight(points[step].x, points[step].z));
    const support = box(0.18, supportHeight, 1.35, worldMaterials.darkSteel);
    support.position.copy(points[step]);
    support.position.y -= supportHeight * 0.5;
    worldRoot.add(support);
  }
}

function createFlareStack(gameX, gameY) {
  const group = new THREE.Group();
  const height = 23;
  const stack = cylinder(0.3, 0.7, height, MOBILE ? 16 : 28, worldMaterials.darkSteel);
  stack.position.y = height * 0.5;
  group.add(stack);
  for (let band = 1; band <= 7; band += 1) {
    const ring = makeMesh(new THREE.TorusGeometry(0.44 + band * 0.02, 0.045, 8, 28), worldMaterials.rust);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = (height * band) / 8;
    group.add(ring);
  }
  const flameMaterial = new THREE.MeshBasicMaterial({ color: 0xffad35, transparent: true, opacity: 0.88, toneMapped: false });
  const flame = makeMesh(new THREE.ConeGeometry(0.62, 2.25, 24, 5), flameMaterial, false, false);
  flame.position.y = height + 1.0;
  group.add(flame);
  const glow = new THREE.PointLight(0xff8b32, 28, 42, 2);
  glow.position.y = height;
  group.add(glow);
  gameToWorld(gameX, gameY, 0.05, group.position);
  flareAnimations.push({ flame, glow, phase: gameX * 0.01 });
  worldRoot.add(group);
}

function createFence(start, end, postCount) {
  const a = gameToWorld(start[0], start[1], 0);
  const b = gameToWorld(end[0], end[1], 0);
  for (let index = 0; index < postCount; index += 1) {
    const t = index / (postCount - 1);
    const point = a.clone().lerp(b, t);
    point.y = terrainHeight(point.x, point.z);
    const post = box(0.1, 2.3, 0.1, worldMaterials.darkSteel);
    post.position.copy(point);
    post.position.y += 1.15;
    worldRoot.add(post);
  }
  for (const height of [0.65, 1.25, 1.85]) {
    const points = [];
    for (let index = 0; index < postCount; index += 1) {
      const t = index / (postCount - 1);
      const point = a.clone().lerp(b, t);
      point.y = terrainHeight(point.x, point.z) + height;
      points.push(point);
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const wire = makeMesh(new THREE.TubeGeometry(curve, postCount * 3, 0.025, 6, false), worldMaterials.darkSteel);
    worldRoot.add(wire);
  }
}

function createPowerLine(gamePoints) {
  const polePoints = gamePoints.map(([x, y]) => gameToWorld(x, y, 0));
  polePoints.forEach((point) => {
    const height = 8.5;
    const pole = cylinder(0.16, 0.25, height, 12, worldMaterials.darkSteel);
    pole.position.copy(point);
    pole.position.y += height * 0.5;
    worldRoot.add(pole);
    const arm = box(3.6, 0.18, 0.18, worldMaterials.darkSteel);
    arm.position.copy(point);
    arm.position.y += height;
    worldRoot.add(arm);
  });
  for (const offset of [-1.45, 0, 1.45]) {
    const cablePoints = polePoints.map((point, index) => {
      const sag = index === 0 || index === polePoints.length - 1 ? 0 : -0.45;
      return new THREE.Vector3(point.x + offset, point.y + 8.45 + sag, point.z);
    });
    const curve = new THREE.CatmullRomCurve3(cablePoints);
    const cable = makeMesh(new THREE.TubeGeometry(curve, MOBILE ? 42 : 82, 0.035, 6, false), worldMaterials.darkSteel, false, false);
    worldRoot.add(cable);
  }
}

function createDesertClutter(state) {
  const count = MOBILE ? 180 : 420;
  const geometry = new THREE.DodecahedronGeometry(0.28, MOBILE ? 0 : 1);
  const instances = new THREE.InstancedMesh(geometry, worldMaterials.rock, count);
  instances.castShadow = false;
  instances.receiveShadow = true;
  const random = mulberry32(terrainSeed ^ 0x77aacc);
  for (let index = 0; index < count; index += 1) {
    const gameX = 70 + random() * (state.world.w - 140);
    const gameY = 70 + random() * (state.world.h - 140);
    gameToWorld(gameX, gameY, 0.12, tempPosition);
    const size = 0.28 + random() * 0.72;
    tempScale.set(size * (0.75 + random()), size * (0.4 + random() * 0.5), size * (0.75 + random()));
    tempQuaternion.setFromEuler(new THREE.Euler(random(), random() * Math.PI, random()));
    tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
    instances.setMatrixAt(index, tempMatrix);
  }
  instances.instanceMatrix.needsUpdate = true;
  worldRoot.add(instances);
}

function buildOilDetails(state) {
  buildOilRoads(state);
  createPipeline([[820, 480], [1090, 520], [1390, 540], [1710, 520], [2020, 470], [2350, 420]], 0.25, 1.8);
  createPipeline([[1280, 1710], [1450, 1480], [1560, 1190], [1600, 900], [1650, 610]], 0.2, 1.55);
  createPipeline([[2380, 1450], [2480, 1190], [2550, 900], [2500, 610], [2390, 430]], 0.18, 1.35);
  createFlareStack(1910, 520);
  createFence([1950, 220], [2760, 220], 18);
  createFence([2760, 220], [2760, 610], 12);
  createFence([1950, 610], [2760, 610], 18);
  createPowerLine([[380, 900], [720, 890], [1060, 910], [1400, 900], [1740, 925], [2080, 930], [2420, 920], [2760, 940]]);
  createDesertClutter(state);

  // Dense prop clusters around the refinery and storage farm.
  const random = mulberry32(terrainSeed ^ 0x4f901);
  for (let index = 0; index < (MOBILE ? 22 : 44); index += 1) {
    const barrel = cylinder(0.27, 0.27, 0.85, MOBILE ? 16 : 28, index % 4 === 0 ? worldMaterials.warning : worldMaterials.rust);
    const gameX = index < 22 ? 1320 + random() * 650 : 1980 + random() * 730;
    const gameY = index < 22 ? 300 + random() * 420 : 240 + random() * 390;
    gameToWorld(gameX, gameY, 0.44, barrel.position);
    barrel.rotation.y = random() * Math.PI;
    worldRoot.add(barrel);
  }
}

function buildObjectives(state) {
  const addRing = (x, y, radius, color, data) => {
    const ring = makeMesh(
      new THREE.RingGeometry(radius * WORLD_SCALE * 0.94, radius * WORLD_SCALE, 96),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.56, side: THREE.DoubleSide, depthWrite: false }),
      false,
      false
    );
    ring.rotation.x = -Math.PI / 2;
    gameToWorld(x, y, 0.24, ring.position);
    ring.userData.objective = data;
    objectiveMeshes.push(ring);
    worldRoot.add(ring);
  };
  if (state.mode === "DOM") {
    state.zones.forEach((zone) => addRing(zone.x, zone.y, zone.r, 0xf3d18a, zone));
  } else if (state.mode === "CAPTURE") {
    state.bases.forEach((base) => addRing(base.x, base.y, base.r, base.team === "YOU" ? 0x55ffad : 0xff655e, base));
  }
}

function buildMapBoundary() {
  const edgeSteps = MOBILE ? 36 : 72;
  const wallHeight = 3.2;
  const edgePoints = [];

  for(let i = 0; i < edgeSteps; i += 1){
    const t = i / edgeSteps;
    edgePoints.push([worldWidth * t, 0]);
  }
  for(let i = 0; i < edgeSteps; i += 1){
    const t = i / edgeSteps;
    edgePoints.push([worldWidth, worldHeight * t]);
  }
  for(let i = 0; i < edgeSteps; i += 1){
    const t = i / edgeSteps;
    edgePoints.push([worldWidth * (1 - t), worldHeight]);
  }
  for(let i = 0; i < edgeSteps; i += 1){
    const t = i / edgeSteps;
    edgePoints.push([0, worldHeight * (1 - t)]);
  }

  const positions = [];
  const indices = [];
  const topPoints = [];
  const bottoms = [];
  for(const [gameX, gameY] of edgePoints){
    const bottom = gameToWorld(gameX, gameY, 0.14, new THREE.Vector3());
    const top = bottom.clone();
    top.y += wallHeight;
    bottoms.push(bottom);
    topPoints.push(top);
    positions.push(bottom.x, bottom.y, bottom.z, top.x, top.y, top.z);
  }

  for(let i = 0; i < edgePoints.length; i += 1){
    const next = (i + 1) % edgePoints.length;
    const a = i * 2;
    const b = a + 1;
    const c = next * 2;
    const d = c + 1;
    indices.push(a, c, b, b, c, d);
  }

  const wallGeometry = new THREE.BufferGeometry();
  wallGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  wallGeometry.setIndex(indices);
  const wallMaterial = new THREE.MeshBasicMaterial({
    color: 0x087dff,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const wall = new THREE.Mesh(wallGeometry, wallMaterial);
  wall.renderOrder = 7;
  worldRoot.add(wall);

  const lineGeometry = new THREE.BufferGeometry().setFromPoints(topPoints);
  const lineMaterial = new THREE.LineBasicMaterial({
    color: 0x5dd6ff,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    toneMapped: false,
  });
  const topLine = new THREE.LineLoop(lineGeometry, lineMaterial);
  topLine.renderOrder = 8;
  worldRoot.add(topLine);

  const postEvery = MOBILE ? 8 : 7;
  const postCount = Math.ceil(bottoms.length / postEvery);
  const postGeometry = new THREE.BoxGeometry(0.11, wallHeight, 0.11);
  const postMaterial = new THREE.MeshBasicMaterial({
    color: 0x36b8ff,
    transparent: true,
    opacity: 0.68,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const posts = new THREE.InstancedMesh(postGeometry, postMaterial, postCount);
  let postIndex = 0;
  for(let i = 0; i < bottoms.length; i += postEvery){
    const position = bottoms[i].clone();
    position.y += wallHeight * 0.5;
    tempMatrix.compose(position, tempQuaternion.identity(), tempScale.set(1, 1, 1));
    posts.setMatrixAt(postIndex, tempMatrix);
    postIndex += 1;
  }
  posts.count = postIndex;
  posts.instanceMatrix.needsUpdate = true;
  posts.renderOrder = 8;
  worldRoot.add(posts);
}

function rebuildWorld(state) {
  disposeWorld();
  mapKey = `${state.mapName}|${state.env}|${state.world.w}x${state.world.h}`;
  obstacleReference = state.obstacles;
  worldWidth = state.world.w;
  worldHeight = state.world.h;
  terrainSeed = hashString(mapKey) || 1;
  worldMaterials = createWorldMaterials(state);
  configureAtmosphere(state);
  buildTerrain(state);
  buildWater(state);
  buildMapBoundary();
  if (state.mapName === "Middle East Oil Fields") buildOilDetails(state);
  buildObstacles(state);
  buildObjectives(state);
  ssrSelectionDirty = true;
}

function namedModelCenter(root, pattern){
  const bounds = new THREE.Box3();
  let matched = false;
  root.traverse((object) => {
    if(!object.isMesh || !pattern.test((object.name || "").toLowerCase())) return;
    const objectBounds = new THREE.Box3().setFromObject(object);
    if(objectBounds.isEmpty()) return;
    bounds.union(objectBounds);
    matched = true;
  });
  return matched ? bounds.getCenter(new THREE.Vector3()) : null;
}

function inferTankForwardYaw(root){
  root.updateMatrixWorld(true);
  const front = namedModelCenter(root, /front|glacis|bow|driver|headlight/);
  const rear = namedModelCenter(root, /rear|engine|exhaust|tail/);
  if(front && rear && Math.abs(front.x - rear.x) > 0.01){
    return front.x < rear.x ? Math.PI : 0;
  }
  return 0;
}

function prepareTankTemplate(gltf, visualType, forwardYaw = null, targetLength = 6.5) {
  const source = gltf.scene;
  source.updateMatrixWorld(true);
  const initialBox = new THREE.Box3().setFromObject(source);
  const initialSize = initialBox.getSize(new THREE.Vector3());

  const oriented = new THREE.Group();
  oriented.add(source);
  // Convert Z-up exports to Three.js Y-up before measuring or centring.
  const sourceIsZUp = initialBox.min.z > -initialSize.z * 0.12;
  if (sourceIsZUp) oriented.rotation.x = -Math.PI / 2;
  oriented.updateMatrixWorld(true);

  const orientedBox = new THREE.Box3().setFromObject(oriented);
  const orientedSize = orientedBox.getSize(new THREE.Vector3());
  const sourceForwardAxis = orientedSize.z > orientedSize.x ? "z" : "x";
  if (sourceForwardAxis === "z") oriented.rotation.y = Math.PI / 2;
  oriented.updateMatrixWorld(true);

  const resolvedForwardYaw = Number.isFinite(forwardYaw)
    ? forwardYaw
    : inferTankForwardYaw(oriented);

  let box3 = new THREE.Box3().setFromObject(oriented);
  let size = box3.getSize(new THREE.Vector3());
  const scale = targetLength / Math.max(size.x, size.z, 0.001);
  oriented.scale.setScalar(scale);
  oriented.updateMatrixWorld(true);
  box3 = new THREE.Box3().setFromObject(oriented);
  size = box3.getSize(new THREE.Vector3());
  const center = box3.getCenter(new THREE.Vector3());
  oriented.position.x -= center.x;
  oriented.position.z -= center.z;
  oriented.position.y -= box3.min.y;

  source.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.userData.ssr = true;
    if (object.material) {
      object.material.envMapIntensity = 0.7;
      object.material.needsUpdate = true;
    }
  });

  const normalized = new THREE.Group();
  normalized.add(oriented);
  normalized.userData.modelHeight = size.y;
  normalized.userData.visualType = visualType;
  normalized.userData.forwardYaw = resolvedForwardYaw;
  normalized.userData.sourceForwardAxis = sourceForwardAxis;
  return normalized;
}

async function loadHighPolyTank() {
  const loader = new GLTFLoader();
  const templates = [
    {
      key:"m3",
      url:"/assets/M3_Stuart_Early_HighPoly.glb",
      visualType:"high-poly-m3",
      label:"High-poly M3 Stuart model",
      forwardYaw:0,
      targetLength:6.5,
    },
    {
      key:"m5a1",
      url:"/assets/M5A1_Stuart_1M.glb",
      visualType:"high-poly-m5a1",
      label:"High-poly M5A1 Stuart model",
      forwardYaw:Math.PI,
      targetLength:6.5,
    },
    {
      key:"m8",
      url:"/assets/M8_Greyhound_1M_HighPoly.glb",
      visualType:"high-poly-m8-greyhound",
      label:"High-poly M8 Greyhound model",
      forwardYaw:null,
      targetLength:6.1,
    },
    {
      key:"m4",
      url:"/assets/M4 Sherman.glb",
      visualType:"high-poly-m4-sherman",
      label:"High-poly M4 Sherman model",
      // This export's modeled nose is -X after axis normalization.
      // Flip presentation only; controls, camera, turret aim and hitboxes stay +X.
      forwardYaw:Math.PI,
      targetLength:6.9,
    },
    {
      key:"firefly",
      url:"/assets/Sherman Firefly.glb",
      visualType:"high-poly-sherman-firefly",
      label:"High-poly Sherman Firefly model",
      // Match the verified Sherman-family -X authored nose to gameplay +X.
      forwardYaw:Math.PI,
      targetLength:7.2,
    },
    {
      key:"m10",
      url:"/assets/M10 Wolverine1.glb",
      visualType:"high-poly-m10-wolverine",
      label:"High-poly M10 Wolverine model",
      // The Wolverine uses the Sherman-chassis -X authored forward convention.
      forwardYaw:Math.PI,
      targetLength:7.0,
    },
  ];
  const selectedGarageKey = tankTemplateKeyFor({ def:{ name:garageTankSelect?.value || "" } });
  if(selectedGarageKey){
    templates.sort((a, b) => Number(b.key === selectedGarageKey) - Number(a.key === selectedGarageKey));
  }

  for(const spec of templates){
    if(!rendererHealthy) return;
    try {
      const gltf = await loader.loadAsync(spec.url);
      tankTemplates.set(
        spec.key,
        prepareTankTemplate(gltf, spec.visualType, spec.forwardYaw, spec.targetLength)
      );
      nextHighPolySelectionAt = 0;
      ssrSelectionDirty = true;
      console.info(`${spec.label} loaded for the 3D renderer.`);
    } catch (error) {
      console.warn(`${spec.label} could not load; using the procedural tank fallback.`, error);
    }
  }
}

function createMarker(team) {
  const color = team === "ENEMY" ? 0xff554d : 0x5bffac;
  const ring = makeMesh(
    new THREE.RingGeometry(2.4, 2.6, 64),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false }),
    false,
    false
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.12;
  return ring;
}

function createEnemyHealthBar() {
  const healthCanvas = document.createElement("canvas");
  healthCanvas.width = 256;
  healthCanvas.height = 64;
  const context = healthCanvas.getContext("2d");
  const texture = new THREE.CanvasTexture(healthCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.position.y = 4.4;
  sprite.scale.set(5.2, 1.04, 1);
  sprite.renderOrder = 900;
  sprite.frustumCulled = false;
  sprite.userData.healthContext = context;
  sprite.userData.healthTexture = texture;
  sprite.userData.lastHealthFraction = -1;
  sprite.userData.lastArmorStress = -1;
  return sprite;
}

function updateEnemyHealthBar(sprite, entity) {
  if (!sprite) return;
  const maxHealth =
    entity.maxHp ||
    entity.maxHP ||
    entity.hpMax ||
    entity.def?.hpMax ||
    entity.def?.hp ||
    entity.def?.HP ||
    Math.max(1, entity.hp || 1);
  const fraction = clamp((entity.hp || 0) / maxHealth, 0, 1);
  const armorValues = Object.values(entity.armorStress || {});
  const armorStress = clamp(Math.max(0, ...armorValues) / 0.65, 0, 1);
  if (
    Math.abs(fraction - sprite.userData.lastHealthFraction) < 0.002 &&
    Math.abs(armorStress - sprite.userData.lastArmorStress) < 0.002
  ) return;
  sprite.userData.lastHealthFraction = fraction;
  sprite.userData.lastArmorStress = armorStress;
  const context = sprite.userData.healthContext;
  const texture = sprite.userData.healthTexture;
  context.clearRect(0, 0, 256, 64);
  context.fillStyle = "rgba(10, 4, 4, 0.88)";
  context.fillRect(0, 5, 256, 38);
  context.fillStyle = "#4d0909";
  context.fillRect(6, 11, 244, 26);
  const gradient = context.createLinearGradient(0, 11, 0, 37);
  gradient.addColorStop(0, "#ff5a55");
  gradient.addColorStop(0.45, "#e21f26");
  gradient.addColorStop(1, "#8d0710");
  context.fillStyle = gradient;
  context.fillRect(6, 11, 244 * fraction, 26);
  context.fillStyle = "rgba(255,255,255,0.35)";
  context.fillRect(8, 13, Math.max(0, 240 * fraction - 4), 4);
  context.strokeStyle = "rgba(255, 220, 210, 0.88)";
  context.lineWidth = 2;
  context.strokeRect(4, 9, 248, 30);
  context.fillStyle = "rgba(9, 6, 2, 0.9)";
  context.fillRect(4, 47, 248, 12);
  const stressGradient = context.createLinearGradient(6, 0, 250, 0);
  stressGradient.addColorStop(0, "#ffd75a");
  stressGradient.addColorStop(1, "#ff6b20");
  context.fillStyle = stressGradient;
  context.fillRect(7, 50, 242 * armorStress, 6);
  context.strokeStyle = "rgba(255, 225, 145, 0.76)";
  context.lineWidth = 1;
  context.strokeRect(5, 48, 246, 10);
  texture.needsUpdate = true;
}

function createProceduralTank(entity, includeMarker = true) {
  const group = new THREE.Group();
  const bodyMaterial = entity.team === "ENEMY" ? tankMaterials.enemy : tankMaterials.ally;

  const hull = makeMesh(tankGeometry.hull, bodyMaterial);
  hull.position.y = 1.02;
  group.add(hull);
  const upperHull = makeMesh(tankGeometry.upperHull, bodyMaterial);
  upperHull.position.set(-0.15, 1.93, 0);
  group.add(upperHull);

  for (const side of [-1, 1]) {
    const track = makeMesh(tankGeometry.track, tankMaterials.track);
    track.position.set(0, 0.66, side * 1.57);
    group.add(track);
    for (let wheelIndex = 0; wheelIndex < 5; wheelIndex += 1) {
      const wheel = makeMesh(tankGeometry.wheel, tankMaterials.wheel);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(-2.0 + wheelIndex, 0.67, side * 1.82);
      group.add(wheel);
    }
  }

  const turretPivot = new THREE.Group();
  turretPivot.name = "procedural-turret";
  turretPivot.position.set(0.2, 2.45, 0);
  const turret = makeMesh(tankGeometry.turret, bodyMaterial);
  turretPivot.add(turret);
  const cupola = makeMesh(tankGeometry.cupola, bodyMaterial);
  cupola.position.set(-0.2, 0.64, 0);
  turretPivot.add(cupola);

  const gunPitchPivot = new THREE.Group();
  gunPitchPivot.name = "procedural-gun-elevation";
  gunPitchPivot.position.set(1.02, 0.12, 0);
  gunPitchPivot.userData.pitchAxis = "z";
  gunPitchPivot.userData.pitchSign = 1;
  gunPitchPivot.userData.basePitch = 0;
  const barrel = makeMesh(tankGeometry.barrel, tankMaterials.gun);
  barrel.rotation.z = -Math.PI / 2;
  barrel.position.set(1.63, 0, 0);
  gunPitchPivot.add(barrel);
  turretPivot.add(gunPitchPivot);

  group.add(turretPivot);
  group.userData.forwardYaw = 0;
  group.userData.sourceForwardAxis = "x";
  group.userData.turretPivot = turretPivot;
  group.userData.gunPitchPivot = gunPitchPivot;
  if(includeMarker){
    group.userData.marker = createMarker(entity.team);
    group.add(group.userData.marker);
  }

  const classScale = entity.def?.klass === "Heavy" ? 1.16 : entity.def?.klass === "Light" ? 0.92 : 1;
  group.scale.setScalar(classScale);
  return group;
}

function findTurretNode(root) {
  const candidates = [];
  root.traverse((object) => {
    const name = (object.name || "").toLowerCase();
    if (/turret|gun[_ -]?mount|tower/.test(name)) candidates.push(object);
  });
  const node =
    candidates.find((candidate) => /turret/.test((candidate.name || "").toLowerCase())) ||
    candidates[0] ||
    null;
  if (node && !Number.isFinite(node.userData.baseYaw)) node.userData.baseYaw = node.rotation.y;
  return node;
}

function gunNodeScore(object, turretRoot){
  if(!object || object === turretRoot) return -Infinity;
  const name = (object.name || "").toLowerCase();
  if(!name || /machine[_ -]?gun|coax|antenna|cupola|hatch/.test(name)) return -Infinity;
  let score = 0;
  if(/trunnion|elevat|gun[_ -]?(mount|pivot)|mantlet/.test(name)) score += 120;
  if(/main[_ -]?gun|cannon|barrel|gun[_ -]?tube/.test(name)) score += 80;
  if(/\bgun\b/.test(name)) score += 35;
  if(object.children?.length) score += 8;
  if(object.isMesh) score += 4;
  return score;
}

function findGunPitchNode(turretRoot, visualRoot) {
  if(!turretRoot) return null;
  const candidates = [];
  turretRoot.traverse((object) => {
    const score = gunNodeScore(object, turretRoot);
    if(score > 0) candidates.push({ object, score });
  });
  candidates.sort((a, b) => b.score - a.score);
  const node = candidates[0]?.object || null;
  if(!node) return null;

  const sourceForwardAxis = visualRoot.userData.sourceForwardAxis === "z" ? "z" : "x";
  const pitchAxis = sourceForwardAxis === "z" ? "x" : "z";
  const forwardSign = Math.cos(visualRoot.userData.forwardYaw || 0) >= 0 ? 1 : -1;
  node.userData.pitchAxis = pitchAxis;
  node.userData.pitchSign = sourceForwardAxis === "z" ? -forwardSign : forwardSign;
  node.userData.basePitch = node.rotation[pitchAxis];
  return node;
}

function configureTankRig(group) {
  if(!group) return group;
  const turretPivot = group.userData.turretPivot || findTurretNode(group);
  group.userData.turretPivot = turretPivot;
  if(turretPivot && !Number.isFinite(turretPivot.userData.baseYaw)){
    turretPivot.userData.baseYaw = turretPivot.rotation.y;
  }
  if(!group.userData.gunPitchPivot){
    group.userData.gunPitchPivot = findGunPitchNode(turretPivot, group);
  }
  return group;
}

function applyGunElevation(group, pitchRadians) {
  const pivot = group?.userData?.gunPitchPivot;
  if(!pivot) return false;
  const axis = pivot.userData.pitchAxis || "z";
  const basePitch = Number.isFinite(pivot.userData.basePitch) ? pivot.userData.basePitch : 0;
  const pitchSign = Number.isFinite(pivot.userData.pitchSign) ? pivot.userData.pitchSign : 1;
  pivot.rotation[axis] = basePitch + clamp(pitchRadians, -0.14, 0.28) * pitchSign;
  return true;
}

function tankTemplateKeyFor(entity) {
  const name = (entity.def?.name || "").trim().toLowerCase();
  if(name === "m5 stuart" || name.includes("m5a1 stuart")) return "m5a1";
  if(name.includes("m3 stuart") || name.includes("m2a4")) return "m3";
  if(name.includes("m8 greyhound")) return "m8";
  if(name.includes("sherman firefly")) return "firefly";
  if(name.includes("m10 wolverine")) return "m10";
  if(name.startsWith("m4 sherman")) return "m4";
  return null;
}

function garagePreviewIsVisible(){
  if(!garageHost || !garageMenuOverlay || document.body.classList.contains("battle")) return false;
  return getComputedStyle(garageMenuOverlay).display !== "none";
}

function setGarageStatus(message){
  if(garageStatus) garageStatus.textContent = message;
}

function setRendererCanvasMode(useGarage){
  if(useGarage && garageHost){
    if(canvas.parentElement !== garageHost){
      garageHost.insertBefore(canvas, garageHost.firstChild);
      canvas.setAttribute("aria-label", "Interactive 3D garage tank preview");
      garageRenderWidth = 0;
      garageRenderHeight = 0;
      garageRenderPixelRatio = 0;
      lastRenderWidth = 0;
      lastRenderHeight = 0;
      lastRenderPixelRatio = 0;
    }
    garageCanvasActive = true;
    return;
  }
  if(battlefieldCanvasParent && canvas.parentElement !== battlefieldCanvasParent){
    battlefieldCanvasParent.insertBefore(canvas, inputCanvas);
    canvas.setAttribute("aria-label", "3D tank battlefield");
    lastRenderWidth = 0;
    lastRenderHeight = 0;
    lastRenderPixelRatio = 0;
  }
  garageCanvasActive = false;
  garageHost?.classList.remove("garage3d-ready");
}

function garageSelectedName(){
  return (garageTankSelect?.value || "").trim();
}

function garageTemplateState(name){
  const key = tankTemplateKeyFor({ def:{ name } });
  const template = key ? tankTemplates.get(key) : null;
  return { key, template, id:`${name}|${template?.userData.visualType || (key ? "loading" : "procedural")}` };
}

function fitGarageCamera(visual){
  visual.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(visual);
  const size = bounds.getSize(new THREE.Vector3());
  garageLookHeight = clamp(size.y * 0.43, 1.15, 3.4);
  garageDistance = clamp(Math.max(size.x, size.z) * 1.52, 8.6, 14.5);
  garageCamera.position.set(garageDistance * 0.82, garageLookHeight + garageDistance * 0.34, garageDistance * 0.82);
  garageCamera.lookAt(0, garageLookHeight, 0);
}

function rebuildGarageVisual(name, previewState){
  if(garageVisual) garageModelRoot.remove(garageVisual);
  let visual;
  if(previewState.template){
    visual = previewState.template.clone(true);
    visual.userData.visualType = previewState.template.userData.visualType;
    configureTankRig(visual);
    setGarageStatus("HIGH-POLY 3D • MOVE MOUSE TO AIM • DRAG TO ROTATE • WHEEL TO ZOOM");
  } else {
    visual = createProceduralTank({ team:"YOU", def:{ name, klass:"Medium" } }, false);
    visual.userData.visualType = previewState.key ? "procedural-loading" : "procedural-garage";
    configureTankRig(visual);
    setGarageStatus(previewState.key ? `LOADING ${name.toUpperCase()} HIGH-POLY MODEL…` : "PROCEDURAL 3D PREVIEW • HIGH-POLY MODEL NOT LINKED");
  }
  visual.userData.currentGunPitch = 0;
  visual.rotation.y = visual.userData.forwardYaw || 0;
  garageModelRoot.add(visual);
  garageVisual = visual;
  garageVisualId = previewState.id;
  fitGarageCamera(visual);
}

function syncGaragePreview(frameTime, dt){
  const name = garageSelectedName();
  if(!name){
    setGarageStatus("SELECT A TANK FOR 3D PREVIEW");
    return;
  }
  const previewState = garageTemplateState(name);
  if(!garageVisual || garageVisualId !== previewState.id){
    rebuildGarageVisual(name, previewState);
  }
  if(!garageVisual) return;

  if(!garageDragging) garageOrbit += dt * 0.11;
  garageVisual.rotation.y = (garageVisual.userData.forwardYaw || 0) + garageOrbit;
  const turretPivot = garageVisual.userData.turretPivot;
  if(turretPivot){
    const baseYaw = Number.isFinite(turretPivot.userData.baseYaw) ? turretPivot.userData.baseYaw : 0;
    const idleYaw = Math.sin(frameTime * 0.00042) * 0.24;
    turretPivot.rotation.y = baseYaw + (garageHasPointer ? garageAimYaw : idleYaw);
  }
  const idlePitch = 0.045 + Math.sin(frameTime * 0.00066) * 0.055;
  applyGunElevation(garageVisual, garageHasPointer ? garageAimPitch : idlePitch);
}

function resizeGarageRenderer(){
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  const pixelRatio = renderer.getPixelRatio();
  if(
    width === garageRenderWidth &&
    height === garageRenderHeight &&
    Math.abs(pixelRatio - garageRenderPixelRatio) < 0.001
  ) return;
  renderer.setSize(width, height, false);
  garageCamera.aspect = width / height;
  garageCamera.updateProjectionMatrix();
  garageRenderWidth = width;
  garageRenderHeight = height;
  garageRenderPixelRatio = pixelRatio;
  lastRenderWidth = 0;
  lastRenderHeight = 0;
  lastRenderPixelRatio = 0;
}


function highPolyTemplateFor(entity) {
  if(MOBILE) return null;
  const key = tankTemplateKeyFor(entity);
  if(!key) return null;
  const localPlayerId = bridge.getState().player?.id;
  if(entity.id !== localPlayerId && !highPolyEnemyIds.has(entity.id)) return null;
  return tankTemplates.get(key) || null;
}

function disposeEntityVisual(visual) {
  if(!visual) return;
  const ownedObjects = [visual.userData.marker, visual.userData.healthBar].filter(Boolean);
  const disposedTextures = new Set();
  const disposedMaterials = new Set();
  for(const object of ownedObjects){
    if(object.geometry && typeof object.geometry.dispose === "function") object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for(const material of materials){
      if(!material || disposedMaterials.has(material)) continue;
      disposedMaterials.add(material);
      const texture = material.map;
      if(texture && !disposedTextures.has(texture)){
        disposedTextures.add(texture);
        texture.dispose();
      }
      material.dispose();
    }
  }
  entityRoot.remove(visual);
}

function refreshHighPolyEnemySelection(state, frameTime) {
  if(frameTime < nextHighPolySelectionAt) return;
  nextHighPolySelectionAt = frameTime + 850;

  // Keep every supported visible enemy on its high-poly template. The previous
  // nearest-one/two budget caused distant M2/M3/M5 tanks to swap to the basic
  // procedural model as the player moved.
  const nextIds = new Set();
  if(!MOBILE){
    for(const entity of (state.entities || [])){
      if(entity.type !== "tank" || entity.team !== "ENEMY" || !entity.alive) continue;
      if(!bridge.isVisibleToPlayer(entity)) continue;
      const key = tankTemplateKeyFor(entity);
      if(key && tankTemplates.has(key)) nextIds.add(entity.id);
    }
  }

  const changed =
    nextIds.size !== highPolyEnemyIds.size ||
    [...nextIds].some((id) => !highPolyEnemyIds.has(id));
  if(!changed) return;
  highPolyEnemyIds.clear();
  for(const id of nextIds) highPolyEnemyIds.add(id);
}

function createEntityVisual(entity) {
  let group;
  const template = highPolyTemplateFor(entity);
  if (template) {
    group = template.clone(true);
    group.userData.marker = createMarker(entity.team);
    group.add(group.userData.marker);
    group.userData.visualType = template.userData.visualType;
  } else {
    group = createProceduralTank(entity);
    group.userData.visualType = "procedural";
  }
  configureTankRig(group);
  if (entity.team === "ENEMY") {
    group.userData.healthBar = createEnemyHealthBar();
    group.add(group.userData.healthBar);
    updateEnemyHealthBar(group.userData.healthBar, entity);
  }
  group.userData.entityId = entity.id;
  entityRoot.add(group);
  tankMeshes.set(entity.id, group);
  ssrSelectionDirty = true;
  return group;
}

function syncEntities(state, frameTime) {
  refreshHighPolyEnemySelection(state, frameTime);

  const liveIds = new Set();
  for (const entity of state.entities) {
    if (entity.type !== "tank") continue;
    liveIds.add(entity.id);
    let visual = tankMeshes.get(entity.id);
    const desiredType = highPolyTemplateFor(entity)?.userData.visualType || "procedural";
    if (visual && visual.userData.visualType !== desiredType) {
      disposeEntityVisual(visual);
      tankMeshes.delete(entity.id);
      ssrSelectionDirty = true;
      visual = null;
    }
    if (!visual) visual = createEntityVisual(entity);

    const visibleToPlayer = bridge.isVisibleToPlayer(entity);
    visual.visible = entity.alive && visibleToPlayer;
    if (!visual.visible) continue;

    gameToWorld(entity.x, entity.y, 0.08, visual.position);
    // Some imported GLBs use -X as their visual front. Keep gameplay controls
    // in the shared +X convention and correct only that model's presentation.
    visual.rotation.y = -entity.bodyA + (visual.userData.forwardYaw || 0);
    const turretPivot = visual.userData.turretPivot;
    if (turretPivot) {
      const baseYaw = Number.isFinite(turretPivot.userData.baseYaw) ? turretPivot.userData.baseYaw : 0;
      turretPivot.rotation.y = baseYaw + entity.bodyA - entity.turretA;
    }
    const desiredPitch = entity.id === state.player?.id
      ? visualAimPitch
      : clamp(Number(entity.turretPitch) || 0, -0.14, 0.28);
    const previousPitchFrame = visual.userData.lastPitchFrame || frameTime;
    const pitchDt = clamp((frameTime - previousPitchFrame) / 1000, 0, 0.05);
    visual.userData.lastPitchFrame = frameTime;
    const currentPitch = Number.isFinite(visual.userData.currentGunPitch)
      ? visual.userData.currentGunPitch
      : 0;
    visual.userData.currentGunPitch = THREE.MathUtils.lerp(
      currentPitch,
      desiredPitch,
      dampFactor(11, pitchDt)
    );
    applyGunElevation(visual, visual.userData.currentGunPitch);
    if (visual.userData.marker) {
      visual.userData.marker.material.opacity = entity.team === "ENEMY" ? 0.56 : 0.42;
    }
    if(visual.userData.healthBar){
      const contactVisible = bridge.isContactVisibleToPlayer
        ? bridge.isContactVisibleToPlayer(entity)
        : visibleToPlayer;
      const barDistance = camera.position.distanceTo(visual.position);
      const distanceScale = clamp(barDistance/60,1,8);
      visual.userData.healthBar.scale.set(5.2*distanceScale,1.04*distanceScale,1);
      visual.userData.healthBar.visible = entity.alive && contactVisible;
      if(contactVisible) updateEnemyHealthBar(visual.userData.healthBar, entity);
    }
  }

  for (const [id, visual] of tankMeshes) {
    if (liveIds.has(id)) continue;
    disposeEntityVisual(visual);
    tankMeshes.delete(id);
    ssrSelectionDirty = true;
  }
}

function syncBullets(state) {
  const bullets = state.bullets || [];
  bulletInstances.count = Math.min(bullets.length, bulletInstances.instanceMatrix.count);
  for (let index = 0; index < bulletInstances.count; index += 1) {
    const bullet = bullets[index];
    gameToWorld(bullet.x, bullet.y, 2.25, tempPosition);
    tempQuaternion.setFromEuler(new THREE.Euler(0, -bullet.ang, 0));
    const shellLength = bullet.shell === "APFSDS" ? 1.65 : bullet.shell === "HE" ? 1.28 : 1.15;
    const shellWidth = bullet.shell === "HE" ? 1.24 : 1.0;
    tempScale.set(shellLength, shellWidth, shellWidth);
    tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
    bulletInstances.setMatrixAt(index, tempMatrix);
    tempColor.setHex(SHELL_RENDER_COLORS[bullet.shell] || (bullet.team === "YOU" ? 0x8affc0 : 0xff745f));
    if(bullet.team === "ENEMY") tempColor.lerp(enemyShellTint, 0.22);
    bulletInstances.setColorAt(index, tempColor);
  }
  bulletInstances.instanceMatrix.needsUpdate = true;
  if (bulletInstances.instanceColor) bulletInstances.instanceColor.needsUpdate = true;
}

function createExplosionEffect(gameX, gameY, started, intensity) {
  if (explosionEffects.length >= 14) removeExplosionEffect(explosionEffects.shift());
  const group = new THREE.Group();
  gameToWorld(gameX, gameY, 0.46, group.position);
  group.scale.setScalar(clamp(intensity || 1, 0.8, 1.5));
  const makeAdditiveMaterial = (color, opacity) =>
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
  const outer = new THREE.Mesh(explosionGeometry.fireball, makeAdditiveMaterial(0xff5a12, 0.9));
  const core = new THREE.Mesh(explosionGeometry.fireball, makeAdditiveMaterial(0xfff2b0, 1));
  core.scale.setScalar(0.48);
  const shockwave = new THREE.Mesh(explosionGeometry.shockwave, makeAdditiveMaterial(0xffb54a, 0.78));
  shockwave.rotation.x = -Math.PI / 2;
  group.add(outer, core, shockwave);

  const random = mulberry32(hashString(`${Math.round(gameX)}:${Math.round(gameY)}:${Math.round(started * 1000)}`));
  const smoke = [];
  for (let index = 0; index < 5; index += 1) {
    const smokeMaterial = new THREE.MeshBasicMaterial({
      color: index < 2 ? 0x5d5148 : 0x3b3a38,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    });
    const puff = new THREE.Mesh(explosionGeometry.smoke, smokeMaterial);
    const angle = random() * Math.PI * 2;
    const base = new THREE.Vector3(Math.cos(angle) * random() * 0.4, random() * 0.35, Math.sin(angle) * random() * 0.4);
    const velocity = new THREE.Vector3(
      Math.cos(angle) * (0.35 + random() * 0.65),
      1.5 + random() * 1.5,
      Math.sin(angle) * (0.35 + random() * 0.65)
    );
    puff.position.copy(base);
    group.add(puff);
    smoke.push({ puff, base, velocity, delay: index * 0.055 });
  }

  const sparkMaterial = makeAdditiveMaterial(0xffd06b, 1);
  const sparks = new THREE.InstancedMesh(explosionGeometry.spark, sparkMaterial, MOBILE ? 12 : 22);
  sparks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  sparks.frustumCulled = false;
  const sparkDirections = [];
  const sparkRotations = [];
  const sparkSpeeds = [];
  const forward = new THREE.Vector3(0, 0, 1);
  for (let index = 0; index < sparks.count; index += 1) {
    const angle = random() * Math.PI * 2;
    const elevation = 0.18 + random() * 0.62;
    const direction = new THREE.Vector3(
      Math.cos(angle) * Math.cos(elevation),
      Math.sin(elevation),
      Math.sin(angle) * Math.cos(elevation)
    ).normalize();
    sparkDirections.push(direction);
    sparkRotations.push(new THREE.Quaternion().setFromUnitVectors(forward, direction));
    sparkSpeeds.push(4.5 + random() * 9.5);
  }
  group.add(sparks);
  const light = new THREE.PointLight(0xff6a1b, MOBILE ? 55 : 92, 42, 2);
  light.position.y = 1.1;
  group.add(light);
  effectsRoot.add(group);
  explosionEffects.push({
    group, started, outer, core, shockwave, smoke, sparks,
    sparkDirections, sparkRotations, sparkSpeeds, light,
  });
}

function removeExplosionEffect(effect) {
  if (!effect) return;
  effectsRoot.remove(effect.group);
  const materials = new Set();
  effect.group.traverse((object) => {
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of objectMaterials) {
      if (!material || materials.has(material)) continue;
      materials.add(material);
      material.dispose();
    }
  });
}

function clearExplosionEffects() {
  while (explosionEffects.length) removeExplosionEffect(explosionEffects.pop());
  recentExplosionEvents.length = 0;
}

function syncExplosionEvents(state, timeMs) {
  const batches = [];
  for (const particle of state.particles || []) {
    // Gun recoil uses the same lightweight particle system as impacts. Do not
    // turn those muzzle puffs into full fireball/shockwave explosions.
    if (particle.effectKind === "muzzle") continue;
    if (!Number.isFinite(particle.born) || !Number.isFinite(particle.x) || !Number.isFinite(particle.y)) continue;
    const age = timeMs - particle.born;
    if (age < -20 || age > 170) continue;
    let batch = batches.find(
      (candidate) =>
        Math.abs(candidate.born - particle.born) < 75 &&
        (candidate.x - particle.x) ** 2 + (candidate.y - particle.y) ** 2 < 4
    );
    if (!batch) {
      batch = { x: particle.x, y: particle.y, born: particle.born, count: 0 };
      batches.push(batch);
    }
    batch.count += 1;
  }
  for (const batch of batches) {
    const duplicate = recentExplosionEvents.some(
      (event) =>
        Math.abs(event.born - batch.born) < 110 &&
        (event.x - batch.x) ** 2 + (event.y - batch.y) ** 2 < 9
    );
    if (duplicate) continue;
    recentExplosionEvents.push({ x: batch.x, y: batch.y, born: batch.born, seen: timeMs });
    const intensity = clamp(0.82 + Math.sqrt(batch.count) * 0.11, 0.88, 1.45);
    createExplosionEffect(batch.x, batch.y, timeMs / 1000, intensity);
  }
  for (let index = recentExplosionEvents.length - 1; index >= 0; index -= 1) {
    if (timeMs - recentExplosionEvents[index].seen > 2400) recentExplosionEvents.splice(index, 1);
  }
}

function updateExplosionEffects(time) {
  for (let effectIndex = explosionEffects.length - 1; effectIndex >= 0; effectIndex -= 1) {
    const effect = explosionEffects[effectIndex];
    const age = Math.max(0, time - effect.started);
    const t = clamp(age / 1.55, 0, 1);
    const burst = Math.min(1, age * 11);
    effect.outer.scale.setScalar((0.35 + burst * 2.25 + t * 1.2) * (1 - t * 0.18));
    effect.outer.material.opacity = Math.max(0, (1 - t) * 0.94);
    effect.core.scale.setScalar(0.3 + burst * 1.25);
    effect.core.material.opacity = Math.max(0, 1 - t * 2.2);
    effect.shockwave.scale.setScalar(0.8 + t * 10.5);
    effect.shockwave.material.opacity = Math.max(0, 0.72 * (1 - t) ** 2);
    effect.light.intensity = (1 - t) ** 3 * (MOBILE ? 55 : 92);
    for (const smoke of effect.smoke) {
      const localAge = Math.max(0, age - smoke.delay);
      smoke.puff.visible = localAge > 0;
      smoke.puff.position.copy(smoke.base).addScaledVector(smoke.velocity, localAge);
      smoke.puff.scale.setScalar(0.28 + localAge * 1.72);
      smoke.puff.material.opacity = Math.max(0, Math.sin(Math.min(1, localAge * 3.3) * Math.PI * 0.5) * (1 - t) * 0.5);
    }
    for (let index = 0; index < effect.sparks.count; index += 1) {
      const direction = effect.sparkDirections[index];
      const speed = effect.sparkSpeeds[index];
      tempPosition.copy(direction).multiplyScalar(speed * age);
      tempPosition.y -= 4.8 * age * age;
      tempScale.setScalar(Math.max(0.025, 0.9 - t * 0.82));
      tempMatrix.compose(tempPosition, effect.sparkRotations[index], tempScale);
      effect.sparks.setMatrixAt(index, tempMatrix);
    }
    effect.sparks.instanceMatrix.needsUpdate = true;
    effect.sparks.material.opacity = Math.max(0, 1 - t * 1.25);
    if (t >= 1) {
      removeExplosionEffect(effect);
      explosionEffects.splice(effectIndex, 1);
    }
  }
}

function updateObjectives(time) {
  for (const ring of objectiveMeshes) {
    const data = ring.userData.objective;
    if (data?.owner === "YOU") ring.material.color.setHex(0x58ffac);
    else if (data?.owner === "ENEMY") ring.material.color.setHex(0xff6259);
    ring.material.opacity = 0.42 + Math.sin(time * 2.2 + ring.position.x) * 0.12;
  }
}

function updateAnimations(time) {
  for (const animation of pumpAnimations) {
    const motion = Math.sin(time * 0.82 + animation.phase);
    animation.rocker.rotation.z = -0.09 + motion * 0.115;
    animation.wheel.rotation.z = time * 0.68 + animation.phase;
  }
  for (const animation of flareAnimations) {
    const flicker = 0.84 + Math.sin(time * 13 + animation.phase) * 0.13 + Math.sin(time * 21) * 0.07;
    animation.flame.scale.set(0.86 + flicker * 0.16, flicker, 0.86 + flicker * 0.16);
    animation.flame.rotation.y = time * 2.4;
    animation.glow.intensity = 22 + flicker * 11;
  }
  for (const animation of waterAnimations) {
    animation.material.uniforms.uTime.value = time;
  }
}

function refreshSSRSelection() {
  if(!ssrPass) return;
  const selects = [];
  const inspect = (object) => {
    if(!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const reflectiveMaterial = materials.some((material) => (
      material &&
      !material.transparent &&
      typeof material.metalness === "number" &&
      material.metalness >= 0.14
    ));
    if(object.userData.ssr || reflectiveMaterial) selects.push(object);
  };
  worldRoot.traverse(inspect);
  entityRoot.traverse(inspect);
  ssrPass.selects = selects;
  ssrSelectionDirty = false;
}

function resizeRenderer() {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  const pixelRatio = renderer.getPixelRatio();
  if(
    width === lastRenderWidth &&
    height === lastRenderHeight &&
    Math.abs(pixelRatio - lastRenderPixelRatio) < 0.001
  ) return;

  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.fov = BASE_FOV;
  camera.updateProjectionMatrix();
  if(composer) composer.setSize(width, height);
  lastRenderWidth = width;
  lastRenderHeight = height;
  lastRenderPixelRatio = pixelRatio;
}

function updateCamera(state, dt) {
  const player = state.player;
  if (!player) {
    const orbit = performance.now() * 0.00007;
    const center = new THREE.Vector3(0, 0, 0);
    const desired = new THREE.Vector3(Math.cos(orbit) * 48, 24, Math.sin(orbit) * 48);
    smoothedCamera.lerp(desired, dampFactor(1.8, dt));
    smoothedLookAt.lerp(center, dampFactor(2.2, dt));
    camera.position.copy(smoothedCamera);
    camera.lookAt(smoothedLookAt);
    return;
  }

  const position = gameToWorld(player.x, player.y, 0.1);
  const forward = new THREE.Vector3(Math.cos(player.bodyA), 0, Math.sin(player.bodyA));
  const currentView = cameraViews[cameraViewIndex];
  const desired = position.clone().addScaledVector(forward, -cameraDistance);
  desired.y = terrainHeight(desired.x, desired.z) + cameraHeight;
  desired.y = Math.max(desired.y, position.y + 5.2);

  const target = position.clone().addScaledVector(forward, currentView.lookAhead);
  target.y += 2.25;
  smoothedCamera.lerp(desired, dampFactor(5.4, dt));
  smoothedLookAt.lerp(target, dampFactor(7.5, dt));
  camera.position.copy(smoothedCamera);
  camera.lookAt(smoothedLookAt);

  sun.position.copy(position).add(new THREE.Vector3(-85, 125, -62));
  sun.target.position.copy(position);
  sun.target.updateMatrixWorld();
}

function updateAim(state) {
  const rect = inputCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height || !state.player) {
    aimWorld = null;
    visualAimPitch = 0;
    return;
  }
  const localX = hasPointer ? pointerX : rect.width * 0.5;
  const localY = hasPointer ? pointerY : rect.height * 0.5;
  const pointerVertical = clamp(localY / rect.height, 0, 1);
  visualAimPitch = clamp((0.5 - pointerVertical) * 0.56 - 0.012, -0.14, 0.28);
  const ndc = new THREE.Vector2((localX / rect.width) * 2 - 1, -(localY / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const playerPosition = gameToWorld(state.player.x, state.player.y, 0);
  aimPlane.constant = -playerPosition.y;
  if (raycaster.ray.intersectPlane(aimPlane, rayHit)) {
    const gamePoint = worldToGame(rayHit);
    const dx = gamePoint.x - state.player.x;
    const dy = gamePoint.y - state.player.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 900) {
      gamePoint.x = state.player.x + (dx / distance) * 900;
      gamePoint.y = state.player.y + (dy / distance) * 900;
    }
    aimWorld = gamePoint;
  } else {
    aimWorld = {
      x: state.player.x + Math.cos(state.player.turretA) * 400,
      y: state.player.y + Math.sin(state.player.turretA) * 400,
    };
  }
  if (aimDot) {
    aimDot.style.left = `${localX}px`;
    aimDot.style.top = `${localY}px`;
  }
}

function updateCameraHint() {
  if (!cameraHint) return;
  const view = cameraViews[cameraViewIndex];
  cameraHint.textContent = `3D ${view.label} Camera · Wheel zoom · C view · FOV ${BASE_FOV}°`;
}

inputCanvas.addEventListener("pointermove", (event) => {
  const rect = inputCanvas.getBoundingClientRect();
  pointerX = clamp(event.clientX - rect.left, 0, rect.width);
  pointerY = clamp(event.clientY - rect.top, 0, rect.height);
  hasPointer = true;
});

canvas.addEventListener("pointerdown", (event) => {
  if(!garagePreviewIsVisible()) return;
  garageDragging = true;
  garageLastPointerX = event.clientX;
  canvas.setPointerCapture?.(event.pointerId);
  event.preventDefault();
});

canvas.addEventListener("pointermove", (event) => {
  if(!garagePreviewIsVisible()) return;
  const rect = canvas.getBoundingClientRect();
  const nx = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  const ny = clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
  garageAimYaw = clamp((nx - 0.5) * 1.65, -0.86, 0.86);
  garageAimPitch = clamp((0.5 - ny) * 0.52, -0.14, 0.28);
  garageHasPointer = true;
  if(garageDragging){
    garageOrbit += (event.clientX - garageLastPointerX) * 0.009;
    garageLastPointerX = event.clientX;
  }
});

canvas.addEventListener("pointerleave", () => {
  if(!garageDragging) garageHasPointer = false;
});
window.addEventListener("pointerup", (event) => {
  if(!garageDragging) return;
  garageDragging = false;
  canvas.releasePointerCapture?.(event.pointerId);
});

canvas.addEventListener("wheel", (event) => {
  if(!garagePreviewIsVisible()) return;
  garageDistance = clamp(garageDistance + Math.sign(event.deltaY) * 0.75, 7.2, 17);
  garageCamera.position.set(garageDistance * 0.82, garageLookHeight + garageDistance * 0.34, garageDistance * 0.82);
  garageCamera.lookAt(0, garageLookHeight, 0);
  event.preventDefault();
}, { passive:false });

inputCanvas.addEventListener(
  "wheel",
  (event) => {
    const delta = Math.sign(event.deltaY);
    cameraDistance = clamp(cameraDistance + delta * 2.2, 15, 52);
    cameraHeight = clamp(cameraHeight + delta * 1.05, 6.5, 25);
    event.preventDefault();
  },
  { passive: false }
);

window.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() !== "c" || event.repeat) return;
  cameraViewIndex = (cameraViewIndex + 1) % cameraViews.length;
  cameraDistance = cameraViews[cameraViewIndex].distance;
  cameraHeight = cameraViews[cameraViewIndex].height;
  updateCameraHint();
});

function presentThreeFrame() {
  if(threePresented) return;
  threePresented = true;
  window.Tank3D.ready = true;
  document.body.classList.add("three-ready");
}

function fallbackTo2D(error) {
  if(!rendererHealthy) return;
  rendererHealthy = false;
  hybridRayTracingEnabled = false;
  if(rayTracingToggle){
    rayTracingToggle.checked = false;
    rayTracingToggle.disabled = true;
  }
  if(window.Tank3D) window.Tank3D.ready = false;
  document.body.classList.remove("three-ready");
  garageHost?.classList.remove("garage3d-ready");
  setGarageStatus("3D PREVIEW UNAVAILABLE • USING GARAGE FALLBACK");
  setRendererCanvasMode(false);
  console.error("3D rendering stopped; restored the 2D battlefield fallback.", error);
}

window.Tank3D = {
  ready: false,
  getAimWorld: () => aimWorld,
  getAimPitch: () => visualAimPitch,
  getCameraInfo: () => ({ fov: camera.fov, near: camera.near, far: camera.far, view: cameraViews[cameraViewIndex].label }),
};

canvas.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  fallbackTo2D(new Error("The WebGL context was lost."));
}, false);

function animate(frameTime) {
  if(!rendererHealthy) return;
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, Math.max(0.001, (frameTime - lastFrame) / 1000));
  lastFrame = frameTime;

  const garageActive = garagePreviewIsVisible();
  setRendererCanvasMode(garageActive);
  if(garageActive){
    try {
      resizeGarageRenderer();
      syncGaragePreview(frameTime, dt);
      renderer.render(garageScene, garageCamera);
      garageHost?.classList.add("garage3d-ready");
    } catch (error) {
      fallbackTo2D(error);
    }
    return;
  }

  try {
    const state = bridge.getState();
    const nextMapKey = `${state.mapName}|${state.env}|${state.world.w}x${state.world.h}`;
    if(nextMapKey !== mapKey || obstacleReference !== state.obstacles) rebuildWorld(state);

    resizeRenderer();
    syncEntities(state, frameTime);
    syncGroundMarks(state, frameTime);
    syncBullets(state);
    syncExplosionEvents(state, frameTime);
    updateExplosionEffects(frameTime / 1000);
    updateCamera(state, dt);
    updateAim(state);
    updateAnimations(frameTime / 1000);
    updateObjectives(frameTime / 1000);
  } catch (error) {
    fallbackTo2D(error);
    return;
  }

  try {
    if(hybridRayTracingEnabled && composer){
      if(ssrSelectionDirty) refreshSSRSelection();
      composer.render(dt);
    } else {
      renderer.render(scene, camera);
    }
    presentThreeFrame();
  } catch (error) {
    if(hybridRayTracingEnabled){
      console.warn("Hybrid reflections failed; retrying with direct rendering.", error);
      setHybridRayTracing(false, true);
      try {
        renderer.render(scene, camera);
        presentThreeFrame();
        return;
      } catch (directError) {
        fallbackTo2D(directError);
        return;
      }
    }
    fallbackTo2D(error);
  }
}

loadHighPolyTank();
updateCameraHint();
rebuildWorld(bridge.getState());
requestAnimationFrame(animate);
}
