import * as T from "three";
import { cityHash, type SpectatorEvent } from "@/lib/spectator";

export function createArenaEffects(world: T.Group) {
  const coreGeometry = new T.IcosahedronGeometry(1, 1),
    ringGeometry = new T.TorusGeometry(1, 0.055, 5, 48);
  type Effect = {
    root: T.Group;
    age: number;
    life: number;
    core: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>;
    ring: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>;
    halo: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>;
    particles: T.Points<T.BufferGeometry, T.ShaderMaterial>;
    trail: T.Line<T.BufferGeometry, T.LineBasicMaterial>;
    to: T.Vector3;
    from: T.Vector3;
    explosion: boolean;
    dispose: () => void;
  };
  const active: Effect[] = [];
  const add = (event: SpectatorEvent, to: T.Vector3 | undefined) => {
    if (!to || active.length >= 12 || event.type === "withdraw") return false;
    const explosion = event.type === "solve" || event.type === "attack";
    const color = new T.Color(
      explosion ? (event.blood_rank === 1 ? "#ffd58a" : "#ff794b") : "#31d8f1",
    );
    const root = new T.Group();
    world.add(root);
    const core = new T.Mesh(
      coreGeometry,
      new T.MeshBasicMaterial({
        color: color.clone().multiplyScalar(4),
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
      }),
    );
    core.position.copy(to);
    root.add(core);
    const halo = new T.Mesh(
      coreGeometry,
      new T.MeshBasicMaterial({
        color: color.clone().multiplyScalar(1.8),
        wireframe: true,
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
      }),
    );
    halo.position.copy(to);
    root.add(halo);
    const ring = new T.Mesh(
      ringGeometry,
      new T.MeshBasicMaterial({
        color: color.clone().multiplyScalar(2),
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(to.x, 0.85, to.z);
    root.add(ring);
    const count = explosion ? 72 : 24,
      positions = new Float32Array(count * 3),
      velocities = new Float32Array(count * 3);
    let seed = cityHash(event.id);
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2,
        speed = 2 + random() * 6;
      velocities.set(
        [Math.cos(angle) * speed, 1 + random() * 9, Math.sin(angle) * speed],
        i * 3,
      );
    }
    const pg = new T.BufferGeometry();
    pg.setAttribute("position", new T.BufferAttribute(positions, 3));
    pg.setAttribute("velocity", new T.BufferAttribute(velocities, 3));
    const pm = new T.ShaderMaterial({
      uniforms: {
        age: { value: 0 },
        tint: { value: color.clone().multiplyScalar(3) },
      },
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      vertexShader: `attribute vec3 velocity;uniform float age;varying float life;void main(){float t=max(age,0.);vec3 p=position+velocity*t;p.y-=t*t*2.8;vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(170./max(1.,-mv.z),1.,6.);life=max(0.,1.-t/2.6);}`,
      fragmentShader: `uniform vec3 tint;varying float life;void main(){float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard;gl_FragColor=vec4(tint,pow(1.-r,1.4)*life);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
    });
    const particles = new T.Points(pg, pm);
    particles.position.copy(to);
    particles.frustumCulled = false;
    root.add(particles);
    const direction = random() * Math.PI * 2,
      from = to
        .clone()
        .add(
          new T.Vector3(Math.cos(direction) * 25, 22, Math.sin(direction) * 25),
        );
    const trailGeometry = new T.BufferGeometry().setFromPoints([from, from]);
    const trail = new T.Line(
      trailGeometry,
      new T.LineBasicMaterial({
        color: color.clone().multiplyScalar(3),
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
      }),
    );
    root.add(trail);
    const effect: Effect = {
      root,
      age: 0,
      life: 3.3,
      core,
      ring,
      halo,
      particles,
      trail,
      to: to.clone(),
      from,
      explosion,
      dispose: () => {
        world.remove(root);
        core.material.dispose();
        halo.material.dispose();
        ring.material.dispose();
        pg.dispose();
        pm.dispose();
        trailGeometry.dispose();
        trail.material.dispose();
        root.clear();
      },
    };
    active.push(effect);
    return true;
  };
  const a = new T.Vector3(),
    b = new T.Vector3();
  const tick = (delta: number) => {
    for (let i = active.length - 1; i >= 0; i--) {
      const e = active[i]!;
      e.age += delta;
      if (e.age >= e.life) {
        e.dispose();
        active.splice(i, 1);
        continue;
      }
      const impact = e.age - 0.6,
        progress = Math.min(1, e.age / 0.6);
      e.trail.visible = e.explosion && impact < 0.15;
      a.lerpVectors(e.from, e.to, Math.max(0, progress - 0.22));
      b.lerpVectors(e.from, e.to, progress);
      const p = e.trail.geometry.attributes.position as T.BufferAttribute;
      p.setXYZ(0, a.x, a.y, a.z);
      p.setXYZ(1, b.x, b.y, b.z);
      p.needsUpdate = true;
      e.trail.geometry.computeBoundingSphere();
      e.core.visible =
        e.halo.visible =
        e.ring.visible =
        e.particles.visible =
          impact >= 0;
      if (impact < 0) continue;
      e.particles.material.uniforms.age!.value = impact;
      e.core.scale.setScalar(
        e.explosion
          ? Math.max(0.01, Math.sin(Math.min(1, impact / 0.8) * Math.PI) * 2.8)
          : 0.4,
      );
      e.core.material.opacity = Math.max(0, 1 - impact / 1.1);
      e.halo.scale.setScalar(0.3 + impact * 4.5);
      e.halo.rotation.set(impact * 0.6, impact, impact * 0.2);
      e.halo.material.opacity = Math.max(0, 0.45 - impact * 0.25);
      e.ring.scale.setScalar(0.4 + impact * 5.2);
      e.ring.material.opacity = Math.max(0, 0.9 - impact * 0.45);
    }
  };
  const clear = () => {
    active.splice(0).forEach((e) => e.dispose());
  };
  return {
    add,
    tick,
    clear,
    dispose: () => {
      clear();
      coreGeometry.dispose();
      ringGeometry.dispose();
    },
    get count() {
      return active.length;
    },
  };
}
