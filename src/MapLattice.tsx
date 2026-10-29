import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { PO_COLUMNS, type SpecOutput } from "./types";

type Hover = { co: string; links: { column: string; level: number; justification: string }[] } | null;

const LEVEL_COLOR: Record<number, number> = { 1: 0xe0c3b2, 2: 0xd08a63, 3: 0xc15f3c };
const LEVEL_RADIUS: Record<number, number> = { 1: 0.028, 2: 0.05, 3: 0.075 };

function label(text: string, color = "#3b3a35", weight = 500) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.font = `${weight} 34px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(2.3, 0.58, 1);
  return sprite;
}

/** The CO-PO-PSO map as a lattice: outcomes on the left, programme outcomes on
 * the right, one strand per mapped cell, thicker and warmer as the strength rises. */
export default function MapLattice({ output }: { output: SpecOutput }) {
  const host = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover>(null);

  useEffect(() => {
    const mount = host.current;
    if (!mount) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
    camera.position.set(0, 0, 17.5);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const world = new THREE.Group();
    scene.add(world);

    const cos = output.course_outcomes;
    const coSpan = Math.max(cos.length - 1, 1);
    const colSpan = Math.max(PO_COLUMNS.length - 1, 1);
    const coPos = new Map<string, THREE.Vector3>();
    const colPos = new Map<string, THREE.Vector3>();
    const disposables: { dispose(): void }[] = [];
    const nodeMeshes: THREE.Mesh[] = [];

    const nodeGeo = new THREE.SphereGeometry(0.21, 20, 16);
    const colGeo = new THREE.SphereGeometry(0.13, 16, 12);
    // A larger invisible sphere makes an outcome easy to hover.
    const hitGeo = new THREE.SphereGeometry(0.8, 10, 8);
    const hitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    disposables.push(nodeGeo, colGeo, hitGeo, hitMaterial);

    cos.forEach((co, i) => {
      const y = ((i / coSpan) - 0.5) * -7.4;
      const position = new THREE.Vector3(-5.6, y, 0);
      coPos.set(co.id, position);
      const material = new THREE.MeshBasicMaterial({ color: 0x141413 });
      disposables.push(material);
      const mesh = new THREE.Mesh(nodeGeo, material);
      mesh.position.copy(position);
      mesh.userData.co = co.id;
      world.add(mesh);
      const hit = new THREE.Mesh(hitGeo, hitMaterial);
      hit.position.copy(position);
      hit.userData.co = co.id;
      world.add(hit);
      nodeMeshes.push(hit);
      const text = label(`${co.id} · L${co.bloom_level}`, "#141413", 600);
      text.position.set(-7.9, y, 0);
      world.add(text);
      disposables.push(text.material as THREE.Material, (text.material as THREE.SpriteMaterial).map!);
    });

    PO_COLUMNS.forEach((column, i) => {
      const y = ((i / colSpan) - 0.5) * -8.4;
      const isPso = column.startsWith("PSO");
      const position = new THREE.Vector3(5.6, y, isPso ? 0.6 : 0);
      colPos.set(column, position);
      const material = new THREE.MeshBasicMaterial({ color: isPso ? 0x4f7d61 : 0x76746c });
      disposables.push(material);
      const mesh = new THREE.Mesh(colGeo, material);
      mesh.position.copy(position);
      world.add(mesh);
      const text = label(column, isPso ? "#4f7d61" : "#76746c", 500);
      text.position.set(7.5, y, position.z);
      text.scale.set(1.9, 0.48, 1);
      world.add(text);
      disposables.push(text.material as THREE.Material, (text.material as THREE.SpriteMaterial).map!);
    });

    // One strand per mapped cell.
    const strands: { co: string; mesh: THREE.Mesh; base: number }[] = [];
    for (const co of cos) {
      const row = output.co_po_pso_map[co.id] ?? {};
      for (const [column, cell] of Object.entries(row)) {
        const from = coPos.get(co.id);
        const to = colPos.get(column);
        if (!from || !to) continue;
        const mid = new THREE.Vector3((from.x + to.x) / 2, (from.y + to.y) / 2, 2.2 + cell.level * 0.5);
        const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
        const geometry = new THREE.TubeGeometry(curve, 26, LEVEL_RADIUS[cell.level], 7, false);
        const opacity = 0.3 + cell.level * 0.14;
        const material = new THREE.MeshBasicMaterial({ color: LEVEL_COLOR[cell.level], transparent: true, opacity, depthWrite: false });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData.co = co.id;
        world.add(mesh);
        strands.push({ co: co.id, mesh, base: opacity });
        disposables.push(geometry, material);
      }
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2(-10, -10);
    const parallax = { x: 0, y: 0 };
    let active: string | null = null;

    const onMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      parallax.x = pointer.x * 0.5;
      parallax.y = pointer.y * 0.35;
    };
    const onLeave = () => {
      pointer.set(-10, -10);
      parallax.x = 0;
      parallax.y = 0;
    };
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);

    const resize = () => {
      const width = mount.clientWidth || 1;
      const height = mount.clientHeight || 420;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    const clock = new THREE.Clock();
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      if (document.hidden) return;
      const t = clock.getElapsedTime();

      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(nodeMeshes, false)[0];
      const next = (hit?.object.userData.co as string | undefined) ?? null;
      if (next !== active) {
        active = next;
        for (const strand of strands) {
          const material = strand.mesh.material as THREE.MeshBasicMaterial;
          material.opacity = !active ? strand.base : strand.co === active ? Math.min(strand.base + 0.4, 0.95) : 0.06;
        }
        setHover(
          active
            ? {
                co: active,
                links: Object.entries(output.co_po_pso_map[active] ?? {})
                  .map(([column, cell]) => ({ column, level: cell.level, justification: cell.justification }))
                  .sort((a, b) => b.level - a.level),
              }
            : null,
        );
      }

      world.rotation.y = reduced ? -0.22 : -0.22 + Math.sin(t * 0.12) * 0.16 + parallax.x * 0.18;
      world.rotation.x = reduced ? 0.04 : 0.04 + parallax.y * 0.1;
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      for (const item of disposables) item.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [output]);

  const co = hover ? output.course_outcomes.find((c) => c.id === hover.co) : null;

  return (
    <div className="lattice">
      <div ref={host} style={{ height: "100%" }} />
      <span className="hint">Hover an outcome to trace its strands · thickness is the strength</span>
      {hover && co && (
        <div className="readout">
          <strong>{co.id}</strong> <span className="pill clay">L{co.bloom_level}</span>
          <p className="lede" style={{ margin: "6px 0 8px" }}>{co.statement}</p>
          <div className="stack" style={{ gap: 4 }}>
            {hover.links.slice(0, 5).map((link) => (
              <div key={link.column}>
                <span className="mono">{link.column}</span> · {link.level} — <span className="muted">{link.justification.slice(0, 70)}…</span>
              </div>
            ))}
            {hover.links.length > 5 && <span className="muted">+{hover.links.length - 5} more</span>}
          </div>
        </div>
      )}
    </div>
  );
}
