(() => {
  const errorBox = document.getElementById("errorBox");

  function showError(message) {
    errorBox.style.display = "block";
    errorBox.textContent = message;
  }

  if (!window.THREE) {
    showError(
      "Three.js did not load, so the 3D game cannot start.\n\n" +
      "Most likely causes:\n" +
      "1. You are offline.\n" +
      "2. Your network blocked cdn.jsdelivr.net.\n" +
      "3. The file path is wrong on GitHub Pages.\n\n" +
      "Fix: make sure index.html loads this URL:\n" +
      "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js"
    );
    return;
  }

  const THREE = window.THREE;
  const canvas = document.getElementById("game");

  const ui = {
    center: document.getElementById("center"),
    zone: document.getElementById("zone"),
    speed: document.getElementById("speed"),
    wanted: document.getElementById("wanted"),
    damage: document.getElementById("damage"),
    nitro: document.getElementById("nitro"),
    score: document.getElementById("score"),
    time: document.getElementById("time"),
    flash: document.getElementById("flash"),
    minimap: document.getElementById("minimap")
  };

  const miniCtx = ui.minimap.getContext("2d");

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance"
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87a9d4);
  scene.fog = new THREE.Fog(0xb8c9df, 900, 2700);

  const camera = new THREE.PerspectiveCamera(
    64,
    window.innerWidth / window.innerHeight,
    0.1,
    5000
  );

  const clock = new THREE.Clock();

  const MAP = {
    width: 2600,
    height: 1800,
    roadWidth: 82,
    halfW: 1300,
    halfH: 900
  };

  const keys = Object.create(null);
  const touch = { left: false, right: false, gas: false, brake: false, boost: false };

  const world = {
    roads: [],
    buildings: [],
    obstacles: [],
    traffic: [],
    cops: [],
    checkpoints: [],
    particles: [],
    roadSpawnPoints: [],
    trafficPaths: []
  };

  const game = {
    started: false,
    over: false,
    score: 0,
    time: 0,
    wanted: 1,
    checkpointCount: 0,
    shake: 0,
    flash: 0,
    spawnTimer: 0
  };

  const player = {
    mesh: null,
    pos: new THREE.Vector3(-900, 0, 0),
    yaw: Math.PI / 2,
    speed: 0,
    steer: 0,
    damage: 0,
    nitro: 100,
    radius: 18
  };

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function chance(p) {
    return Math.random() < p;
  }

  function distXZ(a, b) {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.hypot(dx, dz);
  }

  function angleWrap(a) {
    return Math.atan2(Math.sin(a), Math.cos(a));
  }

  function forward(yaw) {
    return new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
  }

  function formatTime(t) {
    const m = Math.floor(t / 60);
    const s = String(Math.floor(t % 60)).padStart(2, "0");
    return `${m}:${s}`;
  }

  function mat(color, rough = .75, metal = 0, emissive = 0x000000, intensity = 0) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: rough,
      metalness: metal,
      emissive: new THREE.Color(emissive),
      emissiveIntensity: intensity
    });
  }

  const mats = {
    cityGround: mat(0x20252d, .92, 0),
    plainsGround: mat(0x4d8b45, .92, 0),
    desertGround: mat(0xc89d5d, .95, 0),
    road: mat(0x161a22, .92, 0),
    roadShoulder: mat(0x30333a, .9, 0),
    laneWhite: mat(0xf8fbff, .55, 0, 0xffffff, .05),
    laneYellow: mat(0xffc44d, .55, 0, 0xffbb44, .08),
    playerBlue: mat(0x00c8ff, .35, .35, 0x008cff, .35),
    glass: mat(0x6bd6ff, .16, .1, 0x52caff, .15),
    tire: mat(0x050505, .8, .1),
    police: mat(0x0a0f1b, .42, .25),
    white: mat(0xffffff, .55, 0),
    redLight: mat(0xff2020, .35, 0, 0xff0000, 1.7),
    blueLight: mat(0x225cff, .35, 0, 0x0044ff, 1.7),
    greenNeon: mat(0x3cff98, .4, 0, 0x20ff85, 1.5),
    pinkNeon: mat(0xff38eb, .4, 0, 0xff22e6, 1.4),
    spark: mat(0xffb13b, .4, 0, 0xff8800, 1.8)
  };

  function createLabelTexture(text, bg, fg) {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 128;
    const g = c.getContext("2d");
    g.fillStyle = bg;
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = "rgba(255,255,255,.75)";
    g.lineWidth = 8;
    g.strokeRect(8, 8, c.width - 16, c.height - 16);
    g.fillStyle = fg;
    g.font = "900 54px Arial";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, c.width / 2, c.height / 2 + 3);
    const texture = new THREE.CanvasTexture(c);
    texture.anisotropy = 4;
    return texture;
  }

  function setupLights() {
    const hemi = new THREE.HemisphereLight(0xd6e8ff, 0x1c241a, 1.05);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff1d2, 2.2);
    sun.position.set(-360, 720, 420);
    sun.castShadow = true;
    sun.shadow.camera.left = -1800;
    sun.shadow.camera.right = 1800;
    sun.shadow.camera.top = 1400;
    sun.shadow.camera.bottom = -1400;
    sun.shadow.mapSize.set(2048, 2048);
    scene.add(sun);
  }

  function addGround() {
    const city = new THREE.Mesh(
      new THREE.PlaneGeometry(900, MAP.height),
      mats.cityGround
    );
    city.rotation.x = -Math.PI / 2;
    city.position.set(-850, -0.04, 0);
    city.receiveShadow = true;
    scene.add(city);

    const plains = new THREE.Mesh(
      new THREE.PlaneGeometry(800, MAP.height),
      mats.plainsGround
    );
    plains.rotation.x = -Math.PI / 2;
    plains.position.set(0, -0.05, 0);
    plains.receiveShadow = true;
    scene.add(plains);

    const desert = new THREE.Mesh(
      new THREE.PlaneGeometry(900, MAP.height),
      mats.desertGround
    );
    desert.rotation.x = -Math.PI / 2;
    desert.position.set(850, -0.06, 0);
    desert.receiveShadow = true;
    scene.add(desert);

    addRegionSign("CITY", -1160, -770, 0x151923);
    addRegionSign("PLAINS", 0, -770, 0x275a2e);
    addRegionSign("DESERT", 1040, -770, 0x9c713a);

    addMapWall();
  }

  function addMapWall() {
    const wallMat = mat(0x10141d, .85, 0);
    const h = 45;
    const pieces = [
      { x: 0, z: -MAP.halfH, w: MAP.width, d: 20 },
      { x: 0, z: MAP.halfH, w: MAP.width, d: 20 },
      { x: -MAP.halfW, z: 0, w: 20, d: MAP.height },
      { x: MAP.halfW, z: 0, w: 20, d: MAP.height }
    ];

    for (const p of pieces) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(p.w, h, p.d), wallMat);
      wall.position.set(p.x, h / 2, p.z);
      wall.castShadow = true;
      wall.receiveShadow = true;
      scene.add(wall);
    }
  }

  function addRegionSign(text, x, z, bgColor) {
    const tex = createLabelTexture(text, "#" + bgColor.toString(16).padStart(6, "0"), "#ffffff");
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(180, 45),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
    );
    sign.position.set(x, 42, z);
    sign.rotation.y = Math.PI;
    scene.add(sign);

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 42, 8), mat(0x222222, .7, .2));
    pole.position.set(x, 21, z + 2);
    pole.castShadow = true;
    scene.add(pole);
  }

  function addRoadRect(x, z, w, d, kind = "road") {
    const shoulder = new THREE.Mesh(
      new THREE.BoxGeometry(w + 18, .08, d + 18),
      mats.roadShoulder
    );
    shoulder.position.set(x, .005, z);
    shoulder.receiveShadow = true;
    scene.add(shoulder);

    const road = new THREE.Mesh(
      new THREE.BoxGeometry(w, .10, d),
      kind === "desert" ? mat(0x2a2723, .95, 0) : mats.road
    );
    road.position.set(x, .04, z);
    road.receiveShadow = true;
    scene.add(road);

    const rect = { x, z, w, d };
    world.roads.push(rect);

    // Spawn points down the centerline.
    if (w > d) {
      for (let px = x - w / 2 + 80; px <= x + w / 2 - 80; px += 140) {
        world.roadSpawnPoints.push(new THREE.Vector3(px, 0, z));
      }
    } else {
      for (let pz = z - d / 2 + 80; pz <= z + d / 2 - 80; pz += 140) {
        world.roadSpawnPoints.push(new THREE.Vector3(x, 0, pz));
      }
    }

    addLaneDashes(x, z, w, d);
  }

  function addLaneDashes(x, z, w, d) {
    const dashLen = 26;
    const gap = 34;
    const yellowW = 3.5;
    const whiteW = 3;

    if (w >= d) {
      // Horizontal road: dashes are fixed in world coordinates.
      for (let px = x - w / 2 + 40; px < x + w / 2 - 40; px += dashLen + gap) {
        const yellow = new THREE.Mesh(new THREE.BoxGeometry(dashLen, .18, yellowW), mats.laneYellow);
        yellow.position.set(px, .12, z);
        scene.add(yellow);

        const top = new THREE.Mesh(new THREE.BoxGeometry(dashLen, .17, whiteW), mats.laneWhite);
        top.position.set(px, .13, z - d * .32);
        scene.add(top);

        const bottom = new THREE.Mesh(new THREE.BoxGeometry(dashLen, .17, whiteW), mats.laneWhite);
        bottom.position.set(px, .13, z + d * .32);
        scene.add(bottom);
      }
    } else {
      for (let pz = z - d / 2 + 40; pz < z + d / 2 - 40; pz += dashLen + gap) {
        const yellow = new THREE.Mesh(new THREE.BoxGeometry(yellowW, .18, dashLen), mats.laneYellow);
        yellow.position.set(x, .12, pz);
        scene.add(yellow);

        const left = new THREE.Mesh(new THREE.BoxGeometry(whiteW, .17, dashLen), mats.laneWhite);
        left.position.set(x - w * .32, .13, pz);
        scene.add(left);

        const right = new THREE.Mesh(new THREE.BoxGeometry(whiteW, .17, dashLen), mats.laneWhite);
        right.position.set(x + w * .32, .13, pz);
        scene.add(right);
      }
    }
  }

  function buildRoads() {
    const r = MAP.roadWidth;

    // City grid: wider than the old 2D version.
    for (const x of [-1120, -900, -680, -460]) {
      addRoadRect(x, 0, r, 1540);
    }

    for (const z of [-640, -420, -200, 20, 240, 460, 680]) {
      addRoadRect(-790, z, 760, r);
    }

    // Main highway through all regions.
    addRoadRect(-245, 20, 510, 96);
    addRoadRect(250, 20, 760, 96);
    addRoadRect(820, 20, 710, 96, "desert");

    // Plains roads and farm loop.
    addRoadRect(-60, -460, 112, 700);
    addRoadRect(210, -520, 620, 72);
    addRoadRect(270, 460, 780, 72);

    // Desert loop.
    addRoadRect(850, -500, 98, 790, "desert");
    addRoadRect(850, 520, 98, 600, "desert");
    addRoadRect(950, -540, 520, 72, "desert");
    addRoadRect(1030, 520, 470, 72, "desert");
  }

  function onRoad(x, z) {
    for (const r of world.roads) {
      if (Math.abs(x - r.x) <= r.w / 2 && Math.abs(z - r.z) <= r.d / 2) {
        return true;
      }
    }
    return false;
  }

  function nearestRoadPoint(x, z) {
    let best = null;
    let bestD = Infinity;

    for (const r of world.roads) {
      const px = clamp(x, r.x - r.w / 2 + 8, r.x + r.w / 2 - 8);
      const pz = clamp(z, r.z - r.d / 2 + 8, r.z + r.d / 2 - 8);
      const d = Math.hypot(px - x, pz - z);

      if (d < bestD) {
        bestD = d;
        best = new THREE.Vector3(px, 0, pz);
      }
    }

    return best || new THREE.Vector3(x, 0, z);
  }

  function randomRoadPoint(minDistanceFromPlayer = 0) {
    for (let i = 0; i < 40; i++) {
      const p = world.roadSpawnPoints[Math.floor(Math.random() * world.roadSpawnPoints.length)].clone();
      if (distXZ(p, player.pos) >= minDistanceFromPlayer) return p;
    }
    return world.roadSpawnPoints[0].clone();
  }

  function addCityBuildings() {
    const buildingMats = [
      mat(0x2b3140, .72, .08),
      mat(0x1f2733, .74, .08),
      mat(0x343848, .70, .10),
      mat(0x262d3b, .75, .05)
    ];

    for (let x = -1240; x <= -360; x += 90) {
      for (let z = -760; z <= 760; z += 90) {
        if (onRoad(x, z) || chance(.18)) continue;

        const w = rand(34, 62);
        const d = rand(34, 62);
        const h = rand(45, 210) * (chance(.08) ? 1.7 : 1);
        const bx = x + rand(-22, 22);
        const bz = z + rand(-22, 22);

        if (onRoad(bx, bz)) continue;

        const b = new THREE.Mesh(
          new THREE.BoxGeometry(w, h, d),
          buildingMats[Math.floor(Math.random() * buildingMats.length)]
        );
        b.position.set(bx, h / 2, bz);
        b.castShadow = true;
        b.receiveShadow = true;
        scene.add(b);

        world.buildings.push({ mesh: b, x: bx, z: bz, w, d, h });
        world.obstacles.push({ type: "box", x: bx, z: bz, w: w + 5, d: d + 5 });

        addBuildingWindows(bx, bz, w, h, d);
        if (chance(.12)) addNeonBillboard(bx, bz, h, d);
      }
    }
  }

  function addBuildingWindows(x, z, w, h, d) {
    const rows = Math.min(14, Math.floor(h / 13));
    const cols = Math.max(2, Math.floor(w / 10));

    const winMat = chance(.7)
      ? mat(0xffd683, .45, 0, 0xffb14d, .9)
      : mat(0x73d6ff, .45, 0, 0x46bfff, .75);

    const group = new THREE.Group();

    for (let r = 1; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (chance(.42)) continue;
        const win = new THREE.Mesh(new THREE.PlaneGeometry(4, 5), winMat);
        win.position.set(-w / 2 + 8 + c * ((w - 16) / Math.max(1, cols - 1)), -h / 2 + 9 + r * 12, d / 2 + .2);
        group.add(win);
      }
    }

    group.position.set(x, h / 2, z);
    scene.add(group);
  }

  function addNeonBillboard(x, z, h, d) {
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(54, 15, 1.2),
      chance(.5) ? mats.pinkNeon : mats.greenNeon
    );
    panel.position.set(x, h + 12, z + d / 2 + 2);
    scene.add(panel);

    const light = new THREE.PointLight(chance(.5) ? 0xff38eb : 0x3cff98, 1.2, 120);
    light.position.copy(panel.position);
    scene.add(light);
  }

  function addPlains() {
    // Farm fields
    for (let i = 0; i < 9; i++) {
      const x = rand(-270, 380);
      const z = rand(-760, 750);
      if (onRoad(x, z)) continue;

      const field = new THREE.Mesh(
        new THREE.BoxGeometry(rand(100, 190), .06, rand(70, 150)),
        mat(chance(.5) ? 0x65a84c : 0x8eac45, .95, 0)
      );
      field.position.set(x, .03, z);
      field.receiveShadow = true;
      scene.add(field);
    }

    // Trees
    for (let i = 0; i < 115; i++) {
      const x = rand(-360, 420);
      const z = rand(-840, 840);
      if (onRoad(x, z)) continue;
      addTree(x, z, rand(.75, 1.35));
    }

    // Barns / houses
    for (let i = 0; i < 12; i++) {
      const x = rand(-320, 390);
      const z = rand(-810, 810);
      if (onRoad(x, z)) continue;
      addBarn(x, z);
    }
  }

  function addTree(x, z, s) {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(2.5 * s, 3.2 * s, 20 * s, 8),
      mat(0x6a4528, .7, 0)
    );
    trunk.position.set(x, 10 * s, z);
    trunk.castShadow = true;
    scene.add(trunk);

    const top = new THREE.Mesh(
      new THREE.ConeGeometry(16 * s, 38 * s, 10),
      mat(0x245b2b, .85, 0)
    );
    top.position.set(x, 36 * s, z);
    top.castShadow = true;
    scene.add(top);

    world.obstacles.push({ type: "circle", x, z, r: 8 * s });
  }

  function addBarn(x, z) {
    const w = rand(42, 65);
    const d = rand(38, 58);
    const h = rand(24, 34);

    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(0x8e2f28, .75, 0));
    body.position.set(x, h / 2, z);
    body.castShadow = true;
    body.receiveShadow = true;
    scene.add(body);

    const roof = new THREE.Mesh(new THREE.ConeGeometry(w * .72, h * .7, 4), mat(0x3d3030, .65, .05));
    roof.rotation.y = Math.PI / 4;
    roof.scale.z = d / w;
    roof.position.set(x, h + h * .32, z);
    roof.castShadow = true;
    scene.add(roof);

    world.obstacles.push({ type: "box", x, z, w: w + 6, d: d + 6 });
  }

  function addDesert() {
    for (let i = 0; i < 85; i++) {
      const x = rand(500, 1250);
      const z = rand(-840, 840);
      if (onRoad(x, z)) continue;

      if (chance(.45)) addCactus(x, z, rand(.7, 1.35));
      else addRock(x, z, rand(.8, 1.8));
    }

    for (let i = 0; i < 14; i++) {
      const x = rand(530, 1230);
      const z = rand(-820, 820);
      if (onRoad(x, z)) continue;

      const dune = new THREE.Mesh(
        new THREE.SphereGeometry(rand(35, 85), 16, 8),
        mat(0xd6ad6e, .98, 0)
      );
      dune.scale.y = .12;
      dune.position.set(x, 3.5, z);
      dune.receiveShadow = true;
      scene.add(dune);
    }

    addRadioTower(1110, -265);
    addGasStation(760, 515);
  }

  function addCactus(x, z, s) {
    const cactusMat = mat(0x2f8d46, .82, 0);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(5 * s, 6 * s, 38 * s, 10), cactusMat);
    stem.position.set(x, 19 * s, z);
    stem.castShadow = true;
    scene.add(stem);

    const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(3 * s, 3 * s, 23 * s, 8), cactusMat);
    arm1.rotation.z = Math.PI / 2;
    arm1.position.set(x + 10 * s, 24 * s, z);
    arm1.castShadow = true;
    scene.add(arm1);

    const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(3 * s, 3 * s, 18 * s, 8), cactusMat);
    arm2.rotation.z = Math.PI / 2;
    arm2.position.set(x - 9 * s, 15 * s, z);
    arm2.castShadow = true;
    scene.add(arm2);

    world.obstacles.push({ type: "circle", x, z, r: 8 * s });
  }

  function addRock(x, z, s) {
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(9 * s, 0),
      mat(0x7e6a55, .9, .02)
    );
    rock.scale.set(rand(1, 1.5), rand(.55, 1.0), rand(1, 1.6));
    rock.position.set(x, 5 * s, z);
    rock.rotation.set(rand(0, Math.PI), rand(0, Math.PI), rand(0, Math.PI));
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
    world.obstacles.push({ type: "circle", x, z, r: 9 * s });
  }

  function addRadioTower(x, z) {
    const towerMat = mat(0x333333, .55, .4);
    const tower = new THREE.Group();

    for (const dx of [-11, 11]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2, 150, 8), towerMat);
      leg.position.set(dx, 75, 0);
      leg.rotation.z = dx > 0 ? -.12 : .12;
      leg.castShadow = true;
      tower.add(leg);
    }

    const light = new THREE.Mesh(new THREE.SphereGeometry(5, 12, 8), mats.redLight);
    light.position.set(0, 154, 0);
    tower.add(light);

    const point = new THREE.PointLight(0xff2020, 2.2, 220);
    point.position.set(0, 154, 0);
    tower.add(point);

    tower.position.set(x, 0, z);
    scene.add(tower);
    world.obstacles.push({ type: "circle", x, z, r: 18 });
  }

  function addGasStation(x, z) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(120, 10, 75), mat(0x453f36, .75, 0));
    base.position.set(x, 5, z);
    base.castShadow = true;
    scene.add(base);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(145, 8, 95), mat(0xff3b3b, .55, .05, 0xff2020, .2));
    roof.position.set(x, 45, z);
    roof.castShadow = true;
    scene.add(roof);

    for (const dx of [-45, 45]) {
      for (const dz of [-25, 25]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 40, 8), mat(0xffffff, .6, .1));
        pole.position.set(x + dx, 25, z + dz);
        pole.castShadow = true;
        scene.add(pole);
      }
    }

    world.obstacles.push({ type: "box", x, z, w: 130, d: 85 });
  }

  function createCar({ color = 0x00c8ff, police = false, scale = 1 } = {}) {
    const group = new THREE.Group();

    const bodyMat = police ? mats.police : mat(color, .36, .35, color, .22);
    const body = new THREE.Mesh(new THREE.BoxGeometry(14, 5, 28), bodyMat);
    body.position.y = 5.3;
    body.castShadow = true;
    group.add(body);

    const hood = new THREE.Mesh(new THREE.BoxGeometry(13, 3, 10), bodyMat);
    hood.position.set(0, 7.2, -8);
    hood.castShadow = true;
    group.add(hood);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(11.5, 6, 11), mats.glass);
    cabin.position.set(0, 10, 2);
    cabin.castShadow = true;
    group.add(cabin);

    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(16, 1.2, 3), bodyMat);
    spoiler.position.set(0, 10, 14.4);
    spoiler.castShadow = true;
    group.add(spoiler);

    const wheelGeo = new THREE.CylinderGeometry(3.2, 3.2, 2.7, 16);
    const wheels = [];

    for (const sx of [-8.2, 8.2]) {
      for (const sz of [-8.8, 9.5]) {
        const wheel = new THREE.Mesh(wheelGeo, mats.tire);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(sx, 3, sz);
        wheel.castShadow = true;
        group.add(wheel);
        wheels.push(wheel);
      }
    }

    const headMat = mat(0xffffff, .2, 0, 0xffffff, 1.8);
    const tailMat = mat(0xff1111, .3, 0, 0xff1111, 1.5);

    for (const sx of [-4.7, 4.7]) {
      const head = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.2, .6), headMat);
      head.position.set(sx, 5.8, -14.4);
      group.add(head);

      const tail = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.2, .6), tailMat);
      tail.position.set(sx, 5.8, 14.4);
      group.add(tail);
    }

    if (police) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(14.6, .35, 28.6), mats.white);
      stripe.position.set(0, 8.1, 0);
      group.add(stripe);

      const lightbar = new THREE.Group();
      const red = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.2, 2.2), mats.redLight);
      const blue = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.2, 2.2), mats.blueLight);
      red.position.x = -2.7;
      blue.position.x = 2.7;
      lightbar.add(red, blue);
      lightbar.position.set(0, 14, 1);
      group.add(lightbar);
      group.userData.lightbar = lightbar;
    }

    group.userData.wheels = wheels;
    group.scale.setScalar(scale);
    scene.add(group);
    return group;
  }

  function buildTrafficPaths() {
    world.trafficPaths = [
      // City rectangle
      [
        new THREE.Vector3(-1120, 0, -640),
        new THREE.Vector3(-460, 0, -640),
        new THREE.Vector3(-460, 0, 680),
        new THREE.Vector3(-1120, 0, 680)
      ],
      // Main highway across map
      [
        new THREE.Vector3(-1120, 0, 20),
        new THREE.Vector3(-460, 0, 20),
        new THREE.Vector3(250, 0, 20),
        new THREE.Vector3(1160, 0, 20),
        new THREE.Vector3(1160, 0, 520),
        new THREE.Vector3(850, 0, 520),
        new THREE.Vector3(850, 0, -540),
        new THREE.Vector3(-900, 0, -420)
      ],
      // Plains loop
      [
        new THREE.Vector3(-60, 0, -760),
        new THREE.Vector3(-60, 0, -520),
        new THREE.Vector3(520, 0, -520),
        new THREE.Vector3(520, 0, 460),
        new THREE.Vector3(-60, 0, 460)
      ],
      // Desert loop
      [
        new THREE.Vector3(850, 0, -540),
        new THREE.Vector3(1220, 0, -540),
        new THREE.Vector3(1220, 0, 520),
        new THREE.Vector3(850, 0, 520)
      ]
    ];
  }

  function spawnTraffic(count = 38) {
    const colors = [0xffd05a, 0xe84b4b, 0xe8eeff, 0x42e889, 0xff5edc, 0x7d8bff, 0xf2f2f2];

    for (let i = 0; i < count; i++) {
      const path = world.trafficPaths[Math.floor(Math.random() * world.trafficPaths.length)];
      const idx = Math.floor(Math.random() * path.length);
      const p = path[idx].clone();
      const next = path[(idx + 1) % path.length];
      const yaw = Math.atan2(next.x - p.x, -(next.z - p.z));

      const mesh = createCar({
        color: colors[Math.floor(Math.random() * colors.length)],
        scale: .86
      });

      const car = {
        mesh,
        pos: p,
        yaw,
        speed: rand(70, 125),
        path,
        target: (idx + 1) % path.length,
        radius: 16
      };

      mesh.position.copy(car.pos);
      mesh.rotation.y = car.yaw;
      world.traffic.push(car);
    }
  }

  function spawnCop(pos) {
    const p = nearestRoadPoint(pos.x, pos.z);
    const mesh = createCar({ police: true, scale: .95 });
    const cop = {
      mesh,
      pos: p,
      yaw: rand(-Math.PI, Math.PI),
      speed: rand(70, 125),
      siren: rand(0, 10),
      radius: 18
    };

    mesh.position.copy(cop.pos);
    mesh.rotation.y = cop.yaw;
    world.cops.push(cop);
  }

  function spawnCheckpoint() {
    let p = randomRoadPoint(320);
    const group = new THREE.Group();

    const ring = new THREE.Mesh(new THREE.TorusGeometry(28, 2.3, 16, 64), mats.greenNeon);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 24;
    group.add(ring);

    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(8, 8, 110, 24, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x3cff98,
        transparent: true,
        opacity: .15,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    beam.position.y = 55;
    group.add(beam);

    const light = new THREE.PointLight(0x3cff98, 1.5, 130);
    light.position.set(0, 32, 0);
    group.add(light);

    group.position.copy(p);
    scene.add(group);

    world.checkpoints.push({
      mesh: group,
      pos: p,
      pulse: rand(0, 6)
    });
  }

  function buildWorld() {
    setupLights();
    addGround();
    buildRoads();
    addCityBuildings();
    addPlains();
    addDesert();
    buildTrafficPaths();

    // Decorative lights in city.
    for (let i = 0; i < 55; i++) {
      const p = world.roadSpawnPoints[Math.floor(Math.random() * world.roadSpawnPoints.length)];
      if (p.x > -330) continue;

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.8, 38, 8), mat(0x222836, .45, .35));
      pole.position.set(p.x + rand(-36, 36), 19, p.z + rand(-36, 36));
      pole.castShadow = true;
      scene.add(pole);

      const bulb = new THREE.Mesh(new THREE.SphereGeometry(4, 12, 8), mat(0xffcc66, .4, 0, 0xffaa44, 1.2));
      bulb.position.set(pole.position.x, 39, pole.position.z);
      scene.add(bulb);

      const light = new THREE.PointLight(0xffba6a, .65, 110);
      light.position.copy(bulb.position);
      scene.add(light);
    }
  }

  function resetGame() {
    for (const car of world.traffic) scene.remove(car.mesh);
    for (const cop of world.cops) scene.remove(cop.mesh);
    for (const cp of world.checkpoints) scene.remove(cp.mesh);
    for (const p of world.particles) scene.remove(p.mesh);

    world.traffic.length = 0;
    world.cops.length = 0;
    world.checkpoints.length = 0;
    world.particles.length = 0;

    player.pos.set(-900, 0, 20);
    player.yaw = Math.PI / 2;
    player.speed = 0;
    player.steer = 0;
    player.damage = 0;
    player.nitro = 100;

    if (!player.mesh) player.mesh = createCar({ color: 0x00c8ff, scale: 1 });
    player.mesh.position.copy(player.pos);
    player.mesh.rotation.y = player.yaw;

    game.started = false;
    game.over = false;
    game.score = 0;
    game.time = 0;
    game.wanted = 1;
    game.checkpointCount = 0;
    game.shake = 0;
    game.flash = 0;

    spawnTraffic(42);
    spawnCop(new THREE.Vector3(-740, 0, -190));
    spawnCop(new THREE.Vector3(-1010, 0, -420));

    for (let i = 0; i < 5; i++) spawnCheckpoint();

    ui.center.style.display = "block";
    ui.center.innerHTML = `
      <h1>NEON PURSUIT 3D</h1>
      <p><b>Fixed from the 2D version:</b> road lines are anchored to the world, steering buttons are no longer inverted, roads are wider, and the map is finite.</p>
      <p><kbd>W</kbd>/<kbd>↑</kbd> gas · <kbd>S</kbd>/<kbd>↓</kbd> brake · <kbd>A</kbd>/<kbd>D</kbd> steer · <kbd>Shift</kbd> nitro · <kbd>R</kbd> restart</p>
      <p>Tap or press a driving key to start.</p>
    `;
  }

  function startGame() {
    if (!game.started && !game.over) {
      game.started = true;
      ui.center.style.display = "none";
    }
  }

  function endGame() {
    game.over = true;
    game.started = false;
    ui.center.style.display = "block";
    ui.center.innerHTML = `
      <h1>BUSTED</h1>
      <p>Score: <b>${Math.floor(game.score)}</b></p>
      <p>Survived: <b>${formatTime(game.time)}</b></p>
      <p>Press <kbd>R</kbd> or tap to restart.</p>
    `;
  }

  function addDamage(amount, pos = player.pos) {
    if (game.over || amount <= 0) return;
    player.damage = clamp(player.damage + amount, 0, 100);
    game.flash = .48;
    game.shake = Math.max(game.shake, .16);
    spawnSparks(pos, Math.ceil(amount * .8));
    if (player.damage >= 100) endGame();
  }

  function spawnSparks(pos, count) {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(rand(.7, 1.8), 6, 4), mats.spark);
      mesh.position.copy(pos).add(new THREE.Vector3(rand(-7, 7), rand(4, 12), rand(-7, 7)));
      scene.add(mesh);

      world.particles.push({
        mesh,
        vel: new THREE.Vector3(rand(-70, 70), rand(25, 90), rand(-70, 70)),
        life: rand(.18, .55)
      });
    }
  }

  function handleBoxCollision(entity, box, damagePlayer) {
    const px = clamp(entity.pos.x, box.x - box.w / 2, box.x + box.w / 2);
    const pz = clamp(entity.pos.z, box.z - box.d / 2, box.z + box.d / 2);
    const dx = entity.pos.x - px;
    const dz = entity.pos.z - pz;
    const r = entity.radius || 18;

    if (dx * dx + dz * dz < r * r) {
      const len = Math.hypot(dx, dz) || 1;
      entity.pos.x = px + (dx / len) * (r + 1);
      entity.pos.z = pz + (dz / len) * (r + 1);

      if (damagePlayer) {
        addDamage(Math.min(22, Math.abs(player.speed) * .045), entity.pos);
        player.speed *= -.32;
      } else {
        entity.speed *= .45;
        entity.yaw += Math.PI / 2;
      }

      return true;
    }

    return false;
  }

  function handleCircleCollision(entity, circle, damagePlayer) {
    const dx = entity.pos.x - circle.x;
    const dz = entity.pos.z - circle.z;
    const r = (entity.radius || 18) + circle.r;
    const d = Math.hypot(dx, dz);

    if (d < r) {
      const nx = dx / (d || 1);
      const nz = dz / (d || 1);
      entity.pos.x = circle.x + nx * (r + 1);
      entity.pos.z = circle.z + nz * (r + 1);

      if (damagePlayer) {
        addDamage(Math.min(16, Math.abs(player.speed) * .035), entity.pos);
        player.speed *= -.28;
      } else {
        entity.speed *= .55;
        entity.yaw += Math.PI / 2;
      }

      return true;
    }

    return false;
  }

  function collideCarWithCar(a, b) {
    const dx = a.pos.x - b.pos.x;
    const dz = a.pos.z - b.pos.z;
    const d = Math.hypot(dx, dz);
    const min = (a.radius || 18) + (b.radius || 18);

    if (d < min) {
      const nx = dx / (d || 1);
      const nz = dz / (d || 1);
      const push = (min - d) * .6;

      a.pos.x += nx * push;
      a.pos.z += nz * push;
      b.pos.x -= nx * push;
      b.pos.z -= nz * push;

      addDamage(5 + Math.abs((a.speed || 0) - (b.speed || 0)) * .018, a.pos);

      a.speed *= -.22;
      b.speed *= .55;
      spawnSparks(a.pos, 5);
    }
  }

  function updatePlayer(dt) {
    const gas = keys.w || keys.arrowup || touch.gas;
    const brake = keys.s || keys.arrowdown || touch.brake;
    const left = keys.a || keys.arrowleft || touch.left;
    const right = keys.d || keys.arrowright || touch.right;
    const boostKey = keys.shift || touch.boost;

    let accel = 0;
    if (gas) accel += 420;
    if (brake) accel -= player.speed > 12 ? 640 : 260;

    const boosting = boostKey && player.nitro > 0 && Math.abs(player.speed) > 55;

    if (boosting) {
      accel += 520;
      player.nitro -= 32 * dt;
      game.shake = Math.max(game.shake, .045);
    } else {
      player.nitro += 12 * dt;
    }

    player.nitro = clamp(player.nitro, 0, 100);

    player.speed += accel * dt;
    player.speed *= Math.pow(.985, dt * 60);

    if (!gas && !brake) {
      player.speed *= Math.pow(.966, dt * 60);
    }

    player.speed = clamp(player.speed, -175, boosting ? 560 : 420);

    // Correct steering: A/left decreases yaw, D/right increases yaw.
    const steerInput = (right ? 1 : 0) - (left ? 1 : 0);
    player.steer = lerp(player.steer, steerInput, 1 - Math.pow(.001, dt));

    const steerPower = clamp(Math.abs(player.speed) / 230, .18, 1.12);
    player.yaw += player.steer * steerPower * 2.65 * dt * (player.speed >= 0 ? 1 : -1);

    player.pos.addScaledVector(forward(player.yaw), player.speed * dt);

    if (!onRoad(player.pos.x, player.pos.z)) {
      player.speed *= Math.pow(.94, dt * 60);
      if (Math.abs(player.speed) > 285) addDamage(3.8 * dt, player.pos);
    }

    const edgeX = MAP.halfW - 25;
    const edgeZ = MAP.halfH - 25;

    if (Math.abs(player.pos.x) > edgeX || Math.abs(player.pos.z) > edgeZ) {
      player.pos.x = clamp(player.pos.x, -edgeX, edgeX);
      player.pos.z = clamp(player.pos.z, -edgeZ, edgeZ);
      player.speed *= -.35;
      addDamage(8, player.pos);
    }

    for (const o of world.obstacles) {
      if (o.type === "box") {
        if (handleBoxCollision(player, o, true)) break;
      } else if (o.type === "circle") {
        if (handleCircleCollision(player, o, true)) break;
      }
    }

    for (const t of world.traffic) collideCarWithCar(player, t);
    for (const c of world.cops) collideCarWithCar(player, c);

    for (let i = world.checkpoints.length - 1; i >= 0; i--) {
      const cp = world.checkpoints[i];
      cp.pulse += dt * 5;
      cp.mesh.rotation.y += dt * 1.6;
      cp.mesh.scale.setScalar(1 + Math.sin(cp.pulse) * .045);

      if (distXZ(player.pos, cp.pos) < 55) {
        scene.remove(cp.mesh);
        world.checkpoints.splice(i, 1);

        game.score += 1000 + Math.floor(Math.abs(player.speed) * 2.3);
        game.checkpointCount++;
        game.wanted = clamp(1 + Math.floor(game.checkpointCount / 2), 1, 5);

        if (world.cops.length < 2 + game.wanted * 2) {
          const angle = rand(0, Math.PI * 2);
          const r = rand(520, 820);
          spawnCop(new THREE.Vector3(
            player.pos.x + Math.cos(angle) * r,
            0,
            player.pos.z + Math.sin(angle) * r
          ));
        }

        spawnCheckpoint();
        spawnCheckpoint();
      }
    }

    player.mesh.position.copy(player.pos);
    player.mesh.rotation.y = player.yaw;

    for (const w of player.mesh.userData.wheels) {
      w.rotation.x += player.speed * dt * .09;
    }
  }

  function updateTraffic(dt) {
    for (const car of world.traffic) {
      const target = car.path[car.target];
      const dx = target.x - car.pos.x;
      const dz = target.z - car.pos.z;
      const desired = Math.atan2(dx, -dz);

      car.yaw += clamp(angleWrap(desired - car.yaw), -2.4 * dt, 2.4 * dt);
      car.pos.addScaledVector(forward(car.yaw), car.speed * dt);

      if (Math.hypot(dx, dz) < 35) {
        car.target = (car.target + 1) % car.path.length;
      }

      if (!onRoad(car.pos.x, car.pos.z)) {
        const p = nearestRoadPoint(car.pos.x, car.pos.z);
        car.pos.lerp(p, .08);
      }

      car.mesh.position.copy(car.pos);
      car.mesh.rotation.y = car.yaw;

      for (const w of car.mesh.userData.wheels) {
        w.rotation.x += car.speed * dt * .08;
      }
    }
  }

  function updateCops(dt) {
    for (const cop of world.cops) {
      cop.siren += dt * 9;

      const to = player.pos.clone().sub(cop.pos);
      const d = to.length();

      let targetYaw = Math.atan2(to.x, -to.z);

      // Grid-ish chase: cops use road directions when far away.
      if (d > 250 || !onRoad(cop.pos.x, cop.pos.z)) {
        targetYaw = Math.abs(to.x) > Math.abs(to.z)
          ? (to.x > 0 ? Math.PI / 2 : -Math.PI / 2)
          : (to.z > 0 ? Math.PI : 0);
      }

      cop.yaw += clamp(angleWrap(targetYaw - cop.yaw), -3.3 * dt, 3.3 * dt);

      const targetSpeed = game.started
        ? clamp(250 + game.wanted * 45, 235, 515)
        : 115;

      cop.speed = lerp(cop.speed, d > 55 ? targetSpeed : targetSpeed * .42, dt * .9);
      cop.pos.addScaledVector(forward(cop.yaw), cop.speed * dt);

      if (!onRoad(cop.pos.x, cop.pos.z)) {
        const p = nearestRoadPoint(cop.pos.x, cop.pos.z);
        cop.pos.lerp(p, .06);
        cop.speed *= Math.pow(.965, dt * 60);
      }

      for (const o of world.obstacles) {
        if (o.type === "box") {
          if (handleBoxCollision(cop, o, false)) break;
        } else if (o.type === "circle") {
          if (handleCircleCollision(cop, o, false)) break;
        }
      }

      if (game.started && distXZ(cop.pos, player.pos) < 48) {
        addDamage((8 + game.wanted * 1.7) * dt, player.pos);
      }

      cop.mesh.position.copy(cop.pos);
      cop.mesh.rotation.y = cop.yaw;

      if (cop.mesh.userData.lightbar) {
        cop.mesh.userData.lightbar.rotation.y = Math.sin(cop.siren * 6) * .2;
      }

      for (const w of cop.mesh.userData.wheels) {
        w.rotation.x += cop.speed * dt * .08;
      }
    }
  }

  function updateParticles(dt) {
    for (let i = world.particles.length - 1; i >= 0; i--) {
      const p = world.particles[i];
      p.life -= dt;
      p.vel.y -= 100 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.scale.multiplyScalar(.965);

      if (p.life <= 0) {
        scene.remove(p.mesh);
        world.particles.splice(i, 1);
      }
    }
  }

  function updateCamera(dt) {
    const f = forward(player.yaw);
    const side = new THREE.Vector3(Math.cos(player.yaw), 0, Math.sin(player.yaw));
    const speedFactor = clamp(Math.abs(player.speed) / 480, 0, 1);

    const desired = player.pos.clone()
      .addScaledVector(f, -135 - speedFactor * 70)
      .addScaledVector(side, -player.steer * 18)
      .add(new THREE.Vector3(0, 85 + speedFactor * 34, 0));

    camera.position.lerp(desired, 1 - Math.pow(.001, dt));

    if (game.shake > 0) {
      camera.position.x += rand(-game.shake, game.shake) * 18;
      camera.position.y += rand(-game.shake, game.shake) * 12;
      camera.position.z += rand(-game.shake, game.shake) * 18;
      game.shake *= Math.pow(.035, dt);
    }

    const look = player.pos.clone()
      .addScaledVector(f, 75)
      .add(new THREE.Vector3(0, 16, 0));

    camera.lookAt(look);
  }

  function currentZone() {
    if (player.pos.x < -420) return "City";
    if (player.pos.x > 470) return "Desert";
    return "Plains";
  }

  function updateUI() {
    ui.zone.textContent = currentZone();
    ui.speed.textContent = `${Math.round(Math.abs(player.speed) * .19)} mph`;
    ui.wanted.textContent = "★★★★★".slice(0, game.wanted) + "☆☆☆☆☆".slice(0, 5 - game.wanted);
    ui.damage.textContent = `${Math.round(player.damage)}%`;
    ui.nitro.textContent = `${Math.round(player.nitro)}%`;
    ui.score.textContent = Math.floor(game.score).toString();
    ui.time.textContent = formatTime(game.time);
    ui.flash.style.opacity = game.flash;
    game.flash = Math.max(0, game.flash - .045);
  }

  function drawMiniMap() {
    const rect = ui.minimap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(rect.width * dpr);

    if (ui.minimap.width !== w) {
      ui.minimap.width = w;
      ui.minimap.height = w;
    }

    const s = ui.minimap.width;
    const scaleX = s / MAP.width;
    const scaleZ = s / MAP.height;

    function tx(x) { return (x + MAP.halfW) * scaleX; }
    function tz(z) { return (z + MAP.halfH) * scaleZ; }

    miniCtx.clearRect(0, 0, s, s);

    // Regions
    miniCtx.fillStyle = "#20252d";
    miniCtx.fillRect(tx(-MAP.halfW), 0, (900) * scaleX, s);
    miniCtx.fillStyle = "#4d8b45";
    miniCtx.fillRect(tx(-400), 0, 800 * scaleX, s);
    miniCtx.fillStyle = "#c89d5d";
    miniCtx.fillRect(tx(400), 0, 900 * scaleX, s);

    // Roads
    miniCtx.fillStyle = "rgba(20,24,32,.95)";
    for (const r of world.roads) {
      miniCtx.fillRect(
        tx(r.x - r.w / 2),
        tz(r.z - r.d / 2),
        r.w * scaleX,
        r.d * scaleZ
      );
    }

    function dot(pos, color, rad) {
      miniCtx.fillStyle = color;
      miniCtx.beginPath();
      miniCtx.arc(tx(pos.x), tz(pos.z), rad * dpr, 0, Math.PI * 2);
      miniCtx.fill();
    }

    for (const cp of world.checkpoints) dot(cp.pos, "#3cff98", 4);
    for (const cop of world.cops) dot(cop.pos, "#ff3030", 3.2);
    for (const car of world.traffic) dot(car.pos, "rgba(255,255,255,.65)", 1.7);
    dot(player.pos, "#00c8ff", 5);

    miniCtx.strokeStyle = "rgba(255,255,255,.3)";
    miniCtx.lineWidth = 2 * dpr;
    miniCtx.strokeRect(0, 0, s, s);
  }

  function update(dt) {
    if (game.started && !game.over) {
      game.time += dt;
      game.score += dt * (18 + Math.abs(player.speed) * .06 + game.wanted * 8);

      if (game.time > 25) game.wanted = Math.max(game.wanted, 2);
      if (game.time > 60) game.wanted = Math.max(game.wanted, 3);
      if (game.time > 115) game.wanted = Math.max(game.wanted, 4);
    }

    if (!game.over) {
      updatePlayer(dt);
      updateTraffic(dt);
      updateCops(dt);
    } else {
      player.speed *= Math.pow(.92, dt * 60);
      player.pos.addScaledVector(forward(player.yaw), player.speed * dt);
      player.mesh.position.copy(player.pos);
    }

    updateParticles(dt);
    updateCamera(dt);
    updateUI();
    drawMiniMap();
  }

  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 1 / 30);
    update(dt);
    renderer.render(scene, camera);
  }

  function onResize() {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }

  window.addEventListener("resize", onResize);

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    keys[k] = true;

    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"].includes(k)) {
      startGame();
    }

    if (k === "r") resetGame();
  });

  window.addEventListener("keyup", (e) => {
    keys[e.key.toLowerCase()] = false;
  });

  canvas.addEventListener("pointerdown", () => {
    if (game.over) resetGame();
    else startGame();
  });

  function bindTouch(id, prop) {
    const el = document.getElementById(id);

    const on = (e) => {
      e.preventDefault();
      e.stopPropagation();
      touch[prop] = true;
      startGame();
    };

    const off = (e) => {
      e.preventDefault();
      e.stopPropagation();
      touch[prop] = false;
    };

    el.addEventListener("pointerdown", on);
    el.addEventListener("pointerup", off);
    el.addEventListener("pointercancel", off);
    el.addEventListener("pointerleave", off);
  }

  bindTouch("left", "left");
  bindTouch("right", "right");
  bindTouch("gas", "gas");
  bindTouch("brake", "brake");
  bindTouch("boost", "boost");

  try {
    buildWorld();
    resetGame();
    onResize();
    loop();
  } catch (err) {
    console.error(err);
    showError("Game crashed while loading:\n\n" + (err && err.stack ? err.stack : String(err)));
  }
})();
