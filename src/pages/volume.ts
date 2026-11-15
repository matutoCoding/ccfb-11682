import { h, fmt } from '../ui';
import { getSettings, saveProject } from '../store';
import { getCurrentProject } from '../state';
import { getCurrentModel } from '../state';
import { OrbitCamera, VolumeRenderer } from '../gpu/volume';
import { packVolumeRG8, histogram } from '../gridutil';
import { computeLUT, hexToRgb, rgbToHex } from '../transfer';
import { buildHoleLines } from '../holelines';
import { GridModel, TFNode } from '../types';

export function renderVolumePage(root: HTMLElement): () => void {
  const project = getCurrentProject();
  const settings = getSettings();

  const layout = h('div', { class: 'viewer-layout' });
  const canvasWrap = h('div', { class: 'viewer-canvas-wrap' });
  const canvas = h('canvas', {});
  canvasWrap.append(canvas);
  const side = h('div', { class: 'viewer-side' });
  layout.append(canvasWrap, side);
  root.append(layout);

  if (!project) {
    side.append(h('div', { class: 'notice' }, '请先选择一个项目。'));
    return () => {};
  }

  let disposed = false;
  let renderer: VolumeRenderer | null = null;
  let model: GridModel | null = null;
  let lut: Uint8Array = computeLUT(project.tf);
  let raf = 0;
  let dirty = true;

  const cam = new OrbitCamera();

  function requestRender(): void {
    dirty = true;
  }

  function frame(): void {
    if (disposed) return;
    if (dirty && renderer) {
      const aspect = canvas.width / Math.max(1, canvas.height);
      renderer.render(cam.camera(aspect));
      dirty = false;
    }
    raf = requestAnimationFrame(frame);
  }

  function resize(): void {
    const scale = settings.renderScale;
    const w = Math.max(8, Math.floor(canvasWrap.clientWidth * scale));
    const hh = Math.max(8, Math.floor(canvasWrap.clientHeight * scale));
    if (canvas.width !== w || canvas.height !== hh) {
      canvas.width = w;
      canvas.height = hh;
      requestRender();
    }
  }

  // ---------- 相机交互 ----------
  let dragging = false;
  let panning = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    panning = e.button === 2 || e.shiftKey;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (panning) {
      cam.pan(dx, dy, canvas.height);
    } else {
      cam.theta -= dx * 0.006;
      cam.phi = Math.max(0.05, Math.min(Math.PI - 0.05, cam.phi - dy * 0.006));
    }
    requestRender();
  });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.radius *= e.deltaY > 0 ? 1.12 : 1 / 1.12;
    requestRender();
  }, { passive: false });

  // ---------- 侧面板 ----------
  side.append(h('h3', {}, `体渲染 — ${project.name}`));
  const statusBox = h('div', {});
  side.append(statusBox);

  // 传输函数编辑器
  side.append(h('h3', {}, '传输函数 (品位 → 颜色/透明度)'));
  const tfCanvas = h('canvas', { class: 'tf-canvas' }) as HTMLCanvasElement;
  side.append(tfCanvas);
  const tfScale = h('div', { class: 'tf-scale' }, h('span', {}, '0'), h('span', {}, '1'));
  side.append(tfScale);
  side.append(h('p', { class: 'hint' }, '拖动节点调整; 双击空白添加节点; 右键节点删除。'));
  const colorRow = h('div', { class: 'toolbar' });
  const colorInput = h('input', { type: 'color', value: '#e76f51' });
  const nodeInfo = h('span', { class: 'dim' }, '未选中节点');
  colorRow.append(h('span', { class: 'dim' }, '选中节点颜色:'), colorInput, nodeInfo);
  side.append(colorRow);

  // 渲染参数
  side.append(h('h3', {}, '渲染参数'));
  const densitySlider = slider(0.05, 5, 0.05, 1);
  const stepsSlider = slider(64, 768, 32, settings.raySteps);
  const holesCheck = h('input', { type: 'checkbox', checked: '' }) as HTMLInputElement;
  holesCheck.checked = true;
  const resetBtn = h('button', {}, '重置视角');
  side.append(
    h('label', { class: 'field', style: 'width:100%' }, '不透明度系数', densitySlider),
    h('label', { class: 'field', style: 'width:100%' }, '光线步进数', stepsSlider),
    h('div', {}, h('label', { class: 'check' }, holesCheck, '叠加钻孔轨迹')),
    h('div', { class: 'toolbar', style: 'margin-top:10px' }, resetBtn),
  );

  densitySlider.oninput = () => {
    if (renderer) renderer.density = Number(densitySlider.value);
    requestRender();
  };
  stepsSlider.oninput = () => {
    if (renderer) renderer.steps = Number(stepsSlider.value);
    requestRender();
  };
  holesCheck.onchange = () => {
    if (renderer) renderer.showHoles = holesCheck.checked;
    requestRender();
  };
  resetBtn.onclick = () => {
    if (model) resetCamera(model);
    requestRender();
  };

  function resetCamera(m: GridModel): void {
    const cx = m.origin[0] + (m.nx - 1) * m.spacing[0] / 2;
    const cy = m.origin[1] + (m.ny - 1) * m.spacing[1] / 2;
    const cz = m.origin[2] + (m.nz - 1) * m.spacing[2] / 2;
    const diag = Math.hypot(
      (m.nx - 1) * m.spacing[0],
      (m.ny - 1) * m.spacing[1],
      (m.nz - 1) * m.spacing[2],
    );
    cam.target = [cx, cy, cz];
    cam.radius = diag * 1.4;
    cam.theta = 0.8;
    cam.phi = 1.1;
  }

  // ---------- 传输函数编辑器逻辑 ----------
  let selectedNode: TFNode | null = null;
  let hist: { counts: Uint32Array } | null = null;

  function drawTF(): void {
    const dpr = window.devicePixelRatio || 1;
    const W = tfCanvas.clientWidth || 288;
    const H = 160;
    if (tfCanvas.width !== W * dpr) {
      tfCanvas.width = W * dpr;
      tfCanvas.height = H * dpr;
    }
    const ctx = tfCanvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // 直方图背景
    if (hist) {
      let maxC = 1;
      for (const c of hist.counts) maxC = Math.max(maxC, c);
      const bw = W / hist.counts.length;
      ctx.fillStyle = 'rgba(120,140,170,0.25)';
      for (let i = 0; i < hist.counts.length; i++) {
        const hh = (hist.counts[i] / maxC) * (H - 20);
        ctx.fillRect(i * bw, H - hh, Math.max(1, bw - 1), hh);
      }
    }

    // 不透明度曲线 (按 LUT 颜色)
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const idx = Math.round(t * 255) * 4;
      grad.addColorStop(t, `rgb(${lut[idx]},${lut[idx + 1]},${lut[idx + 2]})`);
    }
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let i = 0; i < 256; i++) {
      const a = lut[i * 4 + 3] / 255;
      ctx.lineTo((i / 255) * W, H - a * (H - 14) - 4);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.stroke();

    // 节点
    const nodes = sortedNodes();
    for (const n of nodes) {
      const x = n.pos * W;
      const y = H - n.alpha * (H - 14) - 4;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = n.color;
      ctx.fill();
      ctx.lineWidth = n === selectedNode ? 3 : 1.5;
      ctx.strokeStyle = n === selectedNode ? '#fff' : 'rgba(0,0,0,0.6)';
      ctx.stroke();
    }
  }

  function sortedNodes(): TFNode[] {
    return [...project!.tf].sort((a, b) => a.pos - b.pos);
  }

  function tfPos(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = tfCanvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, 1 - (e.clientY - r.top - 4) / (r.height - 18))),
    };
  }

  function hitNode(x: number, y: number): TFNode | null {
    const r = tfCanvas.getBoundingClientRect();
    for (const n of project!.tf) {
      const nx = n.pos * r.width;
      const ny = (1 - n.alpha) * (r.height - 18) + 4;
      const px = x * r.width;
      const py = (1 - y) * (r.height - 18) + 4;
      if (Math.hypot(nx - px, ny - py) < 10) return n;
    }
    return null;
  }

  function applyTF(): void {
    project!.tf.sort((a, b) => a.pos - b.pos);
    lut = computeLUT(project!.tf);
    if (renderer) renderer.setTransferFunction(lut);
    saveProject(project!);
    rebuildHoleLines();
    drawTF();
    requestRender();
  }

  let dragNode: TFNode | null = null;
  tfCanvas.addEventListener('pointerdown', (e) => {
    const { x, y } = tfPos(e);
    const node = hitNode(x, y);
    if (node) {
      selectedNode = node;
      dragNode = node;
      colorInput.value = node.color;
      nodeInfo.textContent = `品位位置 ${fmt(node.pos, 3)}, 不透明度 ${fmt(node.alpha, 2)}`;
      tfCanvas.setPointerCapture(e.pointerId);
      drawTF();
    } else {
      selectedNode = null;
      nodeInfo.textContent = '未选中节点';
      drawTF();
    }
  });
  tfCanvas.addEventListener('pointermove', (e) => {
    if (!dragNode) return;
    const { x, y } = tfPos(e);
    dragNode.pos = x;
    dragNode.alpha = y;
    nodeInfo.textContent = `品位位置 ${fmt(x, 3)}, 不透明度 ${fmt(y, 2)}`;
    applyTF();
  });
  tfCanvas.addEventListener('pointerup', () => { dragNode = null; });
  tfCanvas.addEventListener('dblclick', (e) => {
    const { x, y } = tfPos(e);
    if (hitNode(x, y)) return;
    const node: TFNode = { pos: x, alpha: y, color: '#4f9cf9' };
    project!.tf.push(node);
    selectedNode = node;
    colorInput.value = node.color;
    applyTF();
  });
  tfCanvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const { x, y } = tfPos(e);
    const node = hitNode(x, y);
    if (node && project!.tf.length > 2) {
      project!.tf = project!.tf.filter((n) => n !== node);
      if (selectedNode === node) selectedNode = null;
      applyTF();
    }
  });
  colorInput.oninput = () => {
    if (!selectedNode) return;
    selectedNode.color = colorInput.value;
    applyTF();
  };

  function rebuildHoleLines(): void {
    if (!renderer || !project) return;
    renderer.setHoleLines(buildHoleLines(project, model, lut));
  }

  // ---------- 初始化 ----------
  void (async () => {
    renderer = await VolumeRenderer.create(canvas);
    if (disposed) return;
    if (!renderer) {
      statusBox.append(h('div', { class: 'notice err' },
        '当前浏览器不支持 WebGPU。请使用 Chrome / Edge 113+ 并确认已启用硬件加速。'));
      return;
    }
    renderer.density = Number(densitySlider.value);
    renderer.steps = Number(stepsSlider.value);
    const bgc = hexToRgb(settings.bgColor);
    renderer.bg = [bgc[0] / 255, bgc[1] / 255, bgc[2] / 255];
    renderer.setTransferFunction(lut);

    model = await getCurrentModel();
    if (disposed) return;
    if (!model) {
      statusBox.append(h('div', { class: 'notice' },
        '还没有插值模型。请先到「插值建模」页运行插值。'));
      return;
    }
    const m = model;
    statusBox.append(h('dl', { class: 'kv' },
      h('dt', {}, '网格'), h('dd', {}, `${m.nx}×${m.ny}×${m.nz}`),
      h('dt', {}, '品位范围'), h('dd', {}, `${fmt(m.min, 4)} ~ ${fmt(m.max, 4)} ${project!.gradeUnit}`),
    ));
    tfScale.firstElementChild!.textContent = fmt(m.min, 3);
    tfScale.lastElementChild!.textContent = fmt(m.max, 3);

    renderer.setVolume(packVolumeRG8(m), m.nx, m.ny, m.nz, {
      min: [m.origin[0], m.origin[1], m.origin[2]],
      max: [
        m.origin[0] + (m.nx - 1) * m.spacing[0],
        m.origin[1] + (m.ny - 1) * m.spacing[1],
        m.origin[2] + (m.nz - 1) * m.spacing[2],
      ],
    });
    resetCamera(m);
    hist = histogram(m);
    rebuildHoleLines();
    drawTF();
    requestRender();
    // 调试钩子 (冒烟测试用)
    (window as unknown as { __vol?: unknown }).__vol = { renderer, cam, model: m, canvas };
  })();

  const resizeObs = new ResizeObserver(resize);
  resizeObs.observe(canvasWrap);
  resize();
  raf = requestAnimationFrame(frame);

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    resizeObs.disconnect();
    renderer?.destroy();
  };
}

function slider(min: number, max: number, step: number, value: number): HTMLInputElement {
  const s = h('input', {
    type: 'range',
    min: String(min), max: String(max), step: String(step), value: String(value),
  }) as HTMLInputElement;
  return s;
}
