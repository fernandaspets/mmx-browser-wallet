// Minimal Buffer polyfill for browser (only what MMX crypto needs)
// Based on Node's Buffer API but simplified for Uint8Array

class BufferPolyfill extends Uint8Array {
  static from(source, encoding) {
    if (typeof source === 'string') {
      if (encoding === 'hex') {
        const arr = new Uint8Array(source.length / 2);
        for (let i = 0; i < source.length; i += 2) {
          arr[i / 2] = parseInt(source.substr(i, 2), 16);
        }
        return new BufferPolyfill(arr);
      }
      return new BufferPolyfill(new TextEncoder().encode(source));
    }
    if (source instanceof Uint8Array || source instanceof ArrayBuffer) {
      return new BufferPolyfill(source instanceof ArrayBuffer ? new Uint8Array(source) : source);
    }
    if (Array.isArray(source)) {
      return new BufferPolyfill(new Uint8Array(source));
    }
    return new BufferPolyfill(source);
  }

  static alloc(length, fill = 0) {
    const arr = new Uint8Array(length);
    if (fill) arr.fill(fill);
    return new BufferPolyfill(arr);
  }

  static concat(arrays) {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const a of arrays) {
      result.set(a, offset);
      offset += a.length;
    }
    return new BufferPolyfill(result);
  }

  toString(encoding) {
    if (encoding === 'hex') {
      let hex = '';
      for (const b of this) hex += b.toString(16).padStart(2, '0');
      return hex;
    }
    return new TextDecoder().decode(this);
  }

  reverse() {
    const arr = Array.from(this).reverse();
    return new BufferPolyfill(new Uint8Array(arr));
  }

  subarray(start, end) {
    return new BufferPolyfill(super.subarray(start, end));
  }

  writeUInt32BE(value, offset = 0) {
    this[offset] = (value >> 24) & 0xFF;
    this[offset + 1] = (value >> 16) & 0xFF;
    this[offset + 2] = (value >> 8) & 0xFF;
    this[offset + 3] = value & 0xFF;
    return offset + 4;
  }

  readUInt32LE(offset = 0) {
    return this[offset] | (this[offset + 1] << 8) | (this[offset + 2] << 16) | (this[offset + 3] << 24);
  }

  equals(other) {
    if (this.length !== other.length) return false;
    for (let i = 0; i < this.length; i++) {
      if (this[i] !== other[i]) return false;
    }
    return true;
  }
}

globalThis.Buffer = BufferPolyfill;
