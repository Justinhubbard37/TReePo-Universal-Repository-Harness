(() => {
"use strict";

const PALETTE = {
  black: [0, 0, 0, 1],
  graphite: [0.212, 0.208, 0.263, 1],       // #363543
  cloudySky: [0.349, 0.580, 0.843, 1],      // #5994d7
  surface: [0.122, 0.118, 0.165, 1],        // #1f1e2a
  depth: [0.290, 0.286, 0.345, 1],          // #4a4958
  light: [0.882, 0.961, 0.976, 1],          // #e1f5f9
  muted: [0.631, 0.631, 0.667, 1],          // #a1a1aa
  valid: [0.125, 0.741, 0.565, 1],          // #20bd90
  danger: [0.980, 0.196, 0.020, 1],         // #fa3205
};

const phaseOrder = ['goal', 'route', 'verify', 'authority', 'execute'];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function clamp(value, min = 0, max = 1) { return Math.min(max, Math.max(min, value)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function easeOutQuint(t) { return 1 - Math.pow(1 - clamp(t), 5); }
function wait(ms) { return new Promise(resolve => window.setTimeout(resolve, reducedMotion ? 0 : ms)); }
function q(selector) { const el = document.querySelector(selector); if (!el) throw new Error(`Missing element: ${selector}`); return el; }
function qa(selector) { return Array.from(document.querySelectorAll(selector)); }

class Rng {
  constructor(seed) { this.state = seed >>> 0; }
  next() { this.state = (1664525 * this.state + 1013904223) >>> 0; return this.state / 4294967296; }
  range(min, max) { return min + (max - min) * this.next(); }
}

function mat4Perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, (2 * far * near) * nf, 0,
  ]);
}

function mat4View(rotY, rotX, cameraZ, driftX, driftY) {
  const cy = Math.cos(rotY), sy = Math.sin(rotY), cx = Math.cos(rotX), sx = Math.sin(rotX);
  return new Float32Array([
    cy, sx * sy, -cx * sy, 0,
    0, cx, sx, 0,
    sy, -sx * cy, cx * cy, 0,
    driftX, driftY, -cameraZ, 1,
  ]);
}

class SystemRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.nodeProgram = null;
    this.lineProgram = null;
    this.nodeBuffer = null;
    this.colorBuffer = null;
    this.sizeBuffer = null;
    this.lineBuffer = null;
    this.lineColorBuffer = null;
    this.nodeCount = 120;
    this.edges = [];
    this.presenceEdges = [];
    this.transitionStart = performance.now();
    this.transitionDuration = reducedMotion ? 1 : 900;
    this.activeUntil = 0;
    this.frame = 0;
    this.blackout = 0;
    this.targetBlackout = 0;
    this.simulationPhase = 'goal';
    this.lastAct = 'presence';
    this.fallback2d = null;
    this.pointerX = 0;
    this.pointerY = 0;

    this.makeEdges();
    this.makePresenceEdges();

    const target = this.makeScene('presence');
    if (reducedMotion) {
      this.current = this.cloneScene(target);
      this.from = this.cloneScene(target);
    } else {
      const collapsed = this.collapsePresence(this.cloneScene(target));
      this.current = collapsed;
      this.from = this.cloneScene(collapsed);
    }
    this.target = target;
    this.transitionStart = performance.now() + 120;
    this.transitionDuration = reducedMotion ? 1 : 2400;

    if (!this.gl) this.fallback2d = canvas.getContext('2d');
    else this.initGl();

    this.resize();
    this.wake(2800);
  }

  cloneScene(s) {
    return {
      positions: new Float32Array(s.positions),
      colors: new Float32Array(s.colors),
      sizes: new Float32Array(s.sizes),
      lineColors: new Float32Array(s.lineColors),
      camera: [...s.camera],
      exposure: s.exposure,
    };
  }

  collapsePresence(scene) {
    const centerX = window.innerWidth < 700 ? 0.45 : 2.65;
    for (let i = 0; i < this.nodeCount; i++) {
      const p = i * 3;
      const c = i * 4;
      if (i < 47) {
        scene.positions[p] = centerX + (scene.positions[p] - centerX) * 0.04;
        scene.positions[p + 1] = -3.15 + ((i % 7) * 0.055);
        scene.positions[p + 2] *= 0.08;
        scene.colors[c + 3] *= 0.02;
        scene.lineColors[c + 3] *= 0.01;
        scene.sizes[i] *= 0.65;
      } else {
        scene.colors[c + 3] = 0;
        scene.lineColors[c + 3] = 0;
      }
    }
    scene.camera = [0.02, -0.03, 20.2, window.innerWidth < 700 ? 0 : -0.25, -0.35];
    scene.exposure = 0.58;
    return scene;
  }

  compile(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Shader compile failed');
    return shader;
  }

  program(vs, fs) {
    const gl = this.gl;
    const p = gl.createProgram();
    gl.attachShader(p, this.compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, this.compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'Program link failed');
    return p;
  }

  initGl() {
    const gl = this.gl;
    const nodeVs = `#version 300 es
      precision highp float;
      in vec3 aPosition; in vec4 aColor; in float aSize;
      uniform mat4 uProjection; uniform mat4 uView; uniform float uExposure;
      out vec4 vColor;
      void main(){ vec4 p=uProjection*uView*vec4(aPosition,1.0); gl_Position=p; gl_PointSize=aSize*(1.0+2.2/max(2.0,-p.z)); vColor=vec4(aColor.rgb,aColor.a*uExposure); }
    `;
    const nodeFs = `#version 300 es
      precision highp float; in vec4 vColor; out vec4 outColor;
      void main(){ vec2 p=gl_PointCoord*2.0-1.0; float d=dot(p,p); if(d>1.0) discard; float core=smoothstep(1.0,.0,d); float halo=smoothstep(1.0,.05,d); outColor=vec4(vColor.rgb, vColor.a*(.20*halo+.80*core)); }
    `;
    const lineVs = `#version 300 es
      precision highp float; in vec3 aPosition; in vec4 aColor; uniform mat4 uProjection; uniform mat4 uView; uniform float uExposure; out vec4 vColor;
      void main(){ gl_Position=uProjection*uView*vec4(aPosition,1.0); vColor=vec4(aColor.rgb,aColor.a*uExposure); }
    `;
    const lineFs = `#version 300 es
      precision highp float; in vec4 vColor; out vec4 outColor; void main(){ outColor=vColor; }
    `;
    this.nodeProgram = this.program(nodeVs, nodeFs);
    this.lineProgram = this.program(lineVs, lineFs);
    this.nodeBuffer = gl.createBuffer();
    this.colorBuffer = gl.createBuffer();
    this.sizeBuffer = gl.createBuffer();
    this.lineBuffer = gl.createBuffer();
    this.lineColorBuffer = gl.createBuffer();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.disable(gl.DEPTH_TEST);
  }

  makeEdges() {
    const rng = new Rng(20260918);
    for (let i = 1; i < this.nodeCount; i++) {
      const parent = Math.max(0, i - 1 - Math.floor(rng.next() * Math.min(i, 9)));
      this.edges.push([parent, i]);
      if (i > 12 && rng.next() > .72) this.edges.push([Math.floor(rng.next() * i), i]);
    }
  }

  makePresenceEdges() {
    // Central spine / trunk.
    for (let i = 0; i < 8; i++) this.presenceEdges.push([i, i + 1]);

    // Lower branches.
    this.presenceEdges.push([2, 9], [9, 10], [10, 11]);
    this.presenceEdges.push([2, 12], [12, 13], [13, 14]);

    // Mid branches.
    this.presenceEdges.push([4, 15], [15, 16], [16, 17]);
    this.presenceEdges.push([4, 18], [18, 19], [19, 20]);

    // Upper branches.
    this.presenceEdges.push([6, 21], [21, 22], [22, 23]);
    this.presenceEdges.push([6, 24], [24, 25], [25, 26]);
    this.presenceEdges.push([7, 27], [27, 28]);
    this.presenceEdges.push([7, 29], [29, 30]);

    // Root flare.
    this.presenceEdges.push([0, 31], [31, 32], [0, 33], [33, 34]);

    // Zipper teeth: restrained, structural, not literal chrome hardware.
    for (let i = 35; i < 47; i++) {
      const spine = Math.min(4, Math.max(1, 1 + Math.floor((i - 35) / 3)));
      this.presenceEdges.push([spine, i]);
    }
  }

  makeScene(act) {
    const rng = new Rng(5519);
    const positions = new Float32Array(this.nodeCount * 3);
    const colors = new Float32Array(this.nodeCount * 4);
    const sizes = new Float32Array(this.nodeCount);
    const lineColors = new Float32Array(this.nodeCount * 4);
    let camera = [.15, -.08, 15, 0, 0];
    let exposure = 1;

    for (let i = 0; i < this.nodeCount; i++) {
      const p = [0, 0, 0];
      let color = [...PALETTE.muted];
      let alpha = .18;
      let size = 2.3;

      if (act === 'presence') {
        const x = window.innerWidth < 700 ? 0.45 : 2.65;
        const mobileScale = window.innerWidth < 700 ? .82 : 1;
        const brand = [
          [x,-3.30, 0.15],[x,-2.55, 0.05],[x,-1.78,-0.05],[x,-1.00, 0.10],[x,-0.20,0.00],
          [x, 0.62, 0.08],[x, 1.46,-0.08],[x, 2.34,0.10],[x, 3.25,0.00],
          [x-.68,-1.52,.18],[x-1.35,-1.02,.36],[x-2.05,-.78,.52],
          [x+.68,-1.52,-.12],[x+1.35,-1.02,-.32],[x+2.05,-.78,-.50],
          [x-.62,-.10,-.18],[x-1.18,.58,-.34],[x-1.72,1.12,-.46],
          [x+.62,-.10,.16],[x+1.18,.58,.34],[x+1.72,1.12,.46],
          [x-.52,1.30,.14],[x-.98,2.04,.30],[x-1.30,2.72,.48],
          [x+.52,1.30,-.12],[x+.98,2.04,-.30],[x+1.30,2.72,-.48],
          [x-.42,2.25,-.18],[x-.78,3.18,-.20],
          [x+.42,2.25,.18],[x+.78,3.18,.20],
          [x-.55,-3.10,.18],[x-1.55,-3.52,.34],[x+.55,-3.10,-.18],[x+1.55,-3.52,-.34],
          [x-.15,-2.60,.08],[x+.15,-2.38,-.06],[x-.15,-2.16,.06],[x+.15,-1.94,-.08],
          [x-.15,-1.72,.08],[x+.15,-1.50,-.06],[x-.15,-1.28,.06],[x+.15,-1.06,-.08],
          [x-.15,-.84,.08],[x+.15,-.62,-.06],[x-.15,-.40,.06],[x+.15,-.18,-.08],
        ];

        if (i < brand.length) {
          p[0] = x + (brand[i][0] - x) * mobileScale;
          p[1] = brand[i][1] * mobileScale;
          p[2] = brand[i][2];

          const isSpine = i <= 8;
          const isTip = [11,14,17,20,23,26,28,30].includes(i);
          const isRoot = i >= 31 && i <= 34;
          const isTooth = i >= 35 && i <= 46;

          if (isSpine) {
            color = [...PALETTE.valid];
            alpha = i === 8 ? .58 : .34;
            size = i === 8 ? 6.0 : 3.0;
          } else if (isTooth) {
            color = [...PALETTE.light];
            alpha = .28;
            size = 2.15;
          } else if (isRoot) {
            color = [...PALETTE.depth];
            alpha = .24;
            size = 2.5;
          } else {
            const branchTone = i % 3 === 0 ? PALETTE.light : i % 3 === 1 ? PALETTE.valid : PALETTE.depth;
            color = [...branchTone];
            alpha = isTip ? .48 : .24;
            size = isTip ? 5.8 : 2.8;
          }
        } else {
          const a = (i - 47) * .83;
          const r = 4.2 + ((i - 47) % 9) * .34;
          p[0] = x + Math.cos(a) * r;
          p[1] = Math.sin(a * .72) * r * .42;
          p[2] = rng.range(-5, 4);
          color = i % 11 === 0 ? [...PALETTE.cloudySky] : i % 7 === 0 ? [...PALETTE.graphite] : [...PALETTE.depth];
          alpha = i % 11 === 0 ? .045 : .025;
          size = i % 13 === 0 ? 2.8 : 1.5;
        }

        camera = window.innerWidth < 700
          ? [.07, -.04, 17.9, -.15, -.16]
          : [.11, -.06, 17.5, -.82, -.20];
        exposure = .78;
      }
      else if (act === 'journey') {
        if (i < 5) {
          p[0] = (i - 2) * 1.55; p[1] = 0; p[2] = 0; alpha = .78; size = 6.3; color = [...PALETTE.light];
        } else {
          const a = i * .72; const r = 2 + (i % 8) * .34;
          p[0] = Math.cos(a) * r; p[1] = Math.sin(a) * r * .42; p[2] = rng.range(-4, 4); alpha = .07; size = 1.7;
        }
        camera = [.03, -.05, 14.4, 2.6, -.2];
      }
      else if (act === 'instability') {
        const cluster = i % 4; const ox = [-4.4, 4.2, -2.4, 3.1][cluster]; const oy = [1.9, 2.1, -2.2, -1.8][cluster];
        p[0] = ox + rng.range(-2.2, 2.2); p[1] = oy + rng.range(-1.4, 1.4); p[2] = rng.range(-5.5, 5.5);
        alpha = .22 + rng.next() * .18; size = 1.8 + rng.next() * 2.0;
        if (i % 17 === 0) { color = [...PALETTE.danger]; alpha = .55; }
        camera = [-.25, .13, 18, 1.0, 0];
      }
      else if (act === 'structure' || act === 'failure' || act === 'recovery') {
        const level = Math.floor(Math.log2(i + 1)); const start = Math.pow(2, level) - 1; const idx = i - start; const count = Math.pow(2, level);
        p[0] = (idx - (count - 1) / 2) * (7.2 / Math.max(1, count - 1));
        p[1] = 3.9 - level * 1.15; p[2] = (idx % 3 - 1) * .65 + Math.sin(i * .81) * .32;
        alpha = .26; size = 2.1;
        if (i === 0 || i === 1 || i === 3 || i === 7 || i === 15) { color = [...PALETTE.valid]; alpha = .95; size = 6.0; }
        if (act === 'failure' && i >= 86 && i <= 97) { p[0] += 2.4 + (i - 86) * .18; p[2] += 2.2; color = [...PALETTE.danger]; alpha = .86; size = 4.8; }
        camera = act === 'failure' ? [.46, -.07, 17.4, -1.2, -.2] : [-.34, -.12, 16.3, -1.6, .1];
      }
      else if (act === 'resolution') {
        const golden = Math.PI * (3 - Math.sqrt(5)); const y = 1 - (i / (this.nodeCount - 1)) * 2; const radius = Math.sqrt(1 - y * y) * 3.6; const theta = golden * i;
        p[0] = Math.cos(theta) * radius; p[1] = y * 4.2; p[2] = Math.sin(theta) * radius;
        alpha = .20; size = 2.0;
        if (i % 13 === 0) { color = [...PALETTE.valid]; alpha = .8; size = 4.8; }
        camera = [.65, -.13, 17.5, 0, 0];
      }

      positions.set(p, i * 3);
      colors.set([color[0], color[1], color[2], alpha], i * 4);
      const lineAlpha = act === 'presence' ? Math.min(alpha * .34, .14) : Math.min(alpha * .32, .2);
      lineColors.set([color[0], color[1], color[2], lineAlpha], i * 4);
      sizes[i] = size;
    }

    return { positions, colors, sizes, lineColors, camera, exposure };
  }

  applyJourneyPhase(target) {
    if (this.lastAct !== 'journey') return;
    const phaseIndex = phaseOrder.indexOf(this.simulationPhase);
    for (let i = 0; i < 5; i++) {
      const o = i * 4;
      const isDone = i < phaseIndex, isCurrent = i === phaseIndex;
      const color = isDone ? PALETTE.valid : isCurrent && this.simulationPhase === 'authority' ? PALETTE.danger : isCurrent ? PALETTE.light : PALETTE.muted;
      target.colors.set([color[0], color[1], color[2], isDone || isCurrent ? .96 : .34], o);
      target.lineColors.set([color[0], color[1], color[2], isDone ? .34 : .08], o);
      target.sizes[i] = isCurrent ? 8.8 : isDone ? 6.2 : 4.2;
      if (isCurrent) target.positions[i * 3 + 2] = 1.4;
    }
  }

  setAct(act) {
    if (act === this.lastAct) return;
    this.lastAct = act;
    this.from = this.cloneScene(this.current);
    this.target = this.makeScene(act);
    this.applyJourneyPhase(this.target);
    this.transitionStart = performance.now();
    this.transitionDuration = reducedMotion ? 1 : 1050;
    this.wake(1400);
  }

  setSimulationPhase(phase) {
    this.simulationPhase = phase;
    if (this.lastAct !== 'journey') return;
    this.from = this.cloneScene(this.current);
    this.target = this.makeScene('journey');
    this.applyJourneyPhase(this.target);
    this.transitionStart = performance.now();
    this.transitionDuration = reducedMotion ? 1 : 460;
    this.wake(700);
  }

  setBlackout(on) { this.targetBlackout = on ? 1 : 0; this.wake(1600); }

  setPointer(nx, ny) {
    if (reducedMotion || this.lastAct !== 'presence') return;
    this.pointerX = clamp(nx, -1, 1);
    this.pointerY = clamp(ny, -1, 1);
    this.wake(100);
  }

  wake(ms = 450) {
    this.activeUntil = Math.max(this.activeUntil, performance.now() + ms);
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  }

  tick = (now) => {
    this.frame = 0;
    if (document.hidden) return;
    const t = easeOutQuint((now - this.transitionStart) / this.transitionDuration);
    const n = this.current.positions.length;
    for (let i = 0; i < n; i++) this.current.positions[i] = lerp(this.from.positions[i], this.target.positions[i], t);
    for (let i = 0; i < this.current.colors.length; i++) this.current.colors[i] = lerp(this.from.colors[i], this.target.colors[i], t);
    for (let i = 0; i < this.current.sizes.length; i++) this.current.sizes[i] = lerp(this.from.sizes[i], this.target.sizes[i], t);
    for (let i = 0; i < this.current.lineColors.length; i++) this.current.lineColors[i] = lerp(this.from.lineColors[i], this.target.lineColors[i], t);
    for (let i = 0; i < 5; i++) this.current.camera[i] = lerp(this.from.camera[i], this.target.camera[i], t);
    this.current.exposure = lerp(this.from.exposure, this.target.exposure, t);
    this.blackout = lerp(this.blackout, this.targetBlackout, reducedMotion ? 1 : .12);
    this.render();
    if (now < this.activeUntil || t < .999 || Math.abs(this.blackout - this.targetBlackout) > .01) this.frame = requestAnimationFrame(this.tick);
  };

  makeLineData() {
    const activeEdges = this.lastAct === 'presence' ? this.presenceEdges : this.edges;
    const pos = new Float32Array(activeEdges.length * 6), col = new Float32Array(activeEdges.length * 8);
    let pi = 0, ci = 0;
    for (const [a, b] of activeEdges) {
      pos.set(this.current.positions.subarray(a * 3, a * 3 + 3), pi); pi += 3;
      pos.set(this.current.positions.subarray(b * 3, b * 3 + 3), pi); pi += 3;
      col.set(this.current.lineColors.subarray(a * 4, a * 4 + 4), ci); ci += 4;
      col.set(this.current.lineColors.subarray(b * 4, b * 4 + 4), ci); ci += 4;
    }
    return [pos, col, activeEdges.length];
  }

  render() {
    const exposure = this.current.exposure * (1 - this.blackout * .96);
    if (!this.gl) { this.renderFallback(exposure); return; }
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const projection = mat4Perspective(Math.PI / 3, this.canvas.width / this.canvas.height, .1, 60);
    const c = this.current.camera;
    const presence = this.lastAct === 'presence';
    const view = mat4View(
      c[0] + (presence ? this.pointerX * .035 : 0),
      c[1] + (presence ? this.pointerY * .025 : 0),
      c[2],
      c[3] + (presence ? this.pointerX * .12 : 0),
      c[4] - (presence ? this.pointerY * .08 : 0)
    );
    const [linePositions, lineColors, edgeCount] = this.makeLineData();

    gl.useProgram(this.lineProgram);
    this.bindAttribute(this.lineProgram, 'aPosition', this.lineBuffer, linePositions, 3);
    this.bindAttribute(this.lineProgram, 'aColor', this.lineColorBuffer, lineColors, 4);
    this.uniformMatrix(this.lineProgram, 'uProjection', projection);
    this.uniformMatrix(this.lineProgram, 'uView', view);
    gl.uniform1f(gl.getUniformLocation(this.lineProgram, 'uExposure'), exposure);
    gl.drawArrays(gl.LINES, 0, edgeCount * 2);

    gl.useProgram(this.nodeProgram);
    this.bindAttribute(this.nodeProgram, 'aPosition', this.nodeBuffer, this.current.positions, 3);
    this.bindAttribute(this.nodeProgram, 'aColor', this.colorBuffer, this.current.colors, 4);
    this.bindAttribute(this.nodeProgram, 'aSize', this.sizeBuffer, this.current.sizes, 1);
    this.uniformMatrix(this.nodeProgram, 'uProjection', projection);
    this.uniformMatrix(this.nodeProgram, 'uView', view);
    gl.uniform1f(gl.getUniformLocation(this.nodeProgram, 'uExposure'), exposure);
    gl.drawArrays(gl.POINTS, 0, this.nodeCount);
  }

  bindAttribute(program, name, buffer, data, size) {
    const gl = this.gl, loc = gl.getAttribLocation(program, name);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }

  uniformMatrix(program, name, data) {
    this.gl.uniformMatrix4fv(this.gl.getUniformLocation(program, name), false, data);
  }

  renderFallback(exposure) {
    const ctx = this.fallback2d;
    if (!ctx) return;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const scale = Math.min(this.canvas.width, this.canvas.height) / 12;
    ctx.lineWidth = 1;
    const activeEdges = this.lastAct === 'presence' ? this.presenceEdges : this.edges;
    for (const [a, b] of activeEdges) {
      const ax = this.canvas.width / 2 + this.current.positions[a * 3] * scale, ay = this.canvas.height / 2 - this.current.positions[a * 3 + 1] * scale;
      const bx = this.canvas.width / 2 + this.current.positions[b * 3] * scale, by = this.canvas.height / 2 - this.current.positions[b * 3 + 1] * scale;
      ctx.strokeStyle = `rgba(225,245,249,${.05 * exposure})`;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    for (let i = 0; i < this.nodeCount; i++) {
      const x = this.canvas.width / 2 + this.current.positions[i * 3] * scale, y = this.canvas.height / 2 - this.current.positions[i * 3 + 1] * scale;
      const o = i * 4, c = this.current.colors;
      const r = Math.round(c[o] * 255), g = Math.round(c[o + 1] * 255), b = Math.round(c[o + 2] * 255);
      ctx.fillStyle = `rgba(${r},${g},${b},${c[o + 3] * exposure})`;
      ctx.beginPath(); ctx.arc(x, y, Math.max(1, this.current.sizes[i] * .45), 0, Math.PI * 2); ctx.fill();
    }
  }

  resize() {
    const dpr = reducedMotion ? 1 : Math.min(window.devicePixelRatio || 1, window.innerWidth < 700 ? 1.2 : 1.5);
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    this.wake(200);
  }
}

const renderer = new SystemRenderer(q('#system-canvas'));
window.addEventListener('resize', () => renderer.resize(), { passive: true });
window.addEventListener('pointermove', event => {
  const nx = (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
  const ny = (event.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
  renderer.setPointer(nx, ny);
}, { passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) renderer.wake(300); });

const reveals = qa('.reveal');
const revealObserver = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) entry.target.classList.add('visible');
}, { threshold: .12 });
reveals.forEach(el => revealObserver.observe(el));

const acts = qa('[data-act]');
let activeAct = 'presence';
let recoveryRun = false;
let recoveryTimers = [];

function triggerRecovery() {
  if (recoveryRun) return;
  recoveryRun = true;
  const section = q('#recovery');
  const run = (fn, ms) => { recoveryTimers.push(window.setTimeout(fn, reducedMotion ? 0 : ms)); };
  renderer.setBlackout(true);
  run(() => section.classList.add('blackout'), 380);
  run(() => { renderer.setBlackout(false); section.classList.add('reconstructed'); }, 1450);
}

const actObserver = new IntersectionObserver(entries => {
  const visible = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (!visible) return;
  const next = visible.target.dataset.act;
  if (next && next !== activeAct) { activeAct = next; renderer.setAct(next); }
  if (next === 'recovery' && visible.intersectionRatio > .48) triggerRecovery();
}, { threshold: [0.24, .48, .66] });
acts.forEach(el => actObserver.observe(el));
window.addEventListener('scroll', () => renderer.wake(260), { passive: true });

const goalButtons = qa('.goal-option');
const authorizeButton = q('#authorize-button');
const resetButton = q('#reset-button');
const selectedGoalLabel = q('#selected-goal-label');
const authorityTitle = q('#authority-title');
const authorityStatus = q('#authority-status');
const authoritySupport = q('#authority-support');
const executeTitle = q('#execute-title');
const workflowActive = q('#workflow-active');
const focusObject = q('#focus-object');
const focusLabel = q('#focus-label');

let phase = 'goal';
let selectedGoal = null;
let interactionToken = 0;
const goalLabels = {
  continue: 'CONTINUE FROM LAST ACCEPTED CHECKPOINT',
  inspect: 'INSPECT PROJECT BEFORE CHANGES',
  implement: 'BEGIN GOVERNED IMPLEMENTATION WORKFLOW',
};

function setPhase(next) {
  phase = next;
  renderer.setSimulationPhase(next);
  qa('.sim-step').forEach(el => { const is = el.dataset.step === next; el.hidden = !is; el.classList.toggle('active', is); });
  qa('.phase-rail span').forEach(el => {
    const p = el.dataset.phase;
    const pi = phaseOrder.indexOf(p), ni = phaseOrder.indexOf(next);
    el.classList.toggle('active', pi === ni);
    el.classList.toggle('done', pi < ni);
  });
  focusObject.className = `focus-object ${next}`;
  focusLabel.textContent = next === 'goal' ? 'AWAITING GOAL' : next.toUpperCase();
}

async function runGoal(goal) {
  const token = ++interactionToken;
  selectedGoal = goal;
  goalButtons.forEach(button => { button.disabled = true; button.setAttribute('aria-pressed', String(button.dataset.goal === goal)); });
  selectedGoalLabel.textContent = goalLabels[goal];
  setPhase('route');
  await wait(330); if (token !== interactionToken) return;
  setPhase('verify');
  const checks = qa('[data-check]');
  checks.forEach(el => { el.classList.remove('pass'); const b = el.querySelector('b'); if (b) b.textContent = '—'; });
  for (const check of checks) {
    await wait(170); if (token !== interactionToken) return;
    check.classList.add('pass'); const b = check.querySelector('b'); if (b) b.textContent = '✓'; renderer.wake(260);
  }
  await wait(220); if (token !== interactionToken) return;
  setPhase('authority');
  const readOnly = goal === 'inspect';
  authorizeButton.hidden = readOnly;
  authorityTitle.textContent = readOnly ? 'READ-ONLY OPERATION' : 'GOVERNED STATE MUTATION DETECTED';
  authorityStatus.textContent = readOnly ? 'AUTHORIZATION NOT REQUIRED' : 'AUTHORIZATION REQUIRED';
  authorityStatus.style.color = readOnly ? 'var(--valid)' : 'var(--danger)';
  authoritySupport.textContent = readOnly ? 'The verified capability remains non-authoritative and non-consequential.' : 'Technical applicability does not manufacture permission.';
  if (readOnly) { await wait(650); if (token !== interactionToken) return; completeExecution(false); }
}

function completeExecution(authorized) {
  setPhase('execute');
  const readOnly = selectedGoal === 'inspect';
  executeTitle.textContent = authorized ? 'AUTHORIZED' : 'VERIFIED';
  workflowActive.textContent = readOnly ? 'READ-ONLY WORKFLOW ACTIVE' : 'WORKFLOW ACTIVE';
}

function resetSimulation() {
  interactionToken++;
  selectedGoal = null;
  goalButtons.forEach(button => { button.disabled = false; button.removeAttribute('aria-pressed'); });
  authorizeButton.hidden = false;
  authorityStatus.style.removeProperty('color');
  setPhase('goal');
  window.setTimeout(() => goalButtons[0]?.focus(), reducedMotion ? 0 : 80);
}

goalButtons.forEach(button => button.addEventListener('click', () => runGoal(button.dataset.goal)));
authorizeButton.addEventListener('click', async () => {
  if (phase !== 'authority' || selectedGoal === 'inspect') return;
  authorizeButton.disabled = true;
  authorizeButton.textContent = 'AUTHORITY ACCEPTED';
  authorityStatus.textContent = 'AUTHORIZED';
  authorityStatus.style.color = 'var(--valid)';
  renderer.wake(500);
  await wait(420);
  completeExecution(true);
  authorizeButton.disabled = false;
  authorizeButton.textContent = 'AUTHORIZE';
});
resetButton.addEventListener('click', resetSimulation);

q('.goal-list').addEventListener('keydown', event => {
  if (!(event instanceof KeyboardEvent) || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
  const current = goalButtons.indexOf(document.activeElement);
  if (current < 0) return;
  event.preventDefault();
  const delta = event.key === 'ArrowDown' ? 1 : -1;
  goalButtons[(current + delta + goalButtons.length) % goalButtons.length].focus();
});

setPhase('goal');
renderer.setAct('presence');
})();
