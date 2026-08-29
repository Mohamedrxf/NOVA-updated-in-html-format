// ============================================================
// Subtle Three.js network topology: glowing node spheres,
// thin connection lines, moving data packets, gentle auto-orbit.
// ============================================================
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { topology } from "./data.js";

const STATUS_COLOR = {
  healthy: 0x34d399,
  investigating: 0x22d3ee,
  fault: 0xf43f5e,
};

const TYPE_COLOR = {
  router: 0x38bdf8,
  switch: 0x22d3ee,
  pc: 0x8b9bb4,
  server: 0xa78bfa,
  ap: 0x34d399,
  node: 0x475569,
};

export function initNetwork3D() {
  const mount = document.getElementById("net3d");
  if (!mount) return;

  // Respect reduced motion + skip if WebGL unavailable
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 1.5, 11);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (e) {
    mount.innerHTML =
      '<div class="grid h-full place-items-center text-xs text-muted">3D view unavailable in this browser</div>';
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  mount.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 7;
  controls.maxDistance = 16;
  controls.autoRotate = !reduceMotion;
  controls.autoRotateSpeed = 0.6;

  // Lights
  scene.add(new THREE.AmbientLight(0x5b7290, 0.9));
  const key = new THREE.PointLight(0x22d3ee, 60, 60);
  key.position.set(6, 8, 8);
  scene.add(key);
  const rim = new THREE.PointLight(0x38bdf8, 30, 60);
  rim.position.set(-8, -4, -6);
  scene.add(rim);

  const group = new THREE.Group();
  scene.add(group);

  // Node lookup
  const nodePos = {};
  topology.nodes.forEach((n) => (nodePos[n.id] = new THREE.Vector3(...n.pos)));

  // ---- Nodes ----
  const labelData = [];
  topology.nodes.forEach((n) => {
    const isMinor = n.type === "node";
    const radius = isMinor ? 0.12 : n.type === "router" || n.type === "server" ? 0.32 : 0.24;
    const color = TYPE_COLOR[n.type] || 0x64748b;

    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: isMinor ? 0.4 : 0.8,
      roughness: 0.35,
      metalness: 0.2,
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 24), mat);
    sphere.position.copy(nodePos[n.id]);
    group.add(sphere);

    // glow halo
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.9, 16, 16),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12 })
    );
    halo.position.copy(nodePos[n.id]);
    group.add(halo);

    if (n.label) labelData.push({ id: n.id, text: n.label, pos: nodePos[n.id] });
  });

  // ---- Links ----
  const packetPaths = [];
  topology.links.forEach((l) => {
    const from = nodePos[l.a];
    const to = nodePos[l.b];
    if (!from || !to) return;
    const color = STATUS_COLOR[l.status] || 0x475569;

    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: l.status === "healthy" ? 0.5 : 0.75 })
    );
    group.add(line);

    // packets travel on healthy + investigating links
    if (l.status !== "fault") {
      const packet = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 10, 10),
        new THREE.MeshBasicMaterial({ color })
      );
      group.add(packet);
      packetPaths.push({ from, to, packet, t: Math.random(), speed: 0.003 + Math.random() * 0.004 });
    }
  });

  // ---- HTML labels overlay ----
  const labelLayer = document.createElement("div");
  labelLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;";
  mount.style.position = "relative";
  mount.appendChild(labelLayer);
  labelData.forEach((l) => {
    const div = document.createElement("div");
    div.textContent = l.text;
    div.style.cssText =
      "position:absolute;transform:translate(-50%,-140%);font:600 10px/1 'JetBrains Mono',monospace;color:#cbd5e1;background:rgba(11,17,32,0.7);border:1px solid #1b2740;padding:2px 6px;border-radius:6px;white-space:nowrap;";
    labelLayer.appendChild(div);
    l.el = div;
  });

  // ---- Resize ----
  function resize() {
    const w = mount.clientWidth;
    const h = mount.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(mount);
  resize();

  // ---- Animate ----
  const tmp = new THREE.Vector3();
  function project(vec3) {
    tmp.copy(vec3).applyMatrix4(group.matrixWorld).project(camera);
    return {
      x: (tmp.x * 0.5 + 0.5) * mount.clientWidth,
      y: (-tmp.y * 0.5 + 0.5) * mount.clientHeight,
      visible: tmp.z < 1,
    };
  }

  const clock = new THREE.Clock();
  function loop() {
    const dt = clock.getDelta();
    controls.update();

    // gentle vertical bob
    group.rotation.z = Math.sin(clock.elapsedTime * 0.15) * 0.02;

    // move packets
    packetPaths.forEach((p) => {
      p.t += p.speed * (dt * 60);
      if (p.t > 1) p.t = 0;
      p.packet.position.lerpVectors(p.from, p.to, p.t);
    });

    // position labels
    labelData.forEach((l) => {
      const s = project(l.pos);
      if (l.el) {
        l.el.style.left = s.x + "px";
        l.el.style.top = s.y + "px";
        l.el.style.opacity = s.visible ? "1" : "0";
      }
    });

    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  loop();
}
