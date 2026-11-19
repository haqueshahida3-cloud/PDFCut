// qpdf (compiled to WebAssembly) for encryption, decryption, linearization and repair.
// A fresh module instance is created per call because qpdf's main() ends the Emscripten runtime.
import createQpdf from '@neslinesli93/qpdf-wasm';

interface VirtualFs {
  writeFile(path: string, data: Uint8Array): void;
  readFile(path: string): Uint8Array;
}

/**
 * Depending on the Emscripten runtime, qpdf's exit either returns the code or throws an object with a
 * numeric `status`. Both are handled here; anything else is a real error and is re-thrown.
 */
function exitStatus(e: unknown): number | null {
  if (typeof e === 'object' && e !== null && 'status' in e) {
    const status = (e as { status: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return null;
}

export async function runQpdf(input: Uint8Array, args: string[], wasmUrl: string): Promise<Uint8Array> {
  const qpdf = await createQpdf({ locateFile: () => wasmUrl });
  const fs = qpdf.FS as unknown as VirtualFs;
  fs.writeFile('/in.pdf', input);
  let code: number;
  try {
    code = qpdf.callMain([...args, '/in.pdf', '/out.pdf']);
  } catch (e) {
    const status = exitStatus(e);
    if (status === null) throw e;
    code = status;
  }
  // 0 = success, 3 = success with warnings. Anything else is a real failure.
  if (code !== 0 && code !== 3) {
    throw new Error(`qpdf could not process this file (exit code ${code}). For a password-protected file, check the password.`);
  }
  try {
    return fs.readFile('/out.pdf');
  } catch {
    throw new Error('qpdf finished without writing an output file.');
  }
}
