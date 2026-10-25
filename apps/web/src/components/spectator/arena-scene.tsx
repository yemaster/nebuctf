import { useEffect, useRef, useState } from "react";
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { MonitorOff, RotateCcw } from "lucide-react";
import { Button } from "../ui/button";
import {
  arenaNodes,
  arenaSectors,
  SpectatorEvents,
  type SpectatorData,
} from "@/lib/spectator";
import { useTheme } from "../theme-provider";
import { themeColors } from "@/lib/theme-settings";
import { createArenaWorld, type ArenaStation } from "./arena-world";
import { createArenaEffects } from "./arena-effects";

type Props = {
  data: SpectatorData;
  live: boolean;
  paused: boolean;
  reduced: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
};
export default function ArenaScene(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    state = useRef(props),
    labels = useRef<HTMLDivElement>(null),
    selectedLabel = useRef<HTMLDivElement>(null);
  const { resolved, color } = useTheme(),
    [failed, setFailed] = useState(false);
  const engine = useRef<{ update: () => void; reset: () => void } | null>(null);
  state.current = props;
  useEffect(() => {
    engine.current?.update();
  }, [props.data, props.live, props.paused, props.selected, props.reduced]);
  useEffect(() => {
    const element = host.current!;
    let renderer: T.WebGLRenderer;
    try {
      renderer = new T.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
    } catch {
      setFailed(true);
      return;
    }
    setFailed(false);
    const dark = resolved === "dark",
      palette = themeColors.find((c) => c.value === color)!;
    const accent = new T.Color(dark ? palette.dark : palette.light);
    const scene = new T.Scene();
    scene.background = new T.Color(dark ? "#060e19" : "#e5edf3");
    scene.fog = new T.Fog(scene.background, 65, 130);
    const camera = new T.PerspectiveCamera(45, 1, 0.1, 180);
    const home = new T.Vector3(32, 31, 39);
    camera.position.copy(home).multiplyScalar(props.reduced ? 1 : 1.18);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = dark ? 1.15 : 1;
    renderer.domElement.setAttribute(
      "aria-label",
      "三维比赛态势，拖动旋转，滚轮缩放",
    );
    renderer.domElement.setAttribute("role", "img");
    element.appendChild(renderer.domElement);
    const composer = new EffectComposer(renderer),
      renderPass = new RenderPass(scene, camera),
      output = new OutputPass();
    const bloom = new UnrealBloomPass(
      new T.Vector2(1, 1),
      dark ? 0.75 : 0.18,
      0.65,
      1.05,
    );
    composer.addPass(renderPass);
    composer.addPass(bloom);
    composer.addPass(output);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.enablePan = false;
    controls.target.set(0, 1, 0);
    controls.minDistance = 22;
    controls.maxDistance = 85;
    controls.maxPolarAngle = Math.PI / 2.15;
    controls.autoRotateSpeed = 0.18;
    scene.add(
      new T.HemisphereLight(
        dark ? "#b4dcf8" : "#ffffff",
        dark ? "#101b30" : "#a5b7c4",
        2.2,
      ),
    );
    const light = new T.DirectionalLight("#d5f1ff", 4);
    light.position.set(12, 20, 8);
    scene.add(light);
    const arena = createArenaWorld(accent, dark);
    scene.add(arena.group);
    const effects = createArenaEffects(arena.group, accent, dark),
      stations = new Map<string, ArenaStation>(),
      ledger = new SpectatorEvents();
    let disposed = false,
      contextLost = false,
      dirty = true,
      frame = 0,
      previous = 0,
      elapsed = 0,
      arrival = props.reduced ? 2 : 0;
    const project = new T.Vector3();
    let sectors: ReturnType<typeof arenaSectors> = [];
    const position = (id: string | null | undefined) => {
      const s = id ? stations.get(id) : undefined;
      return s
        ? new T.Vector3(
            s.object.position.x,
            s.height + 0.6,
            s.object.position.z,
          )
        : undefined;
    };
    const update = () => {
      const current = state.current,
        nodes = arenaNodes(current.data.leaders),
        ids = new Set(nodes.map((n) => n.id));
      sectors = arena.setChallenges(current.data.challenges);
      for (const [id, s] of stations)
        if (!ids.has(id)) {
          s.dispose();
          stations.delete(id);
        }
      for (const node of nodes) {
        let s = stations.get(node.id);
        if (!s) {
          s = arena.createStation(node.id);
          stations.set(node.id, s);
        }
        s.object.position.set(node.x, 0.05, node.z);
        s.target = node.height;
        s.name = node.name;
        s.selection.material.opacity =
          current.selected === node.id ? 1 : node.rank <= 3 ? 0.45 : 0.12;
      }
      const fresh = ledger.ingest(current.data.events, current.live);
      if (!current.paused && !current.reduced && !current.data.frozen)
        for (const event of fresh.reverse())
          effects.add(
            event,
            event.type === "solve" || event.type === "attack"
              ? position(event.team_id)
              : undefined,
            event.type === "attack"
              ? position(event.target_team_id)
              : arena.anchors.get(event.challenge_id),
          );
      if (current.paused || current.reduced || current.data.frozen)
        effects.clear();
      dirty = true;
    };
    const resize = () => {
      const width = Math.max(1, element.clientWidth),
        height = Math.max(1, element.clientHeight);
      renderer.setSize(width, height);
      composer.setSize(width, height);
      // Bloom works at CSS-pixel resolution; the final render retains its capped device ratio.
      bloom.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      dirty = true;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    const raycaster = new T.Raycaster(),
      pointer = new T.Vector2();
    let downX = 0,
      downY = 0;
    const down = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
      arrival = 2;
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
        [...stations.values()].map((s) => s.object),
        true,
      )[0];
      const id =
        hit?.object.userData.teamId ?? hit?.object.parent?.userData.teamId;
      state.current.onSelect(id ? String(id) : null);
    };
    const stopArrival = () => {
      arrival = 2;
      dirty = true;
    };
    const lost = (e: Event) => {
      e.preventDefault();
      contextLost = true;
      setFailed(true);
      cancelAnimationFrame(frame);
    };
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointerup", pick);
    renderer.domElement.addEventListener("webglcontextlost", lost);
    controls.addEventListener("start", stopArrival);
    const change = () => {
      dirty = true;
    };
    controls.addEventListener("change", change);
    const place = (label: HTMLElement, point: T.Vector3) => {
      project.copy(point).project(camera);
      const x = ((project.x + 1) / 2) * element.clientWidth,
        y = ((-project.y + 1) / 2) * element.clientHeight;
      label.hidden =
        project.z > 1 ||
        x < 40 ||
        x > element.clientWidth - 40 ||
        y < 80 ||
        y > element.clientHeight - 55;
      label.style.transform = `translate(-50%, -100%) translate(${x}px,${y}px)`;
    };
    const render = (time: number) => {
      if (disposed || contextLost || document.hidden) return;
      frame = requestAnimationFrame(render);
      if (time - previous < 1000 / 30) return;
      const delta = Math.min((time - previous) / 1000, 0.1);
      previous = time;
      const current = state.current,
        animate = !current.paused && !current.reduced;
      if (arrival < 1.4 && animate) {
        arrival += delta;
        camera.position
          .copy(home)
          .multiplyScalar(
            1 + 0.18 * Math.pow(Math.max(0, 1 - arrival / 1.4), 3),
          );
      }
      controls.autoRotate = animate && arrival >= 1.4;
      controls.update(delta);
      if (!animate && !dirty) return;
      if (animate) elapsed += delta;
      arena.tick(elapsed);
      for (const s of stations.values()) {
        s.height = T.MathUtils.lerp(s.height, s.target, animate ? 0.12 : 1);
        s.tower.scale.y = s.height;
        s.tower.position.y = s.height / 2 + 0.2;
        s.light.scale.y = s.height;
        s.light.position.set(0.26, s.height / 2 + 0.2, 0.26);
        s.beacon.position.y = s.height + 0.6 + Math.sin(elapsed * 1.5) * 0.07;
        s.beacon.rotation.y = elapsed * 0.4;
      }
      if (animate) effects.tick(delta);
      for (const label of labels.current?.children ?? []) {
        const sector = sectors.find(
          (s) => s.name === (label as HTMLElement).dataset.sector,
        );
        if (sector)
          place(label as HTMLElement, project.set(sector.x, 4.1, sector.z));
      }
      const s = current.selected ? stations.get(current.selected) : undefined;
      if (selectedLabel.current) {
        selectedLabel.current.hidden = !s;
        if (s) {
          place(selectedLabel.current, position(current.selected)!);
          selectedLabel.current.textContent = s.name;
        }
      }
      composer.render(delta);
      dirty = false;
    };
    const visibility = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden && !contextLost) {
        previous = performance.now();
        dirty = true;
        frame = requestAnimationFrame(render);
      }
    };
    document.addEventListener("visibilitychange", visibility);
    engine.current = {
      update,
      reset: () => {
        arrival = 2;
        camera.position.copy(home);
        controls.target.set(0, 1, 0);
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
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      renderer.domElement.removeEventListener("pointerdown", down);
      renderer.domElement.removeEventListener("pointerup", pick);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      controls.dispose();
      effects.clear();
      stations.forEach((s) => s.dispose());
      arena.dispose();
      renderPass.dispose();
      bloom.dispose();
      output.dispose();
      composer.dispose();
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
      {!failed && (
        <div
          ref={labels}
          className="pointer-events-none absolute inset-0"
          aria-hidden="true"
        >
          {arenaSectors(props.data.challenges).map((sector) => (
            <div
              key={sector.name}
              hidden
              data-sector={sector.name}
              className="absolute left-0 top-0 flex items-center gap-2 whitespace-nowrap rounded-md bg-background/85 px-2.5 py-1 text-xs shadow-sm"
            >
              <span className="font-medium">{sector.name}</span>
              <span className="text-muted-foreground tabular-nums">
                {sector.challengeIds.length}
              </span>
            </div>
          ))}
        </div>
      )}
      <div
        ref={selectedLabel}
        hidden
        className="pointer-events-none absolute left-0 top-0 max-w-52 truncate rounded-md bg-background/95 px-3 py-1.5 text-sm font-medium shadow-sm"
      />
      {failed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background px-6 text-center">
          <MonitorOff className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            当前设备无法显示 3D 场景，排行榜和动态仍可查看
          </p>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          type="button"
          className="absolute bottom-3 left-3 text-xs text-muted-foreground"
          onClick={() => engine.current?.reset()}
        >
          <RotateCcw />
          重置视角
        </Button>
      )}
    </div>
  );
}
