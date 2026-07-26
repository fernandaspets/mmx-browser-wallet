// ESM wrapper for bech32m encoding (MMX uses bech32m, NOT bech32)
// Ported from the bech32 npm package

const ALPHABET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const ALPHABET_MAP = {};
for (let i = 0; i < ALPHABET.length; i++) ALPHABET_MAP[ALPHABET[i]] = i;

// bech32m encoding constant (NOT 1, which is bech32)
const ENCODING_CONST = 0x2bc830a3;

function polymodStep(pre) {
  const b = pre >> 25;
  return (((pre & 0x1ffffff) << 5) ^
    (-((b >> 0) & 1) & 0x3b6a57b2) ^
    (-((b >> 1) & 1) & 0x26508e6d) ^
    (-((b >> 2) & 1) & 0x1ea119fa) ^
    (-((b >> 3) & 1) & 0x3d4233dd) ^
    (-((b >> 4) & 1) & 0x2a1462b3));
}

function prefixChk(prefix) {
  let chk = 1;
  for (let i = 0; i < prefix.length; ++i) {
    const c = prefix.charCodeAt(i);
    if (c < 33 || c > 126) return null;
    chk = polymodStep(chk) ^ (c >> 5);
  }
  chk = polymodStep(chk);
  for (let i = 0; i < prefix.length; ++i) {
    const c = prefix.charCodeAt(i);
    chk = polymodStep(chk) ^ (c & 0x1f);
  }
  return chk;
}

function convertBits(data, frombits, tobits, pad) {
  let acc = 0, bits = 0;
  const ret = [];
  const maxv = (1 << tobits) - 1;
  for (const v of data) {
    if (v < 0 || (v >> frombits) !== 0) return null;
    acc = (acc << frombits) | v;
    bits += frombits;
    while (bits >= tobits) {
      bits -= tobits;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits) {
    ret.push((acc << (tobits - bits)) & maxv);
  } else if (bits >= frombits || ((acc << (tobits - bits)) & maxv)) {
    return null;
  }
  return ret;
}

function encode(prefix, words) {
  // Compute checksum: process prefix, then data, then XOR with ENCODING_CONST
  let chk = 1;
  for (let i = 0; i < prefix.length; ++i) {
    const c = prefix.charCodeAt(i);
    chk = polymodStep(chk) ^ (c >> 5);
  }
  chk = polymodStep(chk);
  for (let i = 0; i < prefix.length; ++i) {
    const c = prefix.charCodeAt(i);
    chk = polymodStep(chk) ^ (c & 0x1f);
  }
  for (const w of words) {
    chk = polymodStep(chk) ^ w;
  }
  // 6 extra polymod steps (one per checksum char) before XOR
  for (let i = 0; i < 6; ++i) {
    chk = polymodStep(chk);
  }
  chk ^= ENCODING_CONST;
  
  let combined = words.concat([]);
  for (let i = 0; i < 6; ++i) {
    combined.push((chk >> (5 * (5 - i))) & 0x1f);
  }
  
  let str = prefix + '1';
  for (const p of combined) str += ALPHABET[p];
  return str;
}

function decode(str) {
  if (str.length < 8 || str.length > 1023) return null;
  const pos = str.lastIndexOf('1');
  if (pos < 1 || pos + 7 > str.length) return null;
  
  const prefix = str.substring(0, pos);
  const data = [];
  for (let i = pos + 1; i < str.length; i++) {
    const c = str[i];
    if (ALPHABET_MAP[c] === undefined) return null;
    data.push(ALPHABET_MAP[c]);
  }
  
  const chk = prefixChk(prefix);
  if (chk === null) return null;
  
  // Verify checksum
  let computed = 1;
  for (const c of prefix) {
    computed = polymodStep(computed) ^ (c.charCodeAt(0) >> 5);
  }
  computed = polymodStep(computed);
  for (const c of prefix) {
    computed = polymodStep(computed) ^ (c.charCodeAt(0) & 0x1f);
  }
  for (const d of data) {
    computed = polymodStep(computed) ^ d;
  }
  
  if (computed !== ENCODING_CONST) return null;
  
  return { prefix, words: data.slice(0, -6) };
}

export const bech32m = { encode, decode };
