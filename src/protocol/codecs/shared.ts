import { BytesReader } from '../bytes.ts';

export function fail(reader: BytesReader): { kind: 'fail'; code: number; message: string } {
  const code = reader.u32();
  const message = reader.text();
  reader.finish();
  return { kind: 'fail', code, message };
}
