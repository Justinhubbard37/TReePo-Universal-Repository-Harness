(() => {
"use strict";
"use strict";
const PALETTE = {
    light: [0.882, 0.961, 0.976, 1],
    muted: [0.631, 0.631, 0.667, 1],
    valid: [0.125, 0.741, 0.565, 1],
    danger: [0.98, 0.196, 0.02, 1],
    depth: [0.29, 0.286, 0.345, 1],
};
const actOrder = ['presence', 'journey', 'instability', 'structure', 'failure', 'recovery', 'resolution'];
const phaseOrder = ['goal', 'route', 'verify', 'authority', 'execute'];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function clamp(value, min = 0, max = 1) { return Math.min(max, Math.max(min, value)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function easeOutQuint(t) { return 1 - Math.pow(1 - clamp(t), 5); }
function wait(ms) { return new Promise(resolve => window.setTimeout(resolve, reducedMotion ? 0 : ms)); }
function q(selector) { const el = document.querySelector(selector); if (!el)
    throw new Error(`Missing element: ${selector}`); return el; }
function qa(selector) { return Array.from(document.querySelectorAll(selector)); }
class Rng {
    state;
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
    canvas;
    gl;
    nodeProgram = null;
    lineProgram = null;
    nodeBuffer = null;
    colorBuffer = null;
    sizeBuffer = null;
    lineBuffer = null;
    lineColorBuffer = null;
    nodeCount = 120;
    edges = [];
    current;
    from;
    target;
    transitionStart = performance.now();
    transitionDuration = reducedMotion ? 1 : 900;
    activeUntil = 0;
    frame = 0;
    blackout = 0;
    targetBlackout = 0;
    simulationPhase = 'goal';
    lastAct = 'presence';
    fallback2d = null;
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
        const base = this.makeScene('presence');
        this.current = base;
        this.from = this.cloneScene(base);
        this.target = this.cloneScene(base);
        this.makeEdges();
        if (!this.gl) {
            this.fallback2d = canvas.getContext('2d');
        }
        else {
            this.initGl();
        }
        this.resize();
        this.wake(1200);
    }
    cloneScene(s) {
        return {
            positions: new Float32Array(s.positions), colors: new Float32Array(s.colors), sizes: new Float32Array(s.sizes),
            lineColors: new Float32Array(s.lineColors), camera: [...s.camera], exposure: s.exposure,
        };
    }
    compile(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
            throw new Error(gl.getShaderInfoLog(shader) || 'Shader compile failed');
        return shader;
    }
    program(vs, fs) {
        const gl = this.gl;
        const p = gl.createProgram();
        gl.attachShader(p, this.compile(gl.VERTEX_SHADER, vs));
        gl.attachShader(p, this.compile(gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS))
            throw new Error(gl.getProgramInfoLog(p) || 'Program link failed');
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
      void main(){ vec2 p=gl_PointCoord*2.0-1.0; float d=dot(p,p); if(d>1.0) discard; float core=smoothstep(1.0,.0,d); float halo=smoothstep(1.0,.05,d); outColor=vec4(vColor.rgb, vColor.a*(.28*halo+.72*core)); }
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
            if (i > 12 && rng.next() > .72)
                this.edges.push([Math.floor(rng.next() * i), i]);
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
                const a = i * .49;
                const r = 1.2 + (i % 13) * .18;
                p[0] = Math.cos(a) * r * .95;
                p[1] = Math.sin(a * .74) * r * .42;
                p[2] = (i - 60) * .075;
                alpha = i < 34 ? .28 : .045;
                size = i % 11 === 0 ? 4.6 : 2.0;
                if (i === 0) {
                    color = [...PALETTE.valid];
                    alpha = .85;
                    size = 7;
                }
                camera = [.35, -.08, 16.5, 1.8, -.4];
            }
            else if (act === 'journey') {
                if (i < 5) {
                    p[0] = (i - 2) * 1.55;
                    p[1] = 0;
                    p[2] = 0;
                    alpha = .78;
                    size = 6.3;
                    color = [...PALETTE.light];
                }
                else {
                    const a = i * .72;
                    const r = 2 + (i % 8) * .34;
                    p[0] = Math.cos(a) * r;
                    p[1] = Math.sin(a) * r * .42;
                    p[2] = rng.range(-4, 4);
                    alpha = .07;
                    size = 1.7;
                }
                camera = [.03, -.05, 14.4, 2.6, -.2];
            }
            else if (act === 'instability') {
                const cluster = i % 4;
                const ox = [-4.4, 4.2, -2.4, 3.1][cluster];
                const oy = [1.9, 2.1, -2.2, -1.8][cluster];
                p[0] = ox + rng.range(-2.2, 2.2);
                p[1] = oy + rng.range(-1.4, 1.4);
                p[2] = rng.range(-5.5, 5.5);
                alpha = .22 + rng.next() * .18;
                size = 1.8 + rng.next() * 2.0;
                if (i % 17 === 0) {
                    color = [...PALETTE.danger];
                    alpha = .55;
                }
                camera = [-.25, .13, 18, 1.0, 0];
            }
            else if (act === 'structure' || act === 'failure' || act === 'recovery') {
                const level = Math.floor(Math.log2(i + 1));
                const start = Math.pow(2, level) - 1;
                const idx = i - start;
                const count = Math.pow(2, level);
                p[0] = (idx - (count - 1) / 2) * (7.2 / Math.max(1, count - 1));
                p[1] = 3.9 - level * 1.15;
                p[2] = (idx % 3 - 1) * .65 + Math.sin(i * .81) * .32;
                alpha = .26;
                size = 2.1;
                if (i === 0 || i === 1 || i === 3 || i === 7 || i === 15) {
                    color = [...PALETTE.valid];
                    alpha = .95;
                    size = 6.0;
                }
                if (act === 'failure' && i >= 86 && i <= 97) {
                    p[0] += 2.4 + (i - 86) * .18;
                    p[2] += 2.2;
                    color = [...PALETTE.danger];
                    alpha = .86;
                    size = 4.8;
                }
                camera = act === 'failure' ? [.46, -.07, 17.4, -1.2, -.2] : [-.34, -.12, 16.3, -1.6, .1];
            }
            else if (act === 'resolution') {
                const golden = Math.PI * (3 - Math.sqrt(5));
                const y = 1 - (i / (this.nodeCount - 1)) * 2;
                const radius = Math.sqrt(1 - y * y) * 3.6;
                const theta = golden * i;
                p[0] = Math.cos(theta) * radius;
                p[1] = y * 4.2;
                p[2] = Math.sin(theta) * radius;
                alpha = .20;
                size = 2.0;
                if (i % 13 === 0) {
                    color = [...PALETTE.valid];
                    alpha = .8;
                    size = 4.8;
                }
                camera = [.65, -.13, 17.5, 0, 0];
            }
            positions.set(p, i * 3);
            colors.set([color[0], color[1], color[2], alpha], i * 4);
            lineColors.set([color[0], color[1], color[2], Math.min(alpha * .32, .2)], i * 4);
            sizes[i] = size;
        }
        return { positions, colors, sizes, lineColors, camera, exposure };
    }
    applyJourneyPhase(target) {
        if (this.lastAct !== 'journey')
            return;
        const phaseIndex = phaseOrder.indexOf(this.simulationPhase);
        for (let i = 0; i < 5; i++) {
            const o = i * 4;
            const isDone = i < phaseIndex, isCurrent = i === phaseIndex;
            const color = isDone ? PALETTE.valid : isCurrent && this.simulationPhase === 'authority' ? PALETTE.danger : isCurrent ? PALETTE.light : PALETTE.muted;
            target.colors.set([color[0], color[1], color[2], isDone || isCurrent ? .96 : .34], o);
            target.lineColors.set([color[0], color[1], color[2], isDone ? .34 : .08], o);
            target.sizes[i] = isCurrent ? 8.8 : isDone ? 6.2 : 4.2;
            if (isCurrent)
                target.positions[i * 3 + 2] = 1.4;
        }
    }
    setAct(act) {
        if (act === this.lastAct)
            return;
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
        if (this.lastAct !== 'journey')
            return;
        this.from = this.cloneScene(this.current);
        this.target = this.makeScene('journey');
        this.applyJourneyPhase(this.target);
        this.transitionStart = performance.now();
        this.transitionDuration = reducedMotion ? 1 : 460;
        this.wake(700);
    }
    setBlackout(on) { this.targetBlackout = on ? 1 : 0; this.wake(1600); }
    wake(ms = 450) {
        this.activeUntil = Math.max(this.activeUntil, performance.now() + ms);
        if (!this.frame)
            this.frame = requestAnimationFrame(this.tick);
    }
    tick = (now) => {
        this.frame = 0;
        if (document.hidden)
            return;
        const t = easeOutQuint((now - this.transitionStart) / this.transitionDuration);
        const n = this.current.positions.length;
        for (let i = 0; i < n; i++)
            this.current.positions[i] = lerp(this.from.positions[i], this.target.positions[i], t);
        for (let i = 0; i < this.current.colors.length; i++)
            this.current.colors[i] = lerp(this.from.colors[i], this.target.colors[i], t);
        for (let i = 0; i < this.current.sizes.length; i++)
            this.current.sizes[i] = lerp(this.from.sizes[i], this.target.sizes[i], t);
        for (let i = 0; i < this.current.lineColors.length; i++)
            this.current.lineColors[i] = lerp(this.from.lineColors[i], this.target.lineColors[i], t);
        for (let i = 0; i < 5; i++)
            this.current.camera[i] = lerp(this.from.camera[i], this.target.camera[i], t);
        this.current.exposure = lerp(this.from.exposure, this.target.exposure, t);
        this.blackout = lerp(this.blackout, this.targetBlackout, reducedMotion ? 1 : .12);
        this.render();
        if (now < this.activeUntil || t < .999 || Math.abs(this.blackout - this.targetBlackout) > .01)
            this.frame = requestAnimationFrame(this.tick);
    };
    makeLineData() {
        const pos = new Float32Array(this.edges.length * 6), col = new Float32Array(this.edges.length * 8);
        let pi = 0, ci = 0;
        for (const [a, b] of this.edges) {
            pos.set(this.current.positions.subarray(a * 3, a * 3 + 3), pi);
            pi += 3;
            pos.set(this.current.positions.subarray(b * 3, b * 3 + 3), pi);
            pi += 3;
            col.set(this.current.lineColors.subarray(a * 4, a * 4 + 4), ci);
            ci += 4;
            col.set(this.current.lineColors.subarray(b * 4, b * 4 + 4), ci);
            ci += 4;
        }
        return [pos, col];
    }
    render() {
        const exposure = this.current.exposure * (1 - this.blackout * .96);
        if (!this.gl) {
            this.renderFallback(exposure);
            return;
        }
        const gl = this.gl;
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const projection = mat4Perspective(Math.PI / 3, this.canvas.width / this.canvas.height, .1, 60);
        const c = this.current.camera;
        const view = mat4View(c[0], c[1], c[2], c[3], c[4]);
        const [linePositions, lineColors] = this.makeLineData();
        gl.useProgram(this.lineProgram);
        this.bindAttribute(this.lineProgram, 'aPosition', this.lineBuffer, linePositions, 3);
        this.bindAttribute(this.lineProgram, 'aColor', this.lineColorBuffer, lineColors, 4);
        this.uniformMatrix(this.lineProgram, 'uProjection', projection);
        this.uniformMatrix(this.lineProgram, 'uView', view);
        gl.uniform1f(gl.getUniformLocation(this.lineProgram, 'uExposure'), exposure);
        gl.drawArrays(gl.LINES, 0, this.edges.length * 2);
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
    uniformMatrix(program, name, data) { this.gl.uniformMatrix4fv(this.gl.getUniformLocation(program, name), false, data); }
    renderFallback(exposure) {
        const ctx = this.fallback2d;
        if (!ctx)
            return;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        const scale = Math.min(this.canvas.width, this.canvas.height) / 12;
        ctx.lineWidth = 1;
        for (const [a, b] of this.edges) {
            const ax = this.canvas.width / 2 + this.current.positions[a * 3] * scale, ay = this.canvas.height / 2 - this.current.positions[a * 3 + 1] * scale;
            const bx = this.canvas.width / 2 + this.current.positions[b * 3] * scale, by = this.canvas.height / 2 - this.current.positions[b * 3 + 1] * scale;
            ctx.strokeStyle = `rgba(225,245,249,${.06 * exposure})`;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.stroke();
        }
        for (let i = 0; i < this.nodeCount; i++) {
            const x = this.canvas.width / 2 + this.current.positions[i * 3] * scale, y = this.canvas.height / 2 - this.current.positions[i * 3 + 1] * scale;
            const o = i * 4;
            const c = this.current.colors;
            const r = Math.round(c[o] * 255), g = Math.round(c[o + 1] * 255), b = Math.round(c[o + 2] * 255);
            ctx.fillStyle = `rgba(${r},${g},${b},${c[o + 3] * exposure})`;
            ctx.beginPath();
            ctx.arc(x, y, Math.max(1, this.current.sizes[i] * .45), 0, Math.PI * 2);
            ctx.fill();
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
document.addEventListener('visibilitychange', () => { if (!document.hidden)
    renderer.wake(300); });
// Reveal and act choreography.
const reveals = qa('.reveal');
const revealObserver = new IntersectionObserver(entries => {
    for (const entry of entries)
        if (entry.isIntersecting)
            entry.target.classList.add('visible');
}, { threshold: .12 });
reveals.forEach(el => revealObserver.observe(el));
const acts = qa('[data-act]');
let activeAct = 'presence';
let recoveryRun = false;
let recoveryTimers = [];
function triggerRecovery() {
    if (recoveryRun)
        return;
    recoveryRun = true;
    const section = q('#recovery');
    const run = (fn, ms) => { recoveryTimers.push(window.setTimeout(fn, reducedMotion ? 0 : ms)); };
    renderer.setBlackout(true);
    run(() => section.classList.add('blackout'), 380);
    run(() => { renderer.setBlackout(false); section.classList.add('reconstructed'); }, 1450);
}
const actObserver = new IntersectionObserver(entries => {
    const visible = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible)
        return;
    const next = visible.target.dataset.act;
    if (next && next !== activeAct) {
        activeAct = next;
        renderer.setAct(next);
    }
    if (next === 'recovery' && visible.intersectionRatio > .48)
        triggerRecovery();
}, { threshold: [0.24, .48, .66] });
acts.forEach(el => actObserver.observe(el));
window.addEventListener('scroll', () => renderer.wake(260), { passive: true });
// Journey state machine.
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
    await wait(330);
    if (token !== interactionToken)
        return;
    setPhase('verify');
    const checks = qa('[data-check]');
    checks.forEach(el => { el.classList.remove('pass'); const b = el.querySelector('b'); if (b)
        b.textContent = '—'; });
    for (const check of checks) {
        await wait(170);
        if (token !== interactionToken)
            return;
        check.classList.add('pass');
        const b = check.querySelector('b');
        if (b)
            b.textContent = '✓';
        renderer.wake(260);
    }
    await wait(220);
    if (token !== interactionToken)
        return;
    setPhase('authority');
    const readOnly = goal === 'inspect';
    authorizeButton.hidden = readOnly;
    authorityTitle.textContent = readOnly ? 'READ-ONLY OPERATION' : 'GOVERNED STATE MUTATION DETECTED';
    authorityStatus.textContent = readOnly ? 'AUTHORIZATION NOT REQUIRED' : 'AUTHORIZATION REQUIRED';
    authorityStatus.style.color = readOnly ? 'var(--valid)' : 'var(--danger)';
    authoritySupport.textContent = readOnly ? 'The verified capability remains non-authoritative and non-consequential.' : 'Technical applicability does not manufacture permission.';
    if (readOnly) {
        await wait(650);
        if (token !== interactionToken)
            return;
        completeExecution(false);
    }
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
    if (phase !== 'authority' || selectedGoal === 'inspect')
        return;
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
// Keyboard arrow navigation through example goals without turning this into a faux chat UI.
q('.goal-list').addEventListener('keydown', event => {
    if (!(event instanceof KeyboardEvent) || !['ArrowDown', 'ArrowUp'].includes(event.key))
        return;
    const current = goalButtons.indexOf(document.activeElement);
    if (current < 0)
        return;
    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    goalButtons[(current + delta + goalButtons.length) % goalButtons.length].focus();
});
// Initial state.
setPhase('goal');
renderer.setAct('presence');

})();
