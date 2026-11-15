import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { hostname, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { defaultOutput, sourceSha256 } from '../build/cuda.ts';
import { checkVerifiedProfile, gpuProfileSchema, type GpuProfileResult } from './gpu.ts';

export type HardwareResult =
  | { status: 'verified'; report: string; evidence: Extract<GpuProfileResult, { status: 'verified' }> }
  | { status: 'unavailable'; report: string; reason: string }
  | { status: 'failed'; report: string; detail: string };

// This boundary never manufactures inventory test observations from hardware JSON.
export function readHardware(report = resolve(defaultOutput, 'profile.json')): HardwareResult {
  const path = resolve(report);
  if (!existsSync(path)) return { status: 'unavailable', report: path, reason: 'No current GPU hardware evidence file' };
  try {
    const profile = gpuProfileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    assert.equal(profile.sourceSha256, sourceSha256(), 'Hardware evidence source is stale');
    assert.equal(profile.host.hostname, hostname(), 'Hardware evidence belongs to another host');
    assert.equal(profile.host.platform, process.platform);
    assert.equal(profile.host.release, release(), 'Hardware evidence kernel is stale');
    if (profile.status === 'unavailable') return { status: 'unavailable', report: path, reason: `${profile.reason}: ${profile.detail}` };
    if (profile.status === 'failed') return { status: 'failed', report: path, detail: profile.detail };
    checkVerifiedProfile(profile, dirname(path));
    return { status: 'verified', report: path, evidence: profile };
  } catch (error) {
    return { status: 'failed', report: path, detail: error instanceof Error ? error.message : String(error) };
  }
}

if (import.meta.main) {
  if (process.argv.length > 3) throw new Error('Usage: node scripts/conformance/hardware.ts [HARDWARE_REPORT]');
  const result = readHardware(process.argv[2]);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result.status !== 'verified') process.exitCode = 1;
}
