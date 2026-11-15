import { Project } from './types';
import { createProject, saveProject } from './store';
import { mulberry32 } from './ui';

/**
 * 生成演示项目: 5x4 钻孔网, 透镜状矿体 (中心高品位向外衰减 + 噪声)。
 * 用于快速体验全流程。
 */
export function createDemoProject(): Project {
  const p = createProject('演示矿床 (透镜状矿体)');
  p.note = '自动生成的演示数据: 20 个钻孔, 透镜状矿体, 品位单位 %';
  p.cutoff = 0.3;
  p.density = 2.75;
  p.gradeUnit = '%';

  const rand = mulberry32(42);
  const cx = 500200, cy = 3200500, cz = 120; // 矿体中心
  const holes: { id: string; x: number; y: number; z: number; az: number; dip: number; depth: number }[] = [];

  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 4; j++) {
      const idx = holes.length;
      const inclined = (i + j) % 3 === 0;
      holes.push({
        id: `ZK${String(idx + 1).padStart(2, '0')}`,
        x: 500000 + i * 100,
        y: 3200400 + j * 80,
        z: 200 + rand() * 5,
        az: inclined ? 45 + rand() * 20 : 0,
        dip: inclined ? 65 + rand() * 10 : 90,
        depth: 180 + rand() * 40,
      });
    }
  }

  for (const hh of holes) {
    p.collars.push({ holeId: hh.id, x: hh.x, y: hh.y, z: hh.z, maxDepth: hh.depth });
    p.surveys.push({ holeId: hh.id, depth: 0, azimuth: hh.az, dip: hh.dip });
    p.surveys.push({ holeId: hh.id, depth: hh.depth * 0.5, azimuth: hh.az + 2, dip: hh.dip - 1.5 });
    p.surveys.push({ holeId: hh.id, depth: hh.depth, azimuth: hh.az + 4, dip: hh.dip - 3 });

    // 沿轨迹每 2m 一个品位段
    const azr = (hh.az * Math.PI) / 180;
    const dipr = (hh.dip * Math.PI) / 180;
    const dx = Math.cos(dipr) * Math.sin(azr);
    const dy = Math.cos(dipr) * Math.cos(azr);
    const dz = -Math.sin(dipr);
    for (let from = 0; from < hh.depth; from += 2) {
      const md = from + 1;
      const px = hh.x + dx * md;
      const py = hh.y + dy * md;
      const pz = hh.z + dz * md;
      // 透镜体: 椭球距离场
      const ex = (px - cx) / 180;
      const ey = (py - cy) / 140;
      const ez = (pz - cz) / 45;
      const r = Math.sqrt(ex * ex + ey * ey + ez * ez);
      let grade = r < 1 ? 1.6 * (1 - r) * (1 - r) + 0.05 : 0.02;
      grade += (rand() - 0.5) * 0.08;
      grade = Math.max(0, grade);
      p.assays.push({ holeId: hh.id, from, to: Math.min(from + 2, hh.depth), grade: Math.round(grade * 1000) / 1000 });
    }
  }
  saveProject(p);
  return p;
}
