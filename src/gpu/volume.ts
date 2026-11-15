import { Mat4, invert, lookAt, multiply, perspective } from '../mat4';

export interface Camera {
  viewProj: Mat4;
  invViewProj: Mat4;
  eye: [number, number, number];
}

/** 轨道相机 (z 轴向上) */
export class OrbitCamera {
  theta = 0.8;   // 水平角 (弧度)
  phi = 1.1;     // 极角, 自 +z 轴
  radius = 1000;
  target: [number, number, number] = [0, 0, 0];

  eye(): [number, number, number] {
    const sp = Math.sin(this.phi);
    return [
      this.target[0] + this.radius * sp * Math.cos(this.theta),
      this.target[1] + this.radius * sp * Math.sin(this.theta),
      this.target[2] + this.radius * Math.cos(this.phi),
    ];
  }

  camera(aspect: number): Camera {
    const eye = this.eye();
    const view = lookAt(eye, this.target, [0, 0, 1]);
    const proj = perspective((45 * Math.PI) / 180, aspect, this.radius / 200, this.radius * 20);
    const viewProj = multiply(proj, view);
    return { viewProj, invViewProj: invert(viewProj), eye };
  }

  /** 在视平面内平移 */
  pan(dxPx: number, dyPx: number, viewportHeight: number): void {
    const scale = (2 * this.radius * Math.tan((45 * Math.PI) / 360)) / viewportHeight;
    const eye = this.eye();
    // 视线方向
    let fx = this.target[0] - eye[0];
    let fy = this.target[1] - eye[1];
    let fz = this.target[2] - eye[2];
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    // 右向 = forward × up(0,0,1)
    let rx = fy * 1 - fz * 0;
    let ry = fz * 0 - fx * 1;
    let rz = fx * 0 - fy * 0;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    // 上向 = right × forward
    const ux = ry * fz - rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy - ry * fx;
    this.target[0] += (-dxPx * rx + dyPx * ux) * scale;
    this.target[1] += (-dxPx * ry + dyPx * uy) * scale;
    this.target[2] += (-dxPx * rz + dyPx * uz) * scale;
  }
}

const VOLUME_WGSL = /* wgsl */ `
struct U {
  invViewProj : mat4x4f,
  cameraPos   : vec4f,
  boxMin      : vec4f,
  boxMax      : vec4f,
  params      : vec4f, // x: 步数, y: 密度系数, z: 是否有体数据
  bg          : vec4f,
};

@group(0) @binding(0) var<uniform> u : U;
@group(0) @binding(1) var volTex : texture_3d<f32>;
@group(0) @binding(2) var tfTex  : texture_2d<f32>;
@group(0) @binding(3) var samp   : sampler;

struct VOut {
  @builtin(position) pos : vec4f,
  @location(0) ndc : vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> VOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o : VOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  o.ndc = p[vi];
  return o;
}

fn intersectAABB(ro : vec3f, rd : vec3f, bmin : vec3f, bmax : vec3f) -> vec2f {
  let invD = vec3f(
    select(1.0 / rd.x, 1e30, abs(rd.x) < 1e-9),
    select(1.0 / rd.y, 1e30, abs(rd.y) < 1e-9),
    select(1.0 / rd.z, 1e30, abs(rd.z) < 1e-9));
  let t0 = (bmin - ro) * invD;
  let t1 = (bmax - ro) * invD;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  return vec2f(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}

@fragment
fn fs(inp : VOut) -> @location(0) vec4f {
  if (u.params.z < 0.5) {
    return u.bg;
  }
  let ro = u.cameraPos.xyz;
  let far4 = u.invViewProj * vec4f(inp.ndc, 1.0, 1.0);
  let farP = far4.xyz / far4.w;
  let rd = normalize(farP - ro);
  let t = intersectAABB(ro, rd, u.boxMin.xyz, u.boxMax.xyz);
  let t0 = max(t.x, 0.0);
  let t1 = t.y;
  if (t1 <= t0) {
    return u.bg;
  }
  let steps = u32(u.params.x);
  let dt = (t1 - t0) / f32(steps);
  let size = u.boxMax.xyz - u.boxMin.xyz;
  var pos = ro + rd * (t0 + 0.5 * dt);
  var acc = vec4f(0.0);
  for (var i = 0u; i < steps; i = i + 1u) {
    let uvw = (pos - u.boxMin.xyz) / size;
    let vm = textureSampleLevel(volTex, samp, uvw, 0.0);
    if (vm.g > 0.02) {
      let c = textureSampleLevel(tfTex, samp, vec2f(vm.r, 0.5), 0.0);
      // 按步长修正不透明度 (Beer-Lambert)
      let a = 1.0 - pow(1.0 - clamp(c.a, 0.0, 1.0), u.params.y * dt * 12.0);
      let w = a * (1.0 - acc.a);
      acc = acc + vec4f(c.rgb * w, w);
      if (acc.a > 0.985) {
        break;
      }
    }
    pos = pos + rd * dt;
  }
  return vec4f(acc.rgb + u.bg.rgb * (1.0 - acc.a), 1.0);
}
`;

const LINE_WGSL = /* wgsl */ `
struct LU { viewProj : mat4x4f };
@group(0) @binding(0) var<uniform> u : LU;

struct VIn {
  @location(0) pos : vec3f,
  @location(1) color : vec4f,
};
struct VOut {
  @builtin(position) pos : vec4f,
  @location(1) color : vec4f,
};

@vertex
fn vs(i : VIn) -> VOut {
  var o : VOut;
  o.pos = u.viewProj * vec4f(i.pos, 1.0);
  o.color = i.color;
  return o;
}

@fragment
fn fs(i : VOut) -> @location(0) vec4f {
  return i.color;
}
`;

let sharedDevice: GPUDevice | null = null;

export async function getDevice(): Promise<GPUDevice | null> {
  if (sharedDevice) return sharedDevice;
  if (typeof navigator === 'undefined' || !('gpu' in navigator) || !navigator.gpu) return null;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    sharedDevice = await adapter.requestDevice();
    sharedDevice.lost.then(() => { sharedDevice = null; });
    return sharedDevice;
  } catch {
    return null;
  }
}

export interface VolumeBox {
  min: [number, number, number];
  max: [number, number, number];
}

export class VolumeRenderer {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private format: GPUTextureFormat;
  private pipeline: GPURenderPipeline;
  private linePipeline: GPURenderPipeline;
  private uniformBuffer: GPUBuffer;
  private lineUniformBuffer: GPUBuffer;
  private sampler: GPUSampler;
  private tfTexture: GPUTexture;
  private volTexture: GPUTexture | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private lineBindGroup: GPUBindGroup;
  private lineVB: GPUBuffer | null = null;
  private lineCount = 0;
  private uniforms = new Float32Array(36);
  private lineUniforms = new Float32Array(16);

  steps = 384;
  density = 1.0;
  showHoles = true;
  bg: [number, number, number] = [0.05, 0.06, 0.09];
  private box: VolumeBox = { min: [0, 0, 0], max: [1, 1, 1] };
  private hasVolume = false;

  private constructor(device: GPUDevice, context: GPUCanvasContext, format: GPUTextureFormat) {
    this.device = device;
    this.context = context;
    this.format = format;

    this.uniformBuffer = device.createBuffer({ size: 144, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.lineUniformBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.tfTexture = device.createTexture({
      size: { width: 256, height: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    const volLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '3d', sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });
    const volModule = device.createShaderModule({ code: VOLUME_WGSL });
    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [volLayout] }),
      vertex: { module: volModule, entryPoint: 'vs' },
      fragment: { module: volModule, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    this.volLayout = volLayout;

    const lineLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
    });
    const lineModule = device.createShaderModule({ code: LINE_WGSL });
    this.linePipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [lineLayout] }),
      vertex: {
        module: lineModule,
        entryPoint: 'vs',
        buffers: [{
          arrayStride: 28,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x4' },
          ],
        }],
      },
      fragment: {
        module: lineModule,
        entryPoint: 'fs',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'line-list' },
    });
    this.lineBindGroup = device.createBindGroup({
      layout: lineLayout,
      entries: [{ binding: 0, resource: { buffer: this.lineUniformBuffer } }],
    });
  }

  private volLayout: GPUBindGroupLayout;

  static async create(canvas: HTMLCanvasElement): Promise<VolumeRenderer | null> {
    const device = await getDevice();
    if (!device) return null;
    const context = canvas.getContext('webgpu');
    if (!context) return null;
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });
    return new VolumeRenderer(device, context, format);
  }

  /** 上传体数据 (rg8: 归一化品位 + 掩码) */
  setVolume(data: Uint8Array, nx: number, ny: number, nz: number, box: VolumeBox): void {
    this.volTexture?.destroy();
    this.volTexture = this.device.createTexture({
      size: { width: nx, height: ny, depthOrArrayLayers: nz },
      dimension: '3d',
      format: 'rg8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    // writeTexture 要求 bytesPerRow 为 256 的倍数, 不足时按行补齐
    const rowBytes = nx * 2;
    const aligned = Math.ceil(rowBytes / 256) * 256;
    let payload = data as Uint8Array;
    if (aligned !== rowBytes) {
      payload = new Uint8Array(aligned * ny * nz);
      for (let z = 0; z < nz; z++) {
        for (let y = 0; y < ny; y++) {
          const src = (z * ny + y) * rowBytes;
          payload.set(data.subarray(src, src + rowBytes), (z * ny + y) * aligned);
        }
      }
    }
    this.device.queue.writeTexture(
      { texture: this.volTexture },
      payload as GPUAllowSharedBufferSource,
      { bytesPerRow: aligned, rowsPerImage: ny },
      { width: nx, height: ny, depthOrArrayLayers: nz },
    );
    this.box = box;
    this.hasVolume = true;
    this.bindGroup = this.device.createBindGroup({
      layout: this.volLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.volTexture.createView({ dimension: '3d' }) },
        { binding: 2, resource: this.tfTexture.createView() },
        { binding: 3, resource: this.sampler },
      ],
    });
  }

  clearVolume(): void {
    this.hasVolume = false;
  }

  /** 更新传输函数查找表 (256*4 字节) */
  setTransferFunction(lut: Uint8Array): void {
    this.device.queue.writeTexture(
      { texture: this.tfTexture },
      lut as GPUAllowSharedBufferSource,
      { bytesPerRow: 256 * 4 },
      { width: 256, height: 1 },
    );
  }

  /** 上传钻孔轨迹线段顶点 (每顶点 7 个 float: xyz + rgba) */
  setHoleLines(vertices: Float32Array): void {
    this.lineVB?.destroy();
    this.lineVB = null;
    this.lineCount = 0;
    if (vertices.length === 0) return;
    this.lineVB = this.device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.lineVB, 0, vertices as GPUAllowSharedBufferSource);
    this.lineCount = vertices.length / 7;
  }

  render(cam: Camera): void {
    const u = this.uniforms;
    u.set(cam.invViewProj, 0);
    u.set([cam.eye[0], cam.eye[1], cam.eye[2], 0], 16);
    u.set([this.box.min[0], this.box.min[1], this.box.min[2], 0], 20);
    u.set([this.box.max[0], this.box.max[1], this.box.max[2], 0], 24);
    u.set([this.steps, this.density, this.hasVolume ? 1 : 0, 0], 28);
    u.set([this.bg[0], this.bg[1], this.bg[2], 1], 32);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, u);
    this.lineUniforms.set(cam.viewProj, 0);
    this.device.queue.writeBuffer(this.lineUniformBuffer, 0, this.lineUniforms);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: this.bg[0], g: this.bg[1], b: this.bg[2], a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    if (this.hasVolume && this.bindGroup) {
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.draw(3);
    }
    if (this.showHoles && this.lineVB && this.lineCount > 0) {
      pass.setPipeline(this.linePipeline);
      pass.setBindGroup(0, this.lineBindGroup);
      pass.setVertexBuffer(0, this.lineVB);
      pass.draw(this.lineCount);
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.volTexture?.destroy();
    this.tfTexture.destroy();
    this.lineVB?.destroy();
    this.uniformBuffer.destroy();
    this.lineUniformBuffer.destroy();
    this.context.unconfigure();
  }
}
