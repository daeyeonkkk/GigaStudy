export type PcmMathWasmRuntime = {
  abs: (value: number) => number
}

const PCM_MATH_WASM_BYTES = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d,
  0x01, 0x00, 0x00, 0x00,
  0x01, 0x06, 0x01, 0x60, 0x01, 0x7d, 0x01, 0x7d,
  0x03, 0x02, 0x01, 0x00,
  0x07, 0x07, 0x01, 0x03, 0x61, 0x62, 0x73, 0x00, 0x00,
  0x0a, 0x07, 0x01, 0x05, 0x00, 0x20, 0x00, 0x8b, 0x0b,
])

let runtimePromise: Promise<PcmMathWasmRuntime | null> | null = null

export async function getPcmMathWasmRuntime(): Promise<PcmMathWasmRuntime | null> {
  if (typeof WebAssembly === 'undefined') {
    return null
  }

  if (!runtimePromise) {
    runtimePromise = WebAssembly.instantiate(PCM_MATH_WASM_BYTES)
      .then(({ instance }) => {
        const exports = instance.exports as {
          abs?: (value: number) => number
        }
        if (typeof exports.abs !== 'function') {
          return null
        }

        return {
          abs: (value: number) => exports.abs?.(value) ?? Math.abs(value),
        }
      })
      .catch(() => null)
  }

  return runtimePromise
}
