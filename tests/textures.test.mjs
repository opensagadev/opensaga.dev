import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeTexture } from '../site/apps/nudat/textures.js';
function dds(format, data, width=4, height=4) {
  const bytes = Buffer.alloc(128+data.length);
  bytes.write('DDS '); bytes.writeUInt32LE(124,4); bytes.writeUInt32LE(0x81007,8);
  bytes.writeUInt32LE(height,12); bytes.writeUInt32LE(width,16);
  bytes.writeUInt32LE(data.length,20); bytes.writeUInt32LE(32,76);
  bytes.writeUInt32LE(4,80); bytes.write(format,84); bytes.writeUInt32LE(0x1000,108);
  bytes.set(data,128); return bytes;
}
const pixel = (texture,x=0,y=0) => [...texture.rgba.slice((y*texture.width+x)*4,(y*texture.width+x+1)*4)];
const bc1 = Buffer.from([0,248,224,7,0xe4,0,0,0]); // red, green, and both interpolants
function etc(control, indices=0) { const b=Buffer.alloc(8); b.writeUInt32BE(control>>>0); b.writeUInt32BE(indices>>>0,4); return b; }
function pkm(block,width=4,height=4) {
  const b=Buffer.alloc(16+block.length); b.write('PKM 10');
  b.writeUInt16BE(Math.ceil(width/4)*4,8); b.writeUInt16BE(Math.ceil(height/4)*4,10);
  b.writeUInt16BE(width,12); b.writeUInt16BE(height,14); b.set(block,16); return b;
}
test('BC1 RGB endpoints, interpolation, transparent mode, and partial edge blocks',()=>{
  let t=decodeTexture(dds('DXT1',bc1));
  assert.deepEqual([0,1,2,3].map(x=>pixel(t,x)),[[255,0,0,255],[0,255,0,255],[170,85,0,255],[85,170,0,255]]);
  t=decodeTexture(dds('DXT1',Buffer.from([0,0,255,255,255,255,255,255]),3,2));
  assert.equal(t.rgba.length,24); assert.deepEqual(pixel(t,2,1),[0,0,0,0]);
});
test('BC2 explicit alpha and BC3 endpoint/interpolated alpha',()=>{
  const alpha=Buffer.alloc(8,0x80);
  let t=decodeTexture(dds('DXT3',Buffer.concat([alpha,bc1])));
  assert.equal(pixel(t)[3],0); assert.equal(pixel(t,1)[3],136);
  t=decodeTexture(dds('DXT5',Buffer.concat([Buffer.from([255,0,0x88,0x06,0,0,0,0]),bc1])));
  assert.deepEqual([0,1,2,3].map(x=>pixel(t,x)[3]),[255,0,218,182]);
  t=decodeTexture(dds('DXT5',Buffer.concat([Buffer.from([0,100,0xbe,0,0,0,0,0]),bc1])));
  assert.deepEqual([0,1,2].map(x=>pixel(t,x)[3]),[0,255,20]);
});
test('DXT2 unpremultiplies RGB and preserves alpha',()=>{
  const t=decodeTexture(dds('DXT2',Buffer.concat([Buffer.alloc(8,0x88),Buffer.from([0,128,0,0,0,0,0,0])])));
  assert.deepEqual(pixel(t),[248,0,0,136]);
});
test('BC4/BC5 channel previews',()=>{
  const channel=Buffer.from([40,20,0,0,0,0,0,0]);
  assert.deepEqual(pixel(decodeTexture(dds('ATI1',channel))),[40,40,40,255]);
  assert.deepEqual(pixel(decodeTexture(dds('ATI2',Buffer.concat([channel,Buffer.from([80,10,0,0,0,0,0,0])])))),[40,80,0,255]);
});
test('ETC1 individual mode, vertical/horizontal subblocks and column-major selectors',()=>{
  let t=decodeTexture(dds('ETC1',etc(0xf00f0000,1<<4)));
  assert.deepEqual(pixel(t,0,0),[255,2,2,255]);
  assert.deepEqual(pixel(t,1,0),[255,8,8,255]);
  assert.deepEqual(pixel(t,2,0),[2,255,2,255]);
  t=decodeTexture(pkm(etc(0xf00f0001)));
  assert.deepEqual(pixel(t,0,2),[2,255,2,255]);
});
test('ETC1 differential mode handles negative deltas, table signs and edge cropping',()=>{
  // RGB bases (16,10,4), deltas (-1,+2,-4), modifier table 0, selector 2 at (0,0).
  const block=etc((135<<24)|(82<<16)|(36<<8)|2,1<<16);
  const t=decodeTexture(pkm(block,3,2));
  assert.deepEqual(pixel(t),[130,80,31,255]);
  assert.deepEqual(pixel(t,2,0),[125,101,2,255]);
  assert.equal(t.rgba.length,24);
});
test('Saga DDS headers with zero structure sizes/flags decode ETC1',()=>{
  const b=dds('ETC1',etc(0xf00f0000)); b.writeUInt32LE(0,4); b.writeUInt32LE(0,76); b.writeUInt32LE(0,80);
  assert.deepEqual(pixel(decodeTexture(b)),[255,2,2,255]);
});
test('shipped Saga ETC1 headers report a 24-byte pixel-format structure',()=>{
  const b=dds('ETC1',etc(0xf00f0000)); b.writeUInt32LE(24,76);
  assert.deepEqual(pixel(decodeTexture(b)),[255,2,2,255]);
});
test('DDS RGB masks, padding, and absent alpha',()=>{
  const b=dds('',Buffer.from([30,20,10,0,60,50,40]),1,2);
  b.writeUInt32LE(0x100f,8); b.writeUInt32LE(4,20); b.writeUInt32LE(0x40,80); b.writeUInt32LE(24,88);
  [0xff0000,0xff00,0xff,0].forEach((v,i)=>b.writeUInt32LE(v,92+i*4));
  const t=decodeTexture(b); assert.deepEqual(pixel(t),[10,20,30,255]); assert.deepEqual(pixel(t,0,1),[40,50,60,255]);
});
test('DX10 BC1 and RGBA8 headers, first array layer and mip metadata',()=>{
  const ext=Buffer.alloc(20); ext.writeUInt32LE(71,0); ext.writeUInt32LE(3,4); ext.writeUInt32LE(2,12);
  let b=dds('DX10',Buffer.concat([ext,bc1])); b.writeUInt32LE(4,28);
  let t=decodeTexture(b); assert.deepEqual(pixel(t),[255,0,0,255]); assert.equal(t.faces,2); assert.equal(t.mipmaps,4);
  ext.writeUInt32LE(28); ext.writeUInt32LE(1,12);
  t=decodeTexture(dds('DX10',Buffer.concat([ext,Buffer.from([10,20,30,40])]),1,1));
  assert.deepEqual(pixel(t),[10,20,30,40]);
});
test('ETC1 KTX handles both header byte orders',()=>{
  for (const little of [true,false]) {
    const b=Buffer.alloc(76); b.set([171,75,84,88,32,49,49,187,13,10,26,10]);
    const set=(v,o)=>little?b.writeUInt32LE(v,o):b.writeUInt32BE(v,o);
    set(0x04030201,12); set(1,20); set(0x8d64,28); set(0x1907,32);
    set(4,36); set(4,40); set(1,52); set(1,56); set(8,64); b.set(etc(0xf00f0000),68);
    assert.deepEqual(pixel(decodeTexture(b)),[255,2,2,255]);
  }
});
test('rejects truncated, unsupported, excessive, and malformed textures before allocating pixels',()=>{
  assert.throws(()=>decodeTexture(Buffer.alloc(8)),/Truncated/);
  assert.throws(()=>decodeTexture(dds('DXT1',bc1.subarray(0,7))),/Truncated/);
  assert.throws(()=>decodeTexture(dds('DXT1',bc1,65535,65535)),/dimensions/);
  assert.throws(()=>decodeTexture(dds('ETC2',bc1)),/not supported/);
  assert.throws(()=>decodeTexture(pkm(etc(0x04000002))),/differential/);
  const bad=pkm(etc(0)); bad.writeUInt16BE(8,8); assert.throws(()=>decodeTexture(bad),/dimensions/);
  const header=dds('DXT1',bc1); header.writeUInt32LE(120,4); assert.throws(()=>decodeTexture(header),/header/);
});
