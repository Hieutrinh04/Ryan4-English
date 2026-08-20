// Sinh hai icon PNG cho tiện ích Chrome.
//
// manifest.json trỏ tới icons/icon48.png và icons/icon128.png; thiếu file thì
// Chrome từ chối nạp cả tiện ích với lỗi "Could not load icon".
//
// Vẽ thẳng bằng mã thay vì kèm file ảnh: không thêm phụ thuộc, và sửa màu thương
// hiệu thì chỉ sửa một dòng rồi chạy `npm run build:icons`.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

// Tím của Lexilo, cùng tông với --purple ở giao diện tối.
const BRAND = [91, 79, 196];
const INK = [255, 255, 255];

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** Ảnh RGBA không nén thành tệp PNG hợp lệ. */
function png(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 8 bit mỗi kênh
  header[9] = 6; // RGBA
  // Mỗi hàng phải có một byte đầu chỉ kiểu lọc; 0 nghĩa là không lọc.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Nền bo góc màu thương hiệu, chữ L trắng ở giữa. */
function draw(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  // Chữ L: nét dọc và nét ngang, đặt theo tỉ lệ để cỡ nào cũng cân.
  const left = Math.round(size * 0.34);
  const right = Math.round(size * 0.7);
  const top = Math.round(size * 0.26);
  const bottom = Math.round(size * 0.74);
  const stroke = Math.max(2, Math.round(size * 0.1));

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Bo bốn góc: điểm nằm ngoài đường tròn góc thì để trong suốt.
      const dx = Math.min(x, size - 1 - x);
      const dy = Math.min(y, size - 1 - y);
      const corner = dx < radius && dy < radius && Math.hypot(radius - dx, radius - dy) > radius;

      const inStem = x >= left && x < left + stroke && y >= top && y < bottom;
      const inFoot = y >= bottom - stroke && y < bottom && x >= left && x < right;
      const colour = corner ? null : inStem || inFoot ? INK : BRAND;

      const at = (y * size + x) * 4;
      if (!colour) {
        pixels[at + 3] = 0;
        continue;
      }
      pixels[at] = colour[0];
      pixels[at + 1] = colour[1];
      pixels[at + 2] = colour[2];
      pixels[at + 3] = 255;
    }
  }
  return png(size, pixels);
}

mkdirSync("extension/icons", { recursive: true });
for (const size of [48, 128]) {
  writeFileSync(`extension/icons/icon${size}.png`, draw(size));
  console.log(`đã vẽ extension/icons/icon${size}.png`);
}
