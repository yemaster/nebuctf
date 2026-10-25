import * as T from "three";
import type { SpectatorEvent } from "@/lib/spectator";

/** At most twelve short-lived real events; geometry and materials are reclaimed together. */
export function createArenaEffects(
  world: T.Group,
  accent: T.Color,
  dark: boolean,
) {
  const effects: ReturnType<typeof build>[] = [];
  function build(
    event: SpectatorEvent,
    from: T.Vector3 | undefined,
    to: T.Vector3,
  ) {
    const group = new T.Group(),
      blood = event.type === "solve" && !!event.blood_rank;
    const tint = blood
      ? new T.Color("#ffc56e")
      : event.type === "attack"
        ? new T.Color("#ff776c")
        : accent.clone();
    tint.multiplyScalar(dark ? 3 : 1.25);
    const resources: (T.BufferGeometry | T.Material)[] = [];
    const own = <V extends T.BufferGeometry | T.Material>(v: V) => {
      resources.push(v);
      return v;
    };
    const origin = from ?? to,
      midpoint = origin.clone().lerp(to, 0.5);
    midpoint.y += Math.max(4, origin.distanceTo(to) * 0.45);
    const curve = new T.QuadraticBezierCurve3(origin, midpoint, to);
    const trailMaterial = own(
      new T.ShaderMaterial({
        uniforms: {
          tint: { value: tint },
          progress: { value: 0 },
          opacity: { value: 1 },
        },
        vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader: `uniform vec3 tint; uniform float progress; uniform float opacity; varying vec2 vUv;
        void main(){float tail=smoothstep(progress-.4,progress,vUv.x)*(1.-smoothstep(progress,progress+.025,vUv.x)); gl_FragColor=vec4(tint,tail*opacity);}`,
        transparent: true,
        depthWrite: false,
        blending: dark ? T.AdditiveBlending : T.NormalBlending,
      }),
    );
    const trail = new T.Mesh(
      own(new T.TubeGeometry(curve, 80, blood ? 0.085 : 0.045, 5, false)),
      trailMaterial,
    );
    trail.visible = !!from;
    group.add(trail);
    const head = new T.Mesh(
      own(new T.SphereGeometry(blood ? 0.22 : 0.13, 12, 8)),
      own(new T.MeshBasicMaterial({ color: tint })),
    );
    group.add(head);
    const impact = new T.Group();
    impact.position.copy(to);
    impact.position.y = 0.55;
    group.add(impact);
    const rings = [0, 1].map(() => {
      const mesh = new T.Mesh(
        own(new T.TorusGeometry(1, 0.035, 5, 64)),
        own(
          new T.MeshBasicMaterial({
            color: tint,
            transparent: true,
            opacity: 0,
            depthWrite: false,
          }),
        ),
      );
      mesh.rotation.x = Math.PI / 2;
      impact.add(mesh);
      return mesh;
    });
    const beam = new T.Mesh(
      own(
        new T.CylinderGeometry(
          blood ? 0.6 : 0.25,
          blood ? 1.3 : 0.65,
          blood ? 12 : 7,
          24,
          1,
          true,
        ),
      ),
      own(
        new T.ShaderMaterial({
          uniforms: { tint: { value: tint }, opacity: { value: 0 } },
          vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
          fragmentShader: `uniform vec3 tint; uniform float opacity; varying vec2 vUv; void main(){gl_FragColor=vec4(tint,pow(1.-vUv.y,2.)*opacity*.35);}`,
          transparent: true,
          side: T.DoubleSide,
          depthWrite: false,
          blending: dark ? T.AdditiveBlending : T.NormalBlending,
        }),
      ),
    );
    beam.position.y = blood ? 6 : 3.5;
    impact.add(beam);
    const points = new Float32Array(36 * 3);
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      points[i * 3] = Math.cos(a);
      points[i * 3 + 1] = (i % 5) * 0.22;
      points[i * 3 + 2] = Math.sin(a);
    }
    const sparks = new T.Points(
      own(
        new T.BufferGeometry().setAttribute(
          "position",
          new T.BufferAttribute(points, 3),
        ),
      ),
      own(
        new T.PointsMaterial({
          color: tint,
          size: 0.09,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      ),
    );
    impact.add(sparks);
    world.add(group);
    return {
      group,
      curve,
      trailMaterial,
      head,
      rings,
      beam,
      sparks,
      age: 0,
      travel: from ? 1.2 : 0,
      duration: blood ? 3.4 : 2.6,
      dispose() {
        world.remove(group);
        resources.forEach((r) => r.dispose());
      },
    };
  }
  return {
    add(
      event: SpectatorEvent,
      from: T.Vector3 | undefined,
      to: T.Vector3 | undefined,
    ) {
      // Unknown/off-screen endpoints must not be replaced with fabricated team positions.
      if (!to || effects.length >= 12) return;
      effects.push(build(event, from, to));
    },
    tick(delta: number) {
      for (let i = effects.length - 1; i >= 0; i--) {
        const e = effects[i]!;
        e.age += delta;
        if (e.age >= e.duration) {
          e.dispose();
          effects.splice(i, 1);
          continue;
        }
        const travel = e.travel ? Math.min(1.4, e.age / e.travel) : 1.4;
        e.trailMaterial.uniforms.progress!.value = travel;
        e.head.visible = travel < 1;
        if (e.head.visible) e.head.position.copy(e.curve.getPoint(travel));
        const impact = Math.max(
          0,
          (e.age - e.travel) / (e.duration - e.travel),
        );
        for (let j = 0; j < e.rings.length; j++) {
          const ring = e.rings[j]!,
            t = Math.max(0, impact - j * 0.12);
          ring.scale.setScalar(0.5 + t * 6);
          ring.material.opacity = t > 0 ? (1 - t) * 0.85 : 0;
        }
        e.beam.material.uniforms.opacity!.value =
          impact > 0 ? Math.sin(Math.PI * Math.sqrt(impact)) : 0;
        e.sparks.scale.setScalar(1 + impact * 5);
        e.sparks.material.opacity = impact > 0 ? (1 - impact) * 0.8 : 0;
      }
    },
    clear() {
      effects.splice(0).forEach((e) => e.dispose());
    },
  };
}
