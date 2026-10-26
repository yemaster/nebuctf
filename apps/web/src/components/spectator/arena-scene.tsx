import { useEffect, useRef, useState } from "react";
import * as T from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { MonitorOff } from "lucide-react";
import { Button } from "../ui/button";
import {
  SpectatorEvents,
  type SpectatorData,
  type CityFacility,
} from "@/lib/spectator";
import { createArenaWorld } from "./arena-world";
import { createArenaEffects } from "./arena-effects";

type Props = {
  data: SpectatorData;
  live: boolean;
  paused: boolean;
  reduced: boolean;
  focus: string | null;
};
export default function ArenaScene(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    labels = useRef<HTMLDivElement>(null),
    state = useRef(props);
  const engine = useRef<{ update: () => void } | null>(null),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
  state.current = props;
  useEffect(() => {
    engine.current?.update();
  }, [props.data, props.live, props.paused, props.reduced, props.focus]);
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
    const scene = new T.Scene();
    scene.background = new T.Color("#040c23");
    scene.fog = new T.Fog("#040c23", 90, 240);
    const camera = new T.PerspectiveCamera(44, 1, 0.3, 400),
      target = new T.Vector3(0, 1, 0),
      desired = new T.Vector3(),
      position = new T.Vector3();
    camera.position.set(95, 94, 105);
    camera.lookAt(target);
    let ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(ratio);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.domElement.setAttribute(
      "aria-label",
      "自动巡航的比赛城市，建筑代表题目，解出时在对应设施播放攻击爆炸",
    );
    renderer.domElement.setAttribute("role", "img");
    element.appendChild(renderer.domElement);
    const composer = new EffectComposer(renderer),
      renderPass = new RenderPass(scene, camera),
      bloom = new UnrealBloomPass(new T.Vector2(1, 1), 0.65, 0.45, 1.1),
      output = new OutputPass();
    composer.addPass(renderPass);
    composer.addPass(bloom);
    composer.addPass(output);
    scene.add(new T.HemisphereLight("#8fcfff", "#07101d", 2.5));
    const key = new T.DirectionalLight("#a5d9ff", 3.5);
    key.position.set(-35, 70, 20);
    scene.add(key);
    const rim = new T.DirectionalLight("#2f65c9", 2);
    rim.position.set(30, 20, -50);
    scene.add(rim);
    const city = createArenaWorld();
    scene.add(city.group);
    const effects = createArenaEffects(city.group),
      ledger = new SpectatorEvents();
    let disposed = false,
      lost = false,
      dirty = true,
      frame = 0,
      previous = 0,
      elapsed = 0,
      slow = 0,
      frames = 0,
      width = 1,
      height = 1;
    let facilities: CityFacility[] = [];
    const renderSoon = () => {
      if (!frame && !disposed && !lost && !document.hidden)
        frame = requestAnimationFrame(render);
    };
    const update = () => {
      const s = state.current;
      facilities = city.setChallenges(s.data.challenges);
      city.setFocus(s.focus);
      const fresh = ledger.ingest(s.data.events, s.live);
      if (!s.paused && !s.reduced && !s.data.frozen)
        for (const event of fresh.reverse())
          effects.add(event, city.anchors.get(event.challenge_id));
      if (s.paused || s.reduced || s.data.frozen) effects.clear();
      dirty = true;
      renderSoon();
    };
    const resize = () => {
      width = Math.max(1, element.clientWidth);
      height = Math.max(1, element.clientHeight);
      renderer.setSize(width, height);
      composer.setSize(width, height);
      bloom.setSize(width * 0.65, height * 0.65);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      dirty = true;
      renderSoon();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    const onLost = (e: Event) => {
      e.preventDefault();
      lost = true;
      cancelAnimationFrame(frame);
      frame = 0;
      setFailed(true);
    };
    renderer.domElement.addEventListener("webglcontextlost", onLost);
    const projection = new T.Vector3();
    const placeLabels = () => {
      const children = Array.from(
        labels.current?.children ?? [],
      ) as HTMLElement[];
      const used: { x: number; y: number }[] = [];
      const candidates = facilities
        .map((f) => ({
          f,
          d: camera.position.distanceToSquared(city.anchors.get(f.id)!),
        }))
        .sort((a, b) =>
          a.f.id === state.current.focus
            ? -1
            : b.f.id === state.current.focus
              ? 1
              : a.d - b.d,
        );
      for (const { f } of candidates) {
        if (used.length >= children.length) break;
        projection.copy(city.anchors.get(f.id)!).project(camera);
        const x = ((projection.x + 1) * width) / 2,
          y = ((1 - projection.y) * height) / 2;
        if (
          projection.z > 1 ||
          projection.z < -1 ||
          x < 80 ||
          x > width - 80 ||
          y < 100 ||
          y > height - 105 ||
          used.some((p) => Math.abs(p.x - x) < 155 && Math.abs(p.y - y) < 42)
        )
          continue;
        const label = children[used.length]!;
        label.hidden = false;
        if (label.textContent !== f.title) label.textContent = f.title;
        label.dataset.focus = String(f.id === state.current.focus);
        label.style.transform = `translate(-50%,-100%) translate(${x}px,${y}px)`;
        used.push({ x, y });
      }
      for (let i = used.length; i < children.length; i++)
        children[i]!.hidden = true;
    };
    function render(time: number) {
      frame = 0;
      if (disposed || lost || document.hidden) return;
      const animate = !state.current.paused && !state.current.reduced;
      if (time - previous < 1000 / 30) {
        renderSoon();
        return;
      }
      const rawDelta = previous ? (time - previous) / 1000 : 1 / 30,
        delta = Math.min(rawDelta, 0.1);
      previous = time;
      if (!animate && !dirty) return;
      if (animate) elapsed += delta;
      const focus = state.current.focus
        ? city.anchors.get(state.current.focus)
        : null;
      desired.set(
        focus ? focus.x * 0.65 : 0,
        focus ? 2 : 0,
        focus ? focus.z * 0.65 : 0,
      );
      const blend = animate ? 1 - Math.exp(-delta * 0.7) : 1;
      target.lerp(desired, blend);
      const angle = 0.78 + Math.sin(elapsed * 0.012) * 0.65;
      const fit = Math.max(1, 1 / Math.min(camera.aspect, 1.2));
      const radius = (focus ? 98 : 132) * Math.min(1.5, fit);
      position.set(
        target.x + Math.cos(angle) * radius,
        focus ? 78 : 94,
        target.z + Math.sin(angle) * radius,
      );
      camera.position.lerp(position, animate ? 1 - Math.exp(-delta * 0.45) : 1);
      camera.lookAt(target);
      city.tick(elapsed);
      if (animate) effects.tick(delta);
      placeLabels();
      composer.render(delta);
      dirty = false;
      // Adapt to sustained slow frames; one isolated network/GC pause cannot
      // reduce quality. The initial draw-call/particle budgets stay bounded.
      if (animate) {
        slow = rawDelta > 0.055 ? slow + 1 : Math.max(0, slow - 1);
        frames++;
        if (frames > 90 && slow > 50) {
          if (ratio > 1) {
            ratio = 1;
            renderer.setPixelRatio(ratio);
            composer.setPixelRatio(ratio);
            resize();
          } else bloom.enabled = false;
          slow = 0;
          frames = 0;
        }
        renderSoon();
      }
    }
    const visibility = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      previous = 0;
      dirty = true;
      renderSoon();
    };
    document.addEventListener("visibilitychange", visibility);
    engine.current = { update };
    resize();
    update();
    return () => {
      disposed = true;
      engine.current = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      renderer.domElement.removeEventListener("webglcontextlost", onLost);
      effects.dispose();
      city.dispose();
      renderPass.dispose();
      bloom.dispose();
      output.dispose();
      composer.dispose();
      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [retry]);
  return (
    <div className="relative size-full overflow-hidden bg-[#040c23]">
      <div
        ref={host}
        className="absolute inset-0 [&_canvas]:block [&_canvas]:size-full"
      />
      {!failed && (
        <div
          ref={labels}
          className="pointer-events-none absolute inset-0"
          aria-hidden
        >
          {Array.from({ length: 12 }, (_, i) => (
            <div
              key={i}
              hidden
              className="absolute left-0 top-0 max-w-40 truncate rounded bg-slate-950/85 px-2.5 py-1 text-xs text-cyan-100 shadow-sm data-[focus=true]:bg-cyan-950 data-[focus=true]:text-white"
            />
          ))}
        </div>
      )}
      {failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background px-6 text-center">
          <MonitorOff className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            当前设备无法显示 3D 场景，排行榜和动态仍可查看
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setRetry((n) => n + 1)}
          >
            重新加载场景
          </Button>
        </div>
      )}
    </div>
  );
}
