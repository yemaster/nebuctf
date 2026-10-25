import * as T from "three";
import { arenaSectors, type SpectatorData } from "@/lib/spectator";

/** Geometry is shared and explicitly owned here; no external assets or per-frame allocations. */
export function createArenaWorld(accent: T.Color, dark: boolean) {
  const group = new T.Group(),
    resources = new Set<T.BufferGeometry | T.Material>();
  const own = <V extends T.BufferGeometry | T.Material>(value: V) => {
    resources.add(value);
    return value;
  };
  const glow = own(
    new T.MeshBasicMaterial({
      color: accent.clone().multiplyScalar(dark ? 2.8 : 1.2),
    }),
  );
  const dim = own(
    new T.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: dark ? 0.25 : 0.18,
      depthWrite: false,
    }),
  );
  const metal = own(
    new T.MeshStandardMaterial({
      color: dark ? "#112936" : "#becfdc",
      roughness: 0.36,
      metalness: 0.75,
    }),
  );
  const edge = own(
    new T.LineBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.65,
    }),
  );
  const hex = own(new T.CylinderGeometry(1, 1.15, 0.4, 6));
  const box = own(new T.BoxGeometry(1, 1, 1));
  const crystal = own(new T.OctahedronGeometry(0.32));
  const ring = (
    radius: number,
    thickness: number,
    opacity = 1,
    arc = Math.PI * 2,
  ) => {
    const mesh = new T.Mesh(
      own(new T.TorusGeometry(radius, thickness, 4, 100, arc)),
      opacity === 1 ? glow : dim,
    );
    mesh.rotation.x = Math.PI / 2;
    return mesh;
  };
  let seed = 4817;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // A layered orbital deck under the raised hologram, with a visible underside.
  const deck = new T.Group();
  const plate = new T.Mesh(
    own(new T.CylinderGeometry(6.2, 5.1, 0.8, 64)),
    metal,
  );
  plate.position.y = -0.8;
  deck.add(plate);
  for (const [radius, y] of [
    [6.2, -0.35],
    [5.4, -1.15],
    [3.5, 0.05],
    [2.9, 0.12],
  ]) {
    const rim = ring(radius!, 0.035);
    rim.position.y = y!;
    deck.add(rim);
  }
  const ticks = new T.InstancedMesh(box, glow, 96),
    dummy = new T.Object3D();
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    dummy.position.set(Math.cos(a) * 5.8, -0.28, Math.sin(a) * 5.8);
    dummy.scale.set(i % 8 === 0 ? 0.5 : 0.2, 0.025, 0.035);
    dummy.rotation.y = -a;
    dummy.updateMatrix();
    ticks.setMatrixAt(i, dummy.matrix);
  }
  deck.add(ticks);
  group.add(deck);
  const orbitA = ring(7.1, 0.04, 1, Math.PI * 1.25),
    orbitB = ring(7.6, 0.018, 1, Math.PI * 0.7);
  orbitA.position.y = 0.25;
  orbitB.position.y = -0.7;
  group.add(orbitA, orbitB);

  // Fresnel rim, latitude lines and a moving scan plane form one translucent sphere.
  const hologram = own(
    new T.ShaderMaterial({
      uniforms: {
        tint: { value: accent },
        time: { value: 0 },
        strength: { value: dark ? 1.8 : 0.65 },
      },
      vertexShader: `varying vec3 vNormal; varying vec3 vView; varying vec3 vLocal;
      void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); vNormal=normalize(normalMatrix*normal); vView=-mv.xyz; vLocal=position; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform vec3 tint; uniform float time; uniform float strength; varying vec3 vNormal; varying vec3 vView; varying vec3 vLocal;
      void main(){ float rim=pow(1.-abs(dot(normalize(vNormal),normalize(vView))),2.6);
        float lines=pow(.5+.5*cos(vLocal.y*35.),18.); float sweep=pow(.5+.5*cos(vLocal.y*1.3-time*.7),24.);
        gl_FragColor=vec4(tint*(.65+rim*strength*2.+sweep), .07+rim*.7+lines*.12+sweep*.13); }`,
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
      blending: dark ? T.AdditiveBlending : T.NormalBlending,
    }),
  );
  const core = new T.Group();
  core.position.y = 4.2;
  const globeGeo = own(new T.SphereGeometry(3, 48, 32));
  core.add(new T.Mesh(globeGeo, hologram));
  const wire = new T.LineSegments(
    own(new T.WireframeGeometry(own(new T.IcosahedronGeometry(2.85, 2)))),
    own(
      new T.LineBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.14,
      }),
    ),
  );
  core.add(wire);
  for (const [tilt, radius] of [
    [0.5, 3.6],
    [1.05, 3.9],
    [-0.8, 4.2],
  ]) {
    const band = ring(radius!, 0.025, 1, Math.PI * 1.6);
    band.rotation.set(tilt!, 0.3, tilt! * 0.5);
    core.add(band);
  }
  group.add(core);
  const column = new T.Mesh(
    own(new T.CylinderGeometry(2.3, 2.9, 4, 48, 1, true)),
    own(
      new T.ShaderMaterial({
        uniforms: { tint: { value: accent } },
        vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader: `uniform vec3 tint; varying vec2 vUv; void main(){gl_FragColor=vec4(tint,(1.-vUv.y)*(1.-vUv.y)*.12);}`,
        side: T.DoubleSide,
        transparent: true,
        depthWrite: false,
        blending: dark ? T.AdditiveBlending : T.NormalBlending,
      }),
    ),
  );
  column.position.y = 2;
  group.add(column);

  // Sparse stars and orbital particles give depth without fabricating battle events.
  const stars = new Float32Array(900 * 3);
  for (let i = 0; i < stars.length; i += 3) {
    const a = random() * Math.PI * 2,
      r = 35 + random() * 55;
    stars[i] = Math.cos(a) * r;
    stars[i + 1] = random() * 65 - 12;
    stars[i + 2] = Math.sin(a) * r;
  }
  const sky = new T.Points(
    own(
      new T.BufferGeometry().setAttribute(
        "position",
        new T.BufferAttribute(stars, 3),
      ),
    ),
    own(
      new T.PointsMaterial({
        color: dark ? "#a2c6dc" : "#477990",
        size: 0.09,
        transparent: true,
        opacity: dark ? 0.65 : 0.25,
        depthWrite: false,
      }),
    ),
  );
  group.add(sky);
  const particles = new Float32Array(180 * 3);
  for (let i = 0; i < particles.length; i += 3) {
    const a = random() * Math.PI * 2,
      r = 4 + random() * 3;
    particles[i] = Math.cos(a) * r;
    particles[i + 1] = random() * 7;
    particles[i + 2] = Math.sin(a) * r;
  }
  const dust = new T.Points(
    own(
      new T.BufferGeometry().setAttribute(
        "position",
        new T.BufferAttribute(particles, 3),
      ),
    ),
    own(
      new T.PointsMaterial({
        color: accent.clone().multiplyScalar(2),
        size: 0.055,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      }),
    ),
  );
  group.add(dust);
  for (const radius of [17.8, 21.6, 25.4, 28]) {
    const path = ring(radius, 0.012, 0.2);
    path.position.y = -0.5;
    group.add(path);
  }

  const sectors = new T.Group();
  group.add(sectors);
  let sectorKey = "";
  let locations: ReturnType<typeof arenaSectors> = [];
  const anchors = new Map<string, T.Vector3>();
  const sectorResources: (T.BufferGeometry | T.Material)[] = [];
  const clearSectors = () => {
    sectors.traverse((o) => {
      if (o instanceof T.InstancedMesh) o.dispose();
    });
    sectors.clear();
    sectorResources.splice(0).forEach((r) => r.dispose());
    anchors.clear();
  };
  const setChallenges = (challenges: SpectatorData["challenges"]) => {
    locations = arenaSectors(challenges);
    const key = JSON.stringify(locations.map((s) => [s.name, s.challengeIds]));
    if (key === sectorKey) return locations;
    sectorKey = key;
    clearSectors();
    for (const sector of locations) {
      const island = new T.Group();
      island.position.set(sector.x, 0.1, sector.z);
      const base = new T.Mesh(hex, metal);
      base.scale.set(2.3, 1.4, 2.3);
      island.add(base);
      const rimGeo = new T.EdgesGeometry(hex);
      sectorResources.push(rimGeo);
      const rim = new T.LineSegments(rimGeo, edge);
      rim.scale.copy(base.scale);
      island.add(rim);
      const lower = new T.Mesh(hex, metal);
      lower.scale.set(1.6, 1, 1.6);
      lower.position.y = -0.65;
      island.add(lower);
      // Instanced architectural blocks remain subordinate to the category beacon.
      const city = new T.InstancedMesh(box, metal, 18);
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2,
          radius = 1 + (i % 3) * 0.3;
        const h = 0.3 + (i % 5) * 0.15;
        dummy.position.set(
          Math.cos(a) * radius,
          0.35 + h / 2,
          Math.sin(a) * radius,
        );
        dummy.rotation.set(0, a, 0);
        dummy.scale.set(0.28, h, 0.28);
        dummy.updateMatrix();
        city.setMatrixAt(i, dummy.matrix);
      }
      island.add(city);
      const mast = new T.Mesh(box, glow);
      mast.scale.set(0.06, 2.3, 0.06);
      mast.position.y = 1.5;
      island.add(mast);
      const beacon = new T.Mesh(crystal, glow);
      beacon.scale.setScalar(1.5);
      beacon.position.y = 2.8;
      island.add(beacon);
      const link = new T.Line(
        new T.BufferGeometry().setFromPoints([
          new T.Vector3(0, -0.35, 0),
          new T.Vector3(sector.x * 0.6, -0.35, sector.z * 0.6),
          new T.Vector3(sector.x, 0.1, sector.z),
        ]),
        new T.LineBasicMaterial({
          color: accent,
          transparent: true,
          opacity: 0.22,
        }),
      );
      sectorResources.push(link.geometry, link.material);
      sectors.add(island, link);
      for (const id of sector.challengeIds)
        anchors.set(id, new T.Vector3(sector.x, 3, sector.z));
    }
    return locations;
  };
  const stationGeo = own(new T.CylinderGeometry(0.23, 0.4, 1, 6));
  const selectionGeo = own(new T.TorusGeometry(1, 0.035, 4, 40));
  function createStation(id: string) {
    const object = new T.Group();
    object.userData.teamId = id;
    const base = new T.Mesh(hex, metal);
    base.scale.set(0.85, 0.6, 0.85);
    object.add(base);
    const tower = new T.Mesh(stationGeo, metal);
    tower.userData.teamId = id;
    const beacon = new T.Mesh(crystal, glow);
    beacon.userData.teamId = id;
    const light = new T.Mesh(box, glow);
    light.scale.set(0.055, 1, 0.055);
    const selection = new T.Mesh(
      selectionGeo,
      new T.MeshBasicMaterial({
        color: accent.clone().multiplyScalar(2),
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
      }),
    );
    selection.rotation.x = Math.PI / 2;
    selection.position.y = 0.18;
    object.add(tower, beacon, light, selection);
    group.add(object);
    return {
      object,
      tower,
      beacon,
      light,
      selection,
      height: 1,
      target: 1,
      name: "",
      dispose: () => {
        group.remove(object);
        selection.material.dispose();
      },
    };
  }
  return {
    group,
    anchors,
    setChallenges,
    createStation,
    tick(time: number) {
      hologram.uniforms.time!.value = time;
      core.rotation.y = time * 0.045;
      core.position.y = 4.2 + Math.sin(time * 0.6) * 0.12;
      orbitA.rotation.z = time * 0.08;
      orbitB.rotation.z = -time * 0.11;
      dust.rotation.y = -time * 0.08;
      sky.rotation.y = time * 0.003;
    },
    dispose() {
      clearSectors();
      group.traverse((o) => {
        if (o instanceof T.InstancedMesh) o.dispose();
      });
      resources.forEach((r) => r.dispose());
      group.clear();
    },
  };
}
export type ArenaWorld = ReturnType<typeof createArenaWorld>;
export type ArenaStation = ReturnType<ArenaWorld["createStation"]>;
