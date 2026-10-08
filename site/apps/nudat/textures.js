// CPU decoding keeps previews independent of GPU compression extensions.
// DDS: https://learn.microsoft.com/en-us/windows/win32/direct3ddds/dx-graphics-dds-pguide
// ETC1: https://registry.khronos.org/OpenGL/extensions/OES/OES_compressed_ETC1_RGB8_texture.txt
// Saga uses ordinary DDS headers with the ETC1 FourCC for Android textures.
const MAX_PIXELS = 16 * 1024 * 1024;
const modifiers = [[2,8,-2,-8],[5,17,-5,-17],[9,29,-9,-29],[13,42,-13,-42],
  [18,60,-18,-60],[24,80,-24,-80],[33,106,-33,-106],[47,183,-47,-183]];
const clamp = value => Math.max(0, Math.min(255, value));
const text = (bytes, offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
function requireBytes(bytes, offset, count) {
  if (!Number.isSafeInteger(offset + count) || offset < 0 || count < 0 || offset + count > bytes.length)
    throw new Error('Truncated texture data.');
}
function dimensions(width, height) {
  if (!width || !height || width > 16384 || height > 16384 || width * height > MAX_PIXELS)
    throw new Error('Texture preview requires valid dimensions of at most 16 megapixels.');
}
function parse(bytes) {
  requireBytes(bytes, 0, 16);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = offset => view.getUint32(offset, true);
  if (text(bytes, 0, 4) === 'DDS ') {
    requireBytes(bytes, 0, 128);
    // Saga's own DDS writer leaves both structure sizes and FOURCC flags zero.
    const sagaHeader = u32(4) === 0 && u32(76) === 0;
    // Shipped Android ETC1 files report 24 here, but retain the 128-byte DDS layout.
    const sagaETC1 = u32(76) === 24 && text(bytes,84,4) === 'ETC1';
    if (!sagaHeader && (u32(4) !== 124 || (u32(76) !== 32 && !sagaETC1))) throw new Error('Invalid DDS header.');
    const texture = { width: u32(16), height: u32(12), offset: 128, mipmaps: Math.max(1, u32(28)), faces: u32(112) & 0x200 ? 6 : 1 };
    if (u32(24) > 1 || u32(112) & 0x200000) throw new Error('Volume DDS textures are not supported.');
    const flags = u32(80), fourCC = text(bytes, 84, 4);
    if (flags & 4 || (sagaHeader && u32(84))) {
      const formats = { DXT1: 'BC1', DX1A: 'BC1', DXT2: 'BC2', DXT3: 'BC2', DXT4: 'BC3', DXT5: 'BC3', ATI1: 'BC4', BC4U: 'BC4', ATI2: 'BC5', BC5U: 'BC5', ETC1: 'ETC1' };
      texture.format = Object.hasOwn(formats, fourCC) ? formats[fourCC] : null;
      texture.premultiplied = fourCC === 'DXT2' || fourCC === 'DXT4';
      if (fourCC === 'DX10') {
        requireBytes(bytes, 128, 20);
        if (u32(132) !== 3 || u32(140) < 1) throw new Error('Only 2D DDS textures are supported.');
        const dxgi = u32(128);
        const formats = { 71:'BC1',72:'BC1',74:'BC2',75:'BC2',77:'BC3',78:'BC3',80:'BC4',83:'BC5',28:'RGBA',29:'RGBA',87:'RGBA',91:'RGBA',88:'RGBA',93:'RGBA' };
        texture.format = formats[dxgi]; texture.offset = 148;
        texture.faces = (u32(136) & 4 ? 6 : 1) * u32(140);
        texture.premultiplied = (u32(144) & 7) === 2;
        if (texture.format === 'RGBA') {
          texture.bits = 32;
          texture.masks = dxgi === 28 || dxgi === 29 ? [255,65280,16711680,4278190080] : [16711680,65280,255,dxgi === 88 || dxgi === 93 ? 0 : 4278190080];
        }
        if (!texture.format) throw new Error(`DDS DXGI format ${dxgi} is not supported yet.`);
      }
      if (!texture.format) throw new Error(`DDS format ${fourCC.trim() || 'unknown'} is not supported yet.`);
    } else if (flags & 0x40) {
      texture.format = 'RGBA'; texture.bits = u32(88);
      texture.masks = [u32(92), u32(96), u32(100), flags & 1 ? u32(104) : 0];
      if (![16,24,32].includes(texture.bits) || texture.masks.slice(0,3).some(mask => !mask))
        throw new Error('Unsupported DDS RGB bit depth or channel masks.');
    } else throw new Error('Unsupported DDS pixel format.');
    if (texture.format === 'RGBA') texture.pitch = u32(8) & 8 ? u32(20) : texture.width * texture.bits / 8;
    return texture;
  }
  if (['PKM 10','PKM 20'].includes(text(bytes, 0, 6))) {
    if (view.getUint16(6) !== 0) throw new Error('This PKM file is not ETC1.');
    const width = view.getUint16(12), height = view.getUint16(14);
    if (view.getUint16(8) !== Math.ceil(width / 4) * 4 || view.getUint16(10) !== Math.ceil(height / 4) * 4)
      throw new Error('Invalid PKM dimensions.');
    return { format:'ETC1', width, height, offset:16, mipmaps:1, faces:1 };
  }
  const ktx = [171,75,84,88,32,49,49,187,13,10,26,10];
  if (ktx.every((value, index) => bytes[index] === value)) {
    requireBytes(bytes, 0, 64);
    const endian = u32(12);
    if (![0x04030201,0x01020304].includes(endian)) throw new Error('Invalid KTX byte order.');
    const get = offset => view.getUint32(offset, endian === 0x04030201);
    if (get(16) !== 0 || get(28) !== 0x8d64 || get(44) || get(48) || get(52) !== 1)
      throw new Error('Only 2D ETC1 KTX textures are supported.');
    const offset = 64 + get(60);
    requireBytes(bytes, offset, 4);
    const count = Math.ceil(get(36) / 4) * Math.ceil(get(40) / 4) * 8;
    if (get(offset) !== count) throw new Error('Invalid KTX mip size.');
    return { format:'ETC1', width:get(36), height:get(40), offset:offset+4, mipmaps:Math.max(1,get(56)), faces:1 };
  }
  throw new Error('Unrecognized texture container. Expected DDS, PKM, or ETC1 KTX; raw ETC1 has no image dimensions.');
}
function color565(value) {
  const r = value >>> 11, g = (value >>> 5) & 63, b = value & 31;
  return [(r << 3) | (r >>> 2), (g << 2) | (g >>> 4), (b << 3) | (b >>> 2), 255];
}
function decodeBC(view, offset, format, block) {
  // BC4/5 use the same endpoint/index encoding as the BC3 alpha channel.
  function channel(at) {
    const a = view.getUint8(at), b = view.getUint8(at+1), values = [a,b];
    if (a > b) for (let i=1; i<=6; i++) values.push(Math.floor(((7-i)*a+i*b)/7));
    else { for (let i=1; i<=4; i++) values.push(Math.floor(((5-i)*a+i*b)/5)); values.push(0,255); }
    const pixels = new Uint8Array(16);
    for (let i=0; i<16; i++) {
      const bit = i*3, byte = at+2+(bit>>>3), shift = bit&7;
      const word = view.getUint8(byte) | (byte < at+7 ? view.getUint8(byte+1)<<8 : 0);
      pixels[i] = values[(word>>>shift)&7];
    }
    return pixels;
  }
  if (format === 'BC4' || format === 'BC5') {
    const r = channel(offset), g = format === 'BC5' ? channel(offset+8) : r;
    for (let i=0; i<16; i++) block.set([r[i],g[i],format === 'BC5' ? 0 : r[i],255],i*4);
    return;
  }
  const colorOffset = offset + (format === 'BC1' ? 0 : 8);
  const c0 = view.getUint16(colorOffset,true), c1 = view.getUint16(colorOffset+2,true);
  const colors = [color565(c0),color565(c1)];
  if (c0 > c1 || format !== 'BC1') {
    colors.push(colors[0].map((v,c)=>c===3?255:Math.floor((2*v+colors[1][c])/3)));
    colors.push(colors[0].map((v,c)=>c===3?255:Math.floor((v+2*colors[1][c])/3)));
  } else { colors.push(colors[0].map((v,c)=>c===3?255:Math.floor((v+colors[1][c])/2))); colors.push([0,0,0,0]); }
  const indices = view.getUint32(colorOffset+4,true);
  const alpha = format === 'BC3' ? channel(offset) : null;
  for (let i=0; i<16; i++) {
    block.set(colors[(indices >>> (i*2)) & 3],i*4);
    if (alpha) block[i*4+3] = alpha[i];
    if (format === 'BC2') block[i*4+3] = ((view.getUint8(offset+(i>>>1)) >>> ((i&1)*4)) & 15)*17;
  }
}
function decodeETC1(view, offset, block) {
  const control = view.getUint32(offset);
  const bits = view.getUint32(offset+4), colors = [[],[]];
  for (let c=0; c<3; c++) {
    const byte = (control >>> (24-c*8)) & 255;
    if (control & 2) {
      const a = byte >>> 3, b = a + ((byte & 7) < 4 ? byte & 7 : (byte & 7)-8);
      if (b < 0 || b > 31) throw new Error('Invalid ETC1 differential block (ETC2 is not supported).');
      colors[0].push((a<<3)|(a>>>2)); colors[1].push((b<<3)|(b>>>2));
    } else { colors[0].push((byte>>>4)*17); colors[1].push((byte&15)*17); }
  }
  for (let y=0; y<4; y++) for (let x=0; x<4; x++) {
    const half = (control & 1 ? y : x) < 2 ? 0 : 1;
    const table = (control >>> (half ? 2 : 5)) & 7, bit = x*4+y;
    const modifier = modifiers[table][((bits >>> (bit+16)) & 1)*2+((bits >>> bit)&1)];
    const pixel = (y*4+x)*4;
    for (let c=0; c<3; c++) block[pixel+c] = clamp(colors[half][c]+modifier);
    block[pixel+3] = 255;
  }
}
export function decodeTexture(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const texture = parse(bytes);
  const { width, height, format, offset } = texture;
  dimensions(width,height);
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let rgba;
  if (format === 'RGBA') {
    const stride = texture.bits/8, pitch = texture.pitch;
    if (pitch < width*stride) throw new Error('Invalid DDS row pitch.');
    requireBytes(bytes,offset,(height-1)*pitch+width*stride);
    const channels = texture.masks.map(mask => {
      if (!mask) return null;
      let shift = 0; while (((mask>>>shift)&1) === 0) shift++;
      const max = mask>>>shift;
      if (((max+1)&max) !== 0 || (texture.bits < 32 && mask >= 2**texture.bits)) throw new Error('Invalid DDS channel mask.');
      return { mask,shift,max };
    });
    for (let a=0;a<4;a++) for(let b=a+1;b<4;b++) if (texture.masks[a]&texture.masks[b]) throw new Error('Overlapping DDS channel masks.');
    rgba = new Uint8ClampedArray(width*height*4);
    for (let y=0;y<height;y++) for(let x=0;x<width;x++) {
      const at = offset+y*pitch+x*stride;
      let value = 0; for(let b=0;b<stride;b++) value |= bytes[at+b]<<(8*b);
      for(let c=0;c<4;c++) { const ch=channels[c]; rgba[(y*width+x)*4+c] = ch ? Math.round(((value&ch.mask)>>>ch.shift)*255/ch.max) : 255; }
    }
  } else {
    const blockSize = ['BC1','BC4','ETC1'].includes(format) ? 8 : 16;
    const columns = Math.ceil(width/4), rows = Math.ceil(height/4);
    requireBytes(bytes,offset,columns*rows*blockSize);
    rgba = new Uint8ClampedArray(width*height*4);
    const block = new Uint8Array(64);
    for(let by=0;by<rows;by++) for(let bx=0;bx<columns;bx++) {
      const at=offset+(by*columns+bx)*blockSize;
      if(format==='ETC1') decodeETC1(view,at,block); else decodeBC(view,at,format,block);
      for(let y=0;y<4 && by*4+y<height;y++) for(let x=0;x<4 && bx*4+x<width;x++) {
        rgba.set(block.subarray((y*4+x)*4,(y*4+x+1)*4),((by*4+y)*width+bx*4+x)*4);
      }
    }
  }
  if (texture.premultiplied) for(let i=0;i<rgba.length;i+=4) for(let c=0;c<3;c++) rgba[i+c] = rgba[i+3] ? Math.round(rgba[i+c]*255/rgba[i+3]) : 0;
  return { width,height,format,rgba,mipmaps:texture.mipmaps,faces:texture.faces };
}
