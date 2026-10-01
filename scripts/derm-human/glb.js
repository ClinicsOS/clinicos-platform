'use strict';
/** Minimal glTF 2.0 binary writer: one shared vertex buffer, one visible skin mesh + one hidden hit mesh per region (index-only). */
function writeGlb({ name, positions, normals, colors, indices, regionIndices, extras }) {
  const nv = positions.length / 3;
  const idxType = nv <= 65535 ? 5123 : 5125, idxSize = idxType === 5123 ? 2 : 4;
  const pad4 = (n) => (n + 3) & ~3;
  const chunks = []; const bufferViews = []; const accessors = [];
  let offset = 0;
  const addView = (buf, target) => { const bytes = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength); const start = offset; chunks.push(bytes); const padn = pad4(bytes.length) - bytes.length; if (padn) chunks.push(Buffer.alloc(padn)); offset += bytes.length + padn; bufferViews.push({ buffer: 0, byteOffset: start, byteLength: bytes.length, target }); return bufferViews.length - 1; };
  const acc = (bv, comp, count, type, extra = {}) => { accessors.push({ bufferView: bv, componentType: comp, count, type, ...extra }); return accessors.length - 1; };
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], positions[i + k]); mx[k] = Math.max(mx[k], positions[i + k]); }
  const aPos = acc(addView(positions, 34962), 5126, nv, 'VEC3', { min: mn, max: mx });
  const aNor = acc(addView(normals, 34962), 5126, nv, 'VEC3');
  const aCol = acc(addView(colors, 34962), 5126, nv, 'VEC3');
  const toIdx = (arr) => (idxType === 5123 ? Uint16Array.from(arr) : Uint32Array.from(arr));
  const aSkin = acc(addView(toIdx(indices), 34963), idxType, indices.length, 'SCALAR');
  const meshes = [{ name: 'skin', primitives: [{ attributes: { POSITION: aPos, NORMAL: aNor, COLOR_0: aCol }, indices: aSkin, material: 0, mode: 4 }] }];
  const nodes = [{ name, children: [] }];
  nodes.push({ name: 'skin', mesh: 0 }); nodes[0].children.push(1);
  for (const [id, idx] of Object.entries(regionIndices)) {
    const a = acc(addView(toIdx(idx), 34963), idxType, idx.length, 'SCALAR');
    meshes.push({ name: `hit_${id}`, primitives: [{ attributes: { POSITION: aPos, NORMAL: aNor }, indices: a, material: 1, mode: 4 }] });
    nodes.push({ name: `hit_${id}`, mesh: meshes.length - 1 }); nodes[0].children.push(nodes.length - 1);
  }
  const json = {
    asset: { version: '2.0', generator: 'ClinicOS derm-human generator (procedural SDF, own code)', extras },
    scene: 0, scenes: [{ nodes: [0] }], nodes, meshes,
    materials: [
      { name: 'clinical-skin', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.78 } },
      { name: 'hit-helper', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } },
    ],
    accessors, bufferViews, buffers: [{ byteLength: offset }],
  };
  let js = Buffer.from(JSON.stringify(json), 'utf8'); const jpad = pad4(js.length) - js.length; if (jpad) js = Buffer.concat([js, Buffer.alloc(jpad, 0x20)]);
  const bin = Buffer.concat(chunks);
  const total = 12 + 8 + js.length + 8 + bin.length;
  const header = Buffer.alloc(12); header.write('glTF', 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.write('JSON', 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.write('BIN\0', 4);
  return Buffer.concat([header, jh, js, bh, bin]);
}
module.exports = { writeGlb };
