import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const bridge = window.TankGameBridge;
const canvas = document.getElementById("c3d");
const inputCanvas = document.getElementById("c");
const aimDot = document.getElementById("aimDot");
const cameraHint = document.getElementById("cameraHint");

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
    getCameraInfo: () => null,
  };
}

if (renderer) {
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MOBILE ? 1.25 : 1.8));
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
const pumpAnimations = [];
const flareAnimations = [];
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
const bulletInstances = new THREE.InstancedMesh(bulletGeometry, bulletMaterial, 640);
bulletInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
bulletInstances.frustumCulled = false;
effectsRoot.add(bulletInstances);

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
  worldRoot.traverse((object) => {
    if (object.geometry) object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      if (material.map) material.map.dispose();
      if (material.bumpMap && material.bumpMap !== material.map) material.bumpMap.dispose();
      material.dispose();
    }
  });
  worldRoot.clear();
  pumpAnimations.length = 0;
  flareAnimations.length = 0;
  objectiveMeshes.length = 0;
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
  scene.fog.density = state.mapName === "Middle East Oil Fields" ? 0.00205 : 0.00175;

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

function createRockInstances(obstacles, state) {
  const rocks = obstacles.filter((obstacle) => obstacle.kind === "rock" || obstacle.kind === "ice");
  if (!rocks.length) return;
  const geometry = new THREE.IcosahedronGeometry(1, MOBILE ? 1 : 2);
  const material = state.env === "Snow" ? worldMaterials.snow : worldMaterials.rock;
  const instances = new THREE.InstancedMesh(geometry, material, rocks.length);
  instances.castShadow = true;
  instances.receiveShadow = true;
  const random = mulberry32(terrainSeed ^ 0x82bc3);

  rocks.forEach((obstacle, index) => {
    const hitWidth = (obstacle.hitW || obstacle.w) * WORLD_SCALE;
    const hitDepth = (obstacle.hitH || obstacle.h) * WORLD_SCALE;
    const centerX = obstacle.x + obstacle.w * 0.5;
    const centerY = obstacle.y + obstacle.h * 0.5;
    gameToWorld(centerX, centerY, 0.2, tempPosition);
    tempPosition.y += Math.min(hitWidth, hitDepth) * 0.24;
    tempQuaternion.setFromEuler(
      new THREE.Euler(random() * 0.3, random() * Math.PI * 2, random() * 0.22)
    );
    tempScale.set(hitWidth * (0.42 + random() * 0.16), Math.min(hitWidth, hitDepth) * (0.35 + random() * 0.25), hitDepth * (0.4 + random() * 0.18));
    tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
    instances.setMatrixAt(index, tempMatrix);
  });
  instances.instanceMatrix.needsUpdate = true;
  worldRoot.add(instances);
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
  if (state.mapName === "Middle East Oil Fields") buildOilDetails(state);
  buildObstacles(state);
  buildObjectives(state);
}

function prepareTankTemplate(gltf, visualType) {
  const source = gltf.scene;
  source.updateMatrixWorld(true);
  const initialBox = new THREE.Box3().setFromObject(source);
  const initialSize = initialBox.getSize(new THREE.Vector3());

  const oriented = new THREE.Group();
  oriented.add(source);
  // This uploaded GLB is authored Z-up (its Z bounds start above zero while
  // X/Y are centred). Convert it to Three.js Y-up before sizing and centring.
  const sourceIsZUp = initialBox.min.z > -initialSize.z * 0.12;
  if (sourceIsZUp) oriented.rotation.x = -Math.PI / 2;
  oriented.updateMatrixWorld(true);

  const orientedBox = new THREE.Box3().setFromObject(oriented);
  const orientedSize = orientedBox.getSize(new THREE.Vector3());
  if (orientedSize.z > orientedSize.x) oriented.rotation.y = Math.PI / 2;
  oriented.updateMatrixWorld(true);

  let box3 = new THREE.Box3().setFromObject(oriented);
  let size = box3.getSize(new THREE.Vector3());
  const targetLength = 6.5;
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
    if (object.material) {
      object.material.envMapIntensity = 0.7;
      object.material.needsUpdate = true;
    }
  });

  const normalized = new THREE.Group();
  normalized.add(oriented);
  normalized.userData.modelHeight = size.y;
  normalized.userData.visualType = visualType;
  return normalized;
}

function loadHighPolyTank() {
  const loader = new GLTFLoader();
  const loadTemplate = (key, url, visualType, label) => {
    loader.load(
      url,
      (gltf) => {
        tankTemplates.set(key, prepareTankTemplate(gltf, visualType));
        entityRoot.clear();
        tankMeshes.clear();
        console.info(`${label} loaded for the 3D renderer.`);
      },
      undefined,
      (error) => {
        console.warn(`${label} could not load; using the procedural tank fallback.`, error);
      }
    );
  };

  loadTemplate(
    "m3",
    "/assets/M3_Stuart_Early_HighPoly.glb",
    "high-poly-m3",
    "High-poly M3 Stuart model"
  );
  loadTemplate(
    "m5a1",
    "/assets/M5A1_Stuart_1M.glb",
    "high-poly-m5a1",
    "High-poly M5A1 Stuart model"
  );
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

function createProceduralTank(entity) {
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
  turretPivot.position.set(0.2, 2.45, 0);
  const turret = makeMesh(tankGeometry.turret, bodyMaterial);
  turretPivot.add(turret);
  const cupola = makeMesh(tankGeometry.cupola, bodyMaterial);
  cupola.position.set(-0.2, 0.64, 0);
  turretPivot.add(cupola);
  const barrel = makeMesh(tankGeometry.barrel, tankMaterials.gun);
  barrel.rotation.z = -Math.PI / 2;
  barrel.position.set(2.65, 0.12, 0);
  turretPivot.add(barrel);
  group.add(turretPivot);
  group.userData.turretPivot = turretPivot;
  group.userData.marker = createMarker(entity.team);
  group.add(group.userData.marker);

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
  const node = candidates.find((candidate) => /turret/.test(candidate.name.toLowerCase())) || candidates[0] || null;
  if (node) node.userData.baseYaw = node.rotation.y;
  return node;
}

function highPolyTemplateFor(entity) {
  if (MOBILE || bridge.getState().player?.id !== entity.id) return null;
  const name = (entity.def?.name || "").trim().toLowerCase();

  // The roster's "M5 Stuart" entry represents the M5A1 model supplied in assets.
  if (name === "m5 stuart" || name.includes("m5a1 stuart")) {
    return tankTemplates.get("m5a1") || null;
  }
  if (name.includes("m3 stuart") || name.includes("m2a4")) {
    return tankTemplates.get("m3") || null;
  }
  return null;
}

function createEntityVisual(entity) {
  let group;
  const template = highPolyTemplateFor(entity);
  if (template) {
    group = template.clone(true);
    group.userData.turretPivot = findTurretNode(group);
    group.userData.marker = createMarker(entity.team);
    group.add(group.userData.marker);
    group.userData.visualType = template.userData.visualType;
  } else {
    group = createProceduralTank(entity);
    group.userData.visualType = "procedural";
  }
  group.userData.entityId = entity.id;
  entityRoot.add(group);
  tankMeshes.set(entity.id, group);
  return group;
}

function syncEntities(state) {
  const liveIds = new Set();
  for (const entity of state.entities) {
    if (entity.type !== "tank") continue;
    liveIds.add(entity.id);
    let visual = tankMeshes.get(entity.id);
    const desiredType = highPolyTemplateFor(entity)?.userData.visualType || "procedural";
    if (visual && visual.userData.visualType !== desiredType) {
      entityRoot.remove(visual);
      tankMeshes.delete(entity.id);
      visual = null;
    }
    if (!visual) visual = createEntityVisual(entity);

    const visibleToPlayer = bridge.isVisibleToPlayer(entity);
    visual.visible = entity.alive && visibleToPlayer;
    if (!visual.visible) continue;

    gameToWorld(entity.x, entity.y, 0.08, visual.position);
    visual.rotation.y = -entity.bodyA;
    const turretPivot = visual.userData.turretPivot;
    if (turretPivot) {
      const baseYaw = turretPivot.userData.baseYaw || 0;
      turretPivot.rotation.y = baseYaw + entity.bodyA - entity.turretA;
    }
    if (visual.userData.marker) {
      visual.userData.marker.material.opacity = entity.team === "ENEMY" ? 0.56 : 0.42;
    }
  }

  for (const [id, visual] of tankMeshes) {
    if (liveIds.has(id)) continue;
    entityRoot.remove(visual);
    tankMeshes.delete(id);
  }
}

function syncBullets(state) {
  const bullets = state.bullets || [];
  bulletInstances.count = Math.min(bullets.length, bulletInstances.instanceMatrix.count);
  for (let index = 0; index < bulletInstances.count; index += 1) {
    const bullet = bullets[index];
    gameToWorld(bullet.x, bullet.y, 2.25, tempPosition);
    tempQuaternion.setFromEuler(new THREE.Euler(0, -bullet.ang, 0));
    tempScale.set(1.0, 1.0, 1.0);
    tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
    bulletInstances.setMatrixAt(index, tempMatrix);
    tempColor.setHex(bullet.team === "YOU" ? 0x8affc0 : 0xff745f);
    bulletInstances.setColorAt(index, tempColor);
  }
  bulletInstances.instanceMatrix.needsUpdate = true;
  if (bulletInstances.instanceColor) bulletInstances.instanceColor.needsUpdate = true;
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
}

function resizeRenderer() {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  const pixelRatio = renderer.getPixelRatio();
  const targetWidth = Math.floor(width * pixelRatio);
  const targetHeight = Math.floor(height * pixelRatio);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = BASE_FOV;
    camera.updateProjectionMatrix();
  }
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
    return;
  }
  const localX = hasPointer ? pointerX : rect.width * 0.5;
  const localY = hasPointer ? pointerY : rect.height * 0.5;
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

window.Tank3D = {
  ready: false,
  getAimWorld: () => aimWorld,
  getCameraInfo: () => ({ fov: camera.fov, near: camera.near, far: camera.far, view: cameraViews[cameraViewIndex].label }),
};

function animate(frameTime) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, Math.max(0.001, (frameTime - lastFrame) / 1000));
  lastFrame = frameTime;
  const state = bridge.getState();
  const nextMapKey = `${state.mapName}|${state.env}|${state.world.w}x${state.world.h}`;
  if (nextMapKey !== mapKey || obstacleReference !== state.obstacles) rebuildWorld(state);

  resizeRenderer();
  syncEntities(state);
  syncBullets(state);
  updateCamera(state, dt);
  updateAim(state);
  updateAnimations(frameTime / 1000);
  updateObjectives(frameTime / 1000);
  renderer.render(scene, camera);
}

loadHighPolyTank();
updateCameraHint();
rebuildWorld(bridge.getState());
window.Tank3D.ready = true;
document.body.classList.add("three-ready");
requestAnimationFrame(animate);
}
