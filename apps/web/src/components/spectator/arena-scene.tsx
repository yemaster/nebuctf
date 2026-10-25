import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Button } from "../ui/button";
import { MonitorOff } from "lucide-react";
import {
  arenaNodes,
  SpectatorEvents,
  type SpectatorData,
  type SpectatorEvent,
} from "@/lib/spectator";
import { useTheme } from "../theme-provider";
import { themeColors } from "@/lib/theme-settings";

type Props = {
  data: SpectatorData;
  live: boolean;
  paused: boolean;
  reduced: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
};
type Station = {
  group: THREE.Group;
  tower: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  cap: THREE.Mesh;
  ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  target: number;
  name: string;
};
type Effect = {
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  orb: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  pulse: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  curve: THREE.QuadraticBezierCurve3;
  age: number;
  duration: number;
};

export default function ArenaScene(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    state = useRef(props),
    selectedLabel = useRef<HTMLDivElement>(null);
  const { resolved, color } = useTheme();
  const [failed, setFailed] = useState(false);
  const engine = useRef<{ update: () => void; reset: () => void } | null>(null);
  state.current = props;
  useEffect(() => {
    engine.current?.update();
  }, [props.data, props.live, props.paused, props.selected, props.reduced]);
  useEffect(() => {
    const element = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "low-power",
      });
    } catch {
      setFailed(true);
      return;
    }
    setFailed(false);
    const dark = resolved === "dark",
      palette = themeColors.find((c) => c.value === color)!;
    const accent = new THREE.Color(dark ? palette.dark : palette.light);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(dark ? "#10151b" : "#edf2f5");
    scene.fog = new THREE.Fog(scene.background, 48, 110);
    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 150);
    camera.position.set(26, 24, 34);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(scene.background);
    renderer.domElement.setAttribute(
      "aria-label",
      "三维比赛态势，拖动旋转，滚轮缩放",
    );
    renderer.domElement.setAttribute("role", "img");
    element.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = 18;
    controls.maxDistance = 65;
    controls.maxPolarAngle = Math.PI / 2.2;
    controls.autoRotateSpeed = 0.35;
    const ambient = new THREE.HemisphereLight(
      dark ? "#adcde6" : "#ffffff",
      dark ? "#1c2833" : "#adbac7",
      2.3,
    );
    scene.add(ambient);
    const light = new THREE.DirectionalLight("#ffffff", 3);
    light.position.set(8, 16, 10);
    scene.add(light);
    const world = new THREE.Group();
    scene.add(world);
    const core = new THREE.Group();
    core.position.y = 2.6;
    world.add(core);
    const resources = new Set<THREE.BufferGeometry | THREE.Material>();
    const geometry = <T extends THREE.BufferGeometry>(value: T): T => {
      resources.add(value);
      return value;
    };
    const material = <T extends THREE.Material>(value: T): T => {
      resources.add(value);
      return value;
    };
    const solid = material(
      new THREE.MeshStandardMaterial({
        color: dark ? "#263541" : "#d0dce5",
        roughness: 0.55,
        metalness: 0.65,
      }),
    );
    const coreGeo = geometry(new THREE.IcosahedronGeometry(2.1, 2));
    const sphere = new THREE.Mesh(coreGeo, solid);
    core.add(sphere);
    const lattice = new THREE.LineSegments(
      geometry(new THREE.WireframeGeometry(coreGeo)),
      material(
        new THREE.LineBasicMaterial({
          color: accent,
          transparent: true,
          opacity: dark ? 0.24 : 0.18,
        }),
      ),
    );
    core.add(lattice);
    const orbitMaterial = material(
      new THREE.MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.55,
      }),
    );
    const orbitGeo = geometry(new THREE.TorusGeometry(3.3, 0.025, 6, 100));
    for (const tilt of [Math.PI / 3, -Math.PI / 4]) {
      const ring = new THREE.Mesh(orbitGeo, orbitMaterial);
      ring.rotation.x = tilt;
      ring.rotation.y = tilt / 2;
      core.add(ring);
    }
    const ground = new THREE.Mesh(
      geometry(new THREE.CircleGeometry(23, 96)),
      material(
        new THREE.MeshStandardMaterial({
          color: dark ? "#141f28" : "#e1e9ef",
          roughness: 0.9,
          metalness: 0.15,
        }),
      ),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.08;
    world.add(ground);
    const grid = new THREE.GridHelper(
      46,
      46,
      accent,
      dark ? "#314454" : "#acbdc9",
    );
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.15;
    resources.add(grid.geometry);
    resources.add(grid.material as THREE.Material);
    world.add(grid);
    for (const radius of [6, 9, 13, 17, 21]) {
      const ring = new THREE.Mesh(
        geometry(new THREE.TorusGeometry(radius, 0.012, 4, 128)),
        material(
          new THREE.MeshBasicMaterial({
            color: accent,
            transparent: true,
            opacity: 0.18,
          }),
        ),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.02;
      world.add(ring);
    }
    const baseGeo = geometry(new THREE.CylinderGeometry(0.7, 0.9, 0.18, 6));
    const towerGeo = geometry(new THREE.BoxGeometry(0.55, 1, 0.55));
    const capGeo = geometry(new THREE.OctahedronGeometry(0.27));
    const highlightGeo = geometry(new THREE.TorusGeometry(1, 0.025, 5, 40));
    const capMaterial = material(
      new THREE.MeshBasicMaterial({ color: accent }),
    );
    const stations = new Map<string, Station>();
    const effects: Effect[] = [],
      ledger = new SpectatorEvents();
    let disposed = false,
      dirty = true,
      frame = 0,
      previous = 0;
    const project = new THREE.Vector3();
    const position = (id: string | null | undefined) => {
      const station = id ? stations.get(id) : undefined;
      return station
        ? new THREE.Vector3(
            station.group.position.x,
            station.tower.scale.y + 0.7,
            station.group.position.z,
          )
        : new THREE.Vector3(0, 3, 0);
    };
    const destroyEffect = (effect: Effect) => {
      world.remove(effect.line, effect.orb, effect.pulse);
      effect.line.geometry.dispose();
      effect.line.material.dispose();
      effect.orb.geometry.dispose();
      effect.orb.material.dispose();
      effect.pulse.geometry.dispose();
      effect.pulse.material.dispose();
    };
    const animateEvent = (event: SpectatorEvent) => {
      if (
        !["solve", "attack", "release", "hint", "withdraw"].includes(
          event.type,
        ) ||
        effects.length >= 12
      )
        return;
      const from = position(event.team_id),
        to =
          event.type === "attack"
            ? position(event.target_team_id)
            : new THREE.Vector3(0, 3, 0);
      const midpoint = from.clone().lerp(to, 0.5);
      midpoint.y += Math.max(3, from.distanceTo(to) * 0.4);
      const curve = new THREE.QuadraticBezierCurve3(from, midpoint, to);
      const tint = event.blood_rank
        ? new THREE.Color("#e6ab49")
        : event.type === "attack"
          ? new THREE.Color("#ed7966")
          : accent;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(curve.getPoints(70)),
        new THREE.LineBasicMaterial({
          color: tint,
          transparent: true,
          opacity: 0.8,
        }),
      );
      line.geometry.setDrawRange(0, 0);
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 10, 8),
        new THREE.MeshBasicMaterial({ color: tint }),
      );
      const pulse = new THREE.Mesh(
        new THREE.TorusGeometry(1, 0.035, 5, 60),
        new THREE.MeshBasicMaterial({
          color: tint,
          transparent: true,
          opacity: 0,
        }),
      );
      pulse.rotation.x = Math.PI / 2;
      pulse.position.copy(to);
      pulse.position.y = 0.25;
      world.add(line, orb, pulse);
      effects.push({
        line,
        orb,
        pulse,
        curve,
        age: 0,
        duration: event.blood_rank ? 2.8 : 1.8,
      });
    };
    const update = () => {
      const current = state.current;
      const nodes = arenaNodes(current.data.leaders);
      const ids = new Set(nodes.map((n) => n.id));
      for (const [id, station] of stations)
        if (!ids.has(id)) {
          world.remove(station.group);
          station.tower.material.dispose();
          station.ring.material.dispose();
          stations.delete(id);
        }
      for (const node of nodes) {
        let station = stations.get(node.id);
        if (!station) {
          const group = new THREE.Group();
          group.userData.teamId = node.id;
          group.add(new THREE.Mesh(baseGeo, solid));
          const tower = new THREE.Mesh(
            towerGeo,
            new THREE.MeshStandardMaterial({
              color: accent,
              emissive: accent,
              emissiveIntensity: dark ? 0.18 : 0.04,
              roughness: 0.4,
              metalness: 0.6,
            }),
          );
          tower.userData.teamId = node.id;
          const cap = new THREE.Mesh(capGeo, capMaterial);
          const ring = new THREE.Mesh(
            highlightGeo,
            new THREE.MeshBasicMaterial({
              color: accent,
              transparent: true,
              opacity: 0,
            }),
          );
          ring.rotation.x = Math.PI / 2;
          ring.position.y = 0.15;
          group.add(tower, cap, ring);
          world.add(group);
          station = {
            group,
            tower,
            cap,
            ring,
            target: node.height,
            name: node.name,
          };
          stations.set(node.id, station);
        }
        station.group.position.set(node.x, 0.14, node.z);
        station.target = node.height;
        station.name = node.name;
        station.ring.material.opacity =
          current.selected === node.id ? 0.85 : node.rank <= 3 ? 0.3 : 0;
        if (current.reduced) station.tower.scale.y = node.height;
      }
      const fresh = ledger.ingest(current.data.events, current.live);
      if (!current.paused && !current.reduced && !current.data.frozen)
        for (const event of fresh.reverse()) animateEvent(event);
      if (current.paused || current.reduced || current.data.frozen) {
        effects.splice(0).forEach(destroyEffect);
      }
      dirty = true;
    };
    const resize = () => {
      const width = Math.max(1, element.clientWidth),
        height = Math.max(1, element.clientHeight);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      dirty = true;
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(element);
    resize();
    const raycaster = new THREE.Raycaster(),
      pointer = new THREE.Vector2();
    let downX = 0,
      downY = 0;
    const down = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };
    const pick = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(
        [...stations.values()].map((s) => s.tower),
      )[0];
      state.current.onSelect(hit ? String(hit.object.userData.teamId) : null);
    };
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointerup", pick);
    const lost = (event: Event) => {
      event.preventDefault();
      setFailed(true);
      cancelAnimationFrame(frame);
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    const change = () => {
      dirty = true;
    };
    controls.addEventListener("change", change);
    const render = (time: number) => {
      if (disposed || document.hidden) return;
      frame = requestAnimationFrame(render);
      if (time - previous < 1000 / 30) return;
      const delta = Math.min((time - previous) / 1000, 0.1);
      previous = time;
      const current = state.current,
        animate = !current.paused && !current.reduced;
      controls.autoRotate = animate;
      controls.update(delta);
      if (!animate && !dirty) return;
      if (animate) core.rotation.y += delta * 0.05;
      for (const station of stations.values()) {
        station.tower.scale.y = THREE.MathUtils.lerp(
          station.tower.scale.y,
          station.target,
          animate ? 0.12 : 1,
        );
        station.tower.position.y = station.tower.scale.y / 2 + 0.15;
        station.cap.position.y = station.tower.scale.y + 0.7;
        if (animate) station.cap.rotation.y += delta * 0.4;
      }
      for (let i = effects.length - 1; i >= 0; i--) {
        const effect = effects[i]!;
        effect.age += delta;
        const t = effect.age / effect.duration;
        if (t >= 1) {
          destroyEffect(effect);
          effects.splice(i, 1);
          continue;
        }
        const travel = Math.min(1, t / 0.55);
        effect.line.geometry.setDrawRange(
          0,
          Math.max(2, Math.ceil(travel * 71)),
        );
        effect.line.material.opacity = 0.8 * (1 - t);
        effect.orb.position.copy(effect.curve.getPoint(travel));
        effect.orb.visible = travel < 1;
        effect.pulse.scale.setScalar(1 + Math.max(0, t - 0.5) * 8);
        effect.pulse.material.opacity = t < 0.5 ? 0 : (1 - t) * 1.6;
      }
      const station = current.selected
        ? stations.get(current.selected)
        : undefined;
      if (selectedLabel.current) {
        selectedLabel.current.hidden = !station;
        if (station) {
          project.copy(position(current.selected)).project(camera);
          selectedLabel.current.style.transform = `translate(-50%, -100%) translate(${((project.x + 1) / 2) * element.clientWidth}px,${((-project.y + 1) / 2) * element.clientHeight - 12}px)`;
          selectedLabel.current.textContent = station.name;
        }
      }
      renderer.render(scene, camera);
      dirty = false;
    };
    const visibility = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden) {
        previous = performance.now();
        dirty = true;
        frame = requestAnimationFrame(render);
      }
    };
    document.addEventListener("visibilitychange", visibility);
    engine.current = {
      update,
      reset: () => {
        camera.position.set(26, 24, 34);
        controls.target.set(0, 0, 0);
        controls.update();
        dirty = true;
      },
    };
    update();
    visibility();
    return () => {
      disposed = true;
      engine.current = null;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      renderer.domElement.removeEventListener("pointerdown", down);
      renderer.domElement.removeEventListener("pointerup", pick);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      controls.dispose();
      effects.forEach(destroyEffect);
      for (const station of stations.values()) {
        station.tower.material.dispose();
        station.ring.material.dispose();
      }
      for (const resource of resources) resource.dispose();
      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [resolved, color]);
  return (
    <div className="relative size-full overflow-hidden">
      <div
        ref={host}
        className="absolute inset-0 [&_canvas]:block [&_canvas]:size-full"
      />
      <div
        ref={selectedLabel}
        hidden
        className="pointer-events-none absolute left-0 top-0 max-w-52 truncate rounded-md bg-background/95 px-3 py-1.5 text-sm font-medium shadow-sm"
      />
      {failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background px-6 text-center">
          <MonitorOff className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            当前设备无法显示 3D 场景，排行榜和动态仍可查看
          </p>
        </div>
      )}
      {!failed && (
        <Button
          variant="ghost"
          size="sm"
          type="button"
          className="absolute bottom-3 left-3 text-xs text-muted-foreground"
          onClick={() => engine.current?.reset()}
        >
          重置视角
        </Button>
      )}
    </div>
  );
}
