import * as T from "three";
import {
  cityLayout,
  cityPosition,
  cityHash,
  type CityFacility,
  type SpectatorData,
} from "@/lib/spectator";

// Architecture is instanced by geometry/material, including the challenge
// facilities. No model, texture, network request or per-building draw call.
export function createArenaWorld() {
  const group = new T.Group(),
    anchors = new Map<string, T.Vector3>();
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>();
  const geometry = <G extends T.BufferGeometry>(g: G) => {
    geometries.add(g);
    return g;
  };
  const material = <M extends T.Material>(m: M) => {
    materials.add(m);
    return m;
  };
  const box = geometry(new T.BoxGeometry(1, 1, 1)),
    cylinder = geometry(new T.CylinderGeometry(0.5, 0.5, 1, 12));
  const dome = geometry(
    new T.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  );
  const cone = geometry(new T.CylinderGeometry(0.32, 0.5, 1, 12));
  const ring = geometry(new T.TorusGeometry(1, 0.025, 4, 48));
  const pavement = material(
    new T.MeshStandardMaterial({
      color: "#102845",
      roughness: 0.85,
      metalness: 0.2,
    }),
  );
  const asphalt = material(
    new T.MeshStandardMaterial({ color: "#050f21", roughness: 0.8 }),
  );
  const steel = material(
    new T.MeshStandardMaterial({
      color: "#225375",
      metalness: 0.65,
      roughness: 0.35,
    }),
  );
  const glass = material(
    new T.MeshStandardMaterial({
      color: "#15517b",
      metalness: 0.75,
      roughness: 0.2,
    }),
  );
  const cyan = material(
    new T.MeshBasicMaterial({
      color: new T.Color("#2fd4f2").multiplyScalar(2.2),
    }),
  );
  const blue = material(
    new T.MeshBasicMaterial({
      color: new T.Color("#2877c8").multiplyScalar(1.1),
    }),
  );
  const districtEdge = material(
    new T.MeshBasicMaterial({
      color: new T.Color("#3b82f6").multiplyScalar(1.6),
    }),
  );
  const districtWall = material(
    new T.MeshBasicMaterial({
      color: "#3b82f6",
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    }),
  );
  districtEdge.name = "district-outline";
  districtWall.name = "district-wall";
  const amber = material(
    new T.MeshBasicMaterial({
      color: new T.Color("#ffba65").multiplyScalar(2),
    }),
  );
  const green = material(
    new T.MeshBasicMaterial({
      color: new T.Color("#58dac3").multiplyScalar(1.5),
    }),
  );
  const facade = material(
    new T.ShaderMaterial({
      fog: true,
      uniforms: { ...T.UniformsUtils.clone(T.UniformsLib.fog) },
      vertexShader: `varying vec3 vCity; varying vec3 vSide;
      #include <fog_pars_vertex>
      void main(){vec4 p=vec4(position,1.);
      #ifdef USE_INSTANCING
        p=instanceMatrix*p;
      #endif
      vec4 world=modelMatrix*p;vCity=world.xyz;vSide=normalize(mat3(modelMatrix)*normal);
      vec4 mvPosition=viewMatrix*world;gl_Position=projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`,
      fragmentShader: `varying vec3 vCity;varying vec3 vSide;
      #include <fog_pars_fragment>
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      void main(){float side=1.-step(.5,abs(vSide.y));
        float horizontal=mix(vCity.x,vCity.z,step(.5,abs(vSide.x)));
        vec2 cell=vec2(horizontal*1.8,vCity.y*1.15);
        vec2 f=fract(cell);float lit=step(.35,hash(floor(cell)));
        float window=step(.24,f.x)*step(f.x,.68)*step(.25,f.y)*step(f.y,.64)*side*lit;
        float shade=.38+max(dot(vSide,normalize(vec3(-.5,.8,.4))),0.)*.75;
        vec3 col=vec3(.025,.085,.155)*shade;
        col+=mix(vec3(.04,.33,.68),vec3(.22,.72,.88),hash(floor(cell)))*window*1.15;
        gl_FragColor=vec4(col,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    }),
  );
  type Batch = {
    geo: T.BufferGeometry;
    mat: T.Material;
    matrices: T.Matrix4[];
  };
  const staticBatches = new Map<string, Batch>(),
    facilityBatches = new Map<string, Batch>();
  const dummy = new T.Object3D();
  const add = (
    batches: Map<string, Batch>,
    g: T.BufferGeometry,
    m: T.Material,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    ry = 0,
    rx = 0,
  ) => {
    const key = g.uuid + m.uuid;
    if (!batches.has(key)) batches.set(key, { geo: g, mat: m, matrices: [] });
    dummy.position.set(x, y, z);
    dummy.scale.set(sx, sy, sz);
    dummy.rotation.set(rx, ry, 0);
    dummy.updateMatrix();
    batches.get(key)!.matrices.push(dummy.matrix.clone());
  };
  const meshes = (batches: Map<string, Batch>, target: T.Group) => {
    for (const b of batches.values()) {
      const mesh = new T.InstancedMesh(b.geo, b.mat, b.matrices.length);
      mesh.name = b.mat.name;
      b.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.computeBoundingSphere();
      target.add(mesh);
    }
  };
  const ground = new T.Mesh(
    geometry(new T.PlaneGeometry(1600, 1600)),
    material(new T.MeshStandardMaterial({ color: "#040e22", roughness: 1 })),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.35;
  group.add(ground);
  // Street blocks and the central waterway give the city a readable geography.
  for (let row = 0; row < 8; row++)
    for (let col = 0; col < 8; col++) {
      const x = (col - 3.5) * 12,
        z = (row - 3.5) * 12;
      add(staticBatches, box, pavement, x, -0.05, z, 10.4, 0.45, 10.4);
    }
  for (let i = -4; i <= 4; i++) {
    const lane = i * 12;
    add(staticBatches, box, asphalt, lane, 0, 0, 1.6, 0.1, 106);
    if (i !== 0) add(staticBatches, box, asphalt, 0, 0, lane, 106, 0.1, 1.6);
    for (const sign of [-1, 1]) {
      add(
        staticBatches,
        box,
        blue,
        lane + sign * 0.88,
        0.09,
        0,
        0.055,
        0.035,
        106,
      );
      if (i !== 0)
        add(
          staticBatches,
          box,
          blue,
          0,
          0.09,
          lane + sign * 0.88,
          106,
          0.035,
          0.055,
        );
    }
    for (let t = -50; t < 52; t += 3.2) {
      add(staticBatches, box, steel, lane, 0.07, t, 0.07, 0.02, 1.2);
      if (i !== 0)
        add(staticBatches, box, steel, t, 0.07, lane, 1.2, 0.02, 0.07);
    }
  }
  const water = new T.Mesh(
    geometry(new T.PlaneGeometry(136, 4.5, 1, 1)),
    material(
      new T.ShaderMaterial({
        uniforms: { time: { value: 0 } },
        vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader: `varying vec2 vUv;uniform float time;void main(){float w=sin(vUv.x*240.+time*.6)*sin(vUv.y*35.+time*.4)*.5+.5;gl_FragColor=vec4(mix(vec3(.008,.025,.07),vec3(.025,.14,.24),w),1.);
      #include <colorspace_fragment>
    }`,
      }),
    ),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.03;
  group.add(water);
  for (const sign of [-1, 1])
    add(staticBatches, box, cyan, 0, 0.1, sign * 2.3, 110, 0.045, 0.06);
  // Bridges, elevated perimeter transit and piers.
  for (const x of [-36, -12, 12, 36]) {
    add(staticBatches, box, steel, x, 0.6, 0, 2.2, 0.35, 7.5);
    for (const sign of [-1, 1])
      add(staticBatches, box, cyan, x + sign * 1.1, 0.9, 0, 0.055, 0.06, 7.5);
  }
  for (const sign of [-1, 1]) {
    add(staticBatches, box, steel, sign * 53, 2, 0, 1.5, 0.3, 107);
    add(staticBatches, box, steel, 0, 2, sign * 53, 107, 0.3, 1.5);
    add(staticBatches, box, cyan, sign * 53, 2.2, 0, 0.12, 0.05, 107);
    add(staticBatches, box, cyan, 0, 2.2, sign * 53, 107, 0.05, 0.12);
    for (let p = -48; p <= 48; p += 12) {
      add(staticBatches, box, pavement, sign * 53, 1, p, 0.6, 2, 0.6);
      add(staticBatches, box, pavement, p, 1, sign * 53, 0.6, 2, 0.6);
    }
  }
  // Distant skyline fills the horizon without competing with labelled facilities.
  for (let i = 0; i < 160; i++) {
    const seed = cityHash(`skyline-${i}`),
      angle = (i / 160) * Math.PI * 2;
    const radius = 72 + (seed % 20),
      height = 5 + (seed % 170) / 10;
    const x = Math.cos(angle) * radius,
      z = Math.sin(angle) * radius;
    add(
      staticBatches,
      box,
      facade,
      x,
      height / 2,
      z,
      2 + (seed % 17) / 10,
      height,
      2.2 + (seed % 23) / 10,
    );
  }
  meshes(staticBatches, group);
  const district = new T.Group();
  group.add(district);
  let signature: string | null = null,
    facilities: CityFacility[] = [];
  const clearDistrict = () => {
    for (const o of [...district.children]) {
      if (o instanceof T.InstancedMesh) o.dispose();
      district.remove(o);
    }
  };
  const setChallenges = (challenges: SpectatorData["challenges"]) => {
    const layout = cityLayout(challenges),
      next = layout.facilities,
      key = next
        .map((n) => `${n.id}:${n.category}:${n.slot}:${n.grid}`)
        .join("|");
    facilities = next;
    if (key === signature) return facilities;
    signature = key;
    anchors.clear();
    clearDistrict();
    facilityBatches.clear();
    const bySlot = new Map(next.map((n) => [n.slot, n]));
    const put = (
      g: T.BufferGeometry,
      m: T.Material,
      x: number,
      y: number,
      z: number,
      sx: number,
      sy: number,
      sz: number,
      ry = 0,
      rx = 0,
    ) => add(facilityBatches, g, m, x, y, z, sx, sy, sz, ry, rx);
    for (const region of layout.districts) {
      const first = cityPosition(region.col, region.row, layout.grid),
        last = cityPosition(
          region.col + region.width - 1,
          region.row + region.depth - 1,
          layout.grid,
        );
      const w = last.x - first.x + 5,
        d = last.z - first.z + 5;
      put(box, glass, region.x, 0.12, region.z, w, 0.08, d);
      for (const side of [-1, 1]) {
        // A continuous low blue enclosure reads as one district above the
        // pavement. Both outlines and translucent walls stay instanced.
        for (const y of [0.35, 1.7]) {
          put(
            box,
            districtEdge,
            region.x + (side * w) / 2,
            y,
            region.z,
            0.18,
            0.12,
            d + 0.18,
          );
          put(
            box,
            districtEdge,
            region.x,
            y,
            region.z + (side * d) / 2,
            w + 0.18,
            0.12,
            0.18,
          );
        }
        put(
          box,
          districtWall,
          region.x + (side * w) / 2,
          1,
          region.z,
          0.06,
          1.3,
          d,
        );
        put(
          box,
          districtWall,
          region.x,
          1,
          region.z + (side * d) / 2,
          w,
          1.3,
          0.06,
        );
        for (const end of [-1, 1])
          put(
            box,
            districtEdge,
            region.x + (side * w) / 2,
            1,
            region.z + (end * d) / 2,
            0.25,
            1.5,
            0.25,
          );
      }
    }
    for (let slot = 0; slot < layout.grid * layout.grid; slot++) {
      const { x, z } = cityPosition(
        slot % layout.grid,
        Math.floor(slot / layout.grid),
        layout.grid,
      );
      const facility = bySlot.get(slot),
        seed = cityHash(`block-${slot}`);
      if (!facility) {
        // A mix of offices, lower service buildings and roof equipment.
        const h = 1.4 + (seed % 52) / 10;
        put(
          box,
          facade,
          x,
          h / 2 + 0.2,
          z,
          2.2 + (seed % 12) / 10,
          h,
          2.1 + (seed % 8) / 10,
        );
        put(box, steel, x, h + 0.3, z, 1.5, 0.2, 1.4);
        put(box, blue, x, h + 0.42, z, 1.55, 0.04, 1.45);
        put(box, facade, x + 1.5, 0.9, z + 1.4, 1, 1.4, 1.2);
        if (slot % 3 === 0) put(box, amber, x, h + 0.6, z, 0.1, 0.3, 0.1);
        continue;
      }
      const h = facility.height,
        category = facility.category.toLowerCase();
      put(box, pavement, x, 0.4, z, 4.7, 0.4, 4.7);
      put(box, cyan, x, 0.63, z, 4.72, 0.035, 4.72);
      put(box, asphalt, x, 0.68, z, 4.58, 0.06, 4.58);
      let top = h;
      if (category === "web") {
        for (const dx of [-1.25, 1.25]) {
          put(box, glass, x + dx, 1.8, z, 1.65, 2.5, 3.5);
          for (let n = 0; n < 5; n++)
            put(box, cyan, x + dx, 1 + n * 0.38, z + 1.77, 1.3, 0.07, 0.03);
          put(box, steel, x + dx, 3.1, z, 1.8, 0.2, 3.7);
        }
        put(box, facade, x, h / 2 + 0.7, z - 0.2, 1.05, h, 1.8);
        top = h + 0.7;
        put(box, cyan, x, top + 0.1, z - 0.2, 1.15, 0.12, 1.9);
      } else if (category === "pwn") {
        for (const dx of [-1.25, 1.25]) {
          put(cone, steel, x + dx, 2.3, z, 1.6, 3.3, 1.6);
          put(cylinder, amber, x + dx, 4, z, 1, 0.12, 1);
        }
        put(box, glass, x, 1, z + 1.3, 3.8, 0.7, 1.2);
        put(cylinder, steel, x, 4, z - 1.5, 0.45, 6.5, 0.45);
        top = 7.25;
        put(cylinder, amber, x, top, z - 1.5, 0.5, 0.12, 0.5);
      } else if (category === "crypto") {
        put(cylinder, steel, x, 1, z, 4.1, 1, 4.1);
        put(cone, glass, x, 3.1, z, 3, 3.5, 3);
        for (const y of [1.6, 3.1, 4.7])
          put(cylinder, cyan, x, y, z, 3.05, 0.09, 3.05);
        put(cylinder, steel, x, 5.7, z, 0.2, 2, 0.2);
        top = 6.7;
      } else if (category === "reverse") {
        put(box, glass, x, 1.4, z, 4.1, 1.5, 3.1);
        put(dome, steel, x, 2.2, z, 4.5, 3.5, 3.3);
        for (const dx of [-1.4, 0, 1.4])
          put(box, cyan, x + dx, 1.9, z + 1.65, 0.12, 1.6, 0.05);
        put(box, facade, x - 1.5, 3.7, z - 1.3, 0.8, 6, 0.8);
        top = 6.7;
      } else if (category === "forensics") {
        put(cylinder, glass, x, 2.2, z, 3, 3.2, 3);
        put(dome, steel, x, 3.8, z, 3.4, 3.4, 3.4);
        put(cylinder, cyan, x, 3.8, z, 3.5, 0.12, 3.5);
        put(cylinder, steel, x, 5.8, z, 0.16, 2.4, 0.16);
        top = 7;
      } else {
        put(cone, steel, x, h / 2 + 0.7, z, 2.1, h, 2.1);
        for (const [y, r] of [
          [h * 0.45, 2.9],
          [h * 0.8, 2.2],
          [h + 0.7, 1.4],
        ]) {
          put(cylinder, glass, x, y, z, r, 0.22, r);
          put(cylinder, cyan, x, y + 0.14, z, r, 0.05, r);
        }
        put(cylinder, steel, x, h + 1.3, z, 0.12, 2, 0.12);
        top = h + 2.3;
      }
      put(box, green, x, top + 0.25, z, 0.16, 0.3, 0.16);
      anchors.set(facility.id, new T.Vector3(x, top + 0.5, z));
    }
    meshes(facilityBatches, district);
    return facilities;
  };
  // Moving lights follow roads. They are ambient city traffic, never match events.
  const traffic = new T.InstancedMesh(box, cyan, 64);
  traffic.instanceMatrix.setUsage(T.DynamicDrawUsage);
  traffic.frustumCulled = false;
  group.add(traffic);
  const focus = new T.Mesh(ring, cyan);
  focus.rotation.x = -Math.PI / 2;
  focus.visible = false;
  group.add(focus);
  let focused: string | null = null;
  const setFocus = (id: string | null) => {
    focused = id;
    focus.visible = !!id && anchors.has(id);
  };
  const tick = (time: number) => {
    (water.material as T.ShaderMaterial).uniforms.time!.value = time;
    for (let i = 0; i < 64; i++) {
      const seed = cityHash(`traffic-${i}`),
        lane = ((seed % 8) - 4) * 12;
      const p = ((time * (1.5 + (seed % 3)) + (seed % 104)) % 104) - 52;
      dummy.position.set(
        i % 2 ? lane + 0.35 : p,
        0.24,
        i % 2 ? p : lane + 0.35,
      );
      if (Math.abs(dummy.position.z) < 2.4) dummy.position.y = 0.85;
      dummy.scale.set(i % 2 ? 0.1 : 1.5, 0.08, i % 2 ? 1.5 : 0.1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      traffic.setMatrixAt(i, dummy.matrix);
    }
    traffic.instanceMatrix.needsUpdate = true;
    const a = focused ? anchors.get(focused) : null;
    if (a) {
      focus.position.set(a.x, 0.8, a.z);
      focus.scale.setScalar(2.6 + Math.sin(time * 2) * 0.12);
    }
  };
  setChallenges([]);
  tick(0);
  return {
    group,
    anchors,
    setChallenges,
    setFocus,
    tick,
    dispose: () => {
      group.traverse((o) => {
        if (o instanceof T.InstancedMesh) o.dispose();
      });
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      anchors.clear();
      group.clear();
    },
  };
}
