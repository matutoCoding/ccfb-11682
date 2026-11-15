import { describe, expect, it } from 'vitest';
import { crossCheck, parseAssays, parseCollars, parseSurveys } from '../src/csv';

describe('CSV 解析', () => {
  it('解析孔口表并跳过表头', () => {
    const r = parseCollars('孔号,X,Y,Z,孔深\nZK01,100,200,50,150\nZK02,110,210,51,160\n');
    expect(r.headerSkipped).toBe(true);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual({ holeId: 'ZK01', x: 100, y: 200, z: 50, maxDepth: 150 });
    expect(r.errors).toHaveLength(0);
  });

  it('孔深列可省略', () => {
    const r = parseCollars('ZK01,100,200,50\n');
    expect(r.rows[0].maxDepth).toBe(0);
  });

  it('格式错误的行被报出且带行号, 正确行仍导入', () => {
    const text = [
      'ZK01,100,200,50,150',   // 行1 正确
      'ZK02,abc,200,50,150',   // 行2 X 非数字
      'ZK03,110',              // 行3 列数不足
      ',110,210,51,160',       // 行4 孔号为空
      'ZK05,120,220,52,170',   // 行5 正确
    ].join('\n');
    const r = parseCollars(text);
    expect(r.rows).toHaveLength(2);
    expect(r.errors).toHaveLength(3);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(r.errors[0].reason).toContain('数字');
    expect(r.errors[1].reason).toContain('列数不足');
    expect(r.errors[2].reason).toContain('孔号为空');
  });

  it('测斜表校验方位角和倾角范围', () => {
    const r = parseSurveys('ZK01,0,45,80\nZK01,100,400,80\nZK01,200,45,95\n');
    expect(r.rows).toHaveLength(1);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0].reason).toContain('方位角');
    expect(r.errors[1].reason).toContain('倾角');
  });

  it('品位表校验段末大于段首', () => {
    const r = parseAssays('ZK01,0,2,0.5\nZK01,4,2,0.6\nZK01,4,6,-0.1\n');
    expect(r.rows).toHaveLength(1);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0].reason).toContain('段末');
    expect(r.errors[1].reason).toContain('品位');
  });

  it('支持分号和制表符分隔', () => {
    const r = parseCollars('ZK01;100;200;50;150\nZK02\t110\t210\t51\t160\n');
    expect(r.rows).toHaveLength(2);
  });

  it('交叉校验发现未知孔号和重复孔号', () => {
    const collars = parseCollars('ZK01,1,2,3,100\nZK01,4,5,6,100\n').rows;
    const surveys = parseSurveys('ZK99,0,0,90\n').rows;
    const assays = parseAssays('ZK98,0,2,0.5\n').rows;
    const w = crossCheck(collars, surveys, assays);
    expect(w.some((x) => x.includes('重复孔号'))).toBe(true);
    expect(w.some((x) => x.includes('ZK99'))).toBe(true);
    expect(w.some((x) => x.includes('ZK98'))).toBe(true);
  });
});
