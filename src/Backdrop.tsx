import { useEffect, useRef } from "react";
import * as THREE from "three";

/** Pages drifting in depth behind the hero. Decorative, cheap, and it stops
 * moving when the tab is hidden or the viewer asks for reduced motion. */
export default function Backdrop({ height = 340 }: { height?: number }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = host.current;
    if (!mount) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0, 14);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const palette = [0xf7f5ef, 0xf1ece0, 0xe8dccd, 0xdfc6b4, 0xc15f3c];
    const pages: { mesh: THREE.Mesh; spin: number; drift: number; phase: number }[] = [];
    const geometry = new THREE.PlaneGeometry(1, 1.35, 1, 1);

    for (let i = 0; i < 34; i++) {
      const tone = palette[i % palette.length];
      const accent = tone === 0xc15f3c;
      const material = new THREE.MeshBasicMaterial({
        color: tone,
        transparent: true,
        opacity: accent ? 0.22 : 0.5,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      const scale = 0.7 + Math.random() * 2.4;
      mesh.scale.setScalar(scale);
      mesh.position.set((Math.random() - 0.5) * 22, (Math.random() - 0.5) * 11, -Math.random() * 18);
      mesh.rotation.set(Math.random() * 0.6 - 0.3, Math.random() * 0.9 - 0.45, Math.random() * Math.PI);
      scene.add(mesh);
      pages.push({ mesh, spin: (Math.random() - 0.5) * 0.08, drift: 0.1 + Math.random() * 0.22, phase: Math.random() * Math.PI * 2 });
    }

    // A faint ruled grid, like paper under the pages.
    const grid = new THREE.Group();
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xd5cfc0, transparent: true, opacity: 0.35 });
    for (let i = -6; i <= 6; i++) {
      const points = [new THREE.Vector3(-16, i * 1.6, -12), new THREE.Vector3(16, i * 1.6, -12)];
      grid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial));
    }
    grid.rotation.x = -0.18;
    scene.add(grid);

    const pointer = { x: 0, y: 0 };
    const onPointer = (e: PointerEvent) => {
      const rect = mount.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      pointer.y = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    };
    window.addEventListener("pointermove", onPointer);

    const resize = () => {
      const width = mount.clientWidth || 1;
      const h = mount.clientHeight || height;
      renderer.setSize(width, h, false);
      camera.aspect = width / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    let frame = 0;
    const clock = new THREE.Clock();
    const tick = () => {
      frame = requestAnimationFrame(tick);
      if (document.hidden) return;
      const t = clock.getElapsedTime();
      for (const page of pages) {
        page.mesh.rotation.z += page.spin * 0.004;
        page.mesh.position.y += Math.sin(t * 0.25 + page.phase) * 0.0016 * page.drift * 10;
        page.mesh.position.x += Math.cos(t * 0.18 + page.phase) * 0.0012 * page.drift * 10;
      }
      camera.position.x += (pointer.x * 1.1 - camera.position.x) * 0.03;
      camera.position.y += (-pointer.y * 0.7 - camera.position.y) * 0.03;
      camera.lookAt(0, 0, -4);
      renderer.render(scene, camera);
    };
    if (reduced) renderer.render(scene, camera);
    else tick();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("pointermove", onPointer);
      geometry.dispose();
      lineMaterial.dispose();
      for (const page of pages) (page.mesh.material as THREE.Material).dispose();
      grid.children.forEach((child) => (child as THREE.Line).geometry.dispose());
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [height]);

  return <div ref={host} style={{ position: "absolute", inset: 0 }} aria-hidden="true" />;
}
