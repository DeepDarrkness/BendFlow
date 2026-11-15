import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectPath } from '../../../src/paths.ts';
import { bun, run, source } from '../../../scripts/lib/toolchain.ts';
import { CPU_ARGS } from '../../../src/runtime.ts';

export type NativeCommand = { hex: string; pattern: string };
export type NativeReply = { hex: string; expression: string; kind: string };

export function prefixes(hex: string): string[] {
  return Array.from({ length: hex.length / 2 }, (_, i) => hex.slice(0, i * 2));
}

function bytes(hex: string): string {
  return `[${[...Buffer.from(hex, 'hex')].join(', ')}]`;
}

export function nativeProbe(options: {
  name: string; module: string; parser?: string; imports?: string; helpers?: string;
  commands: readonly NativeCommand[]; replies: readonly NativeReply[]; malformed: readonly string[];
}): string[] {
  const { name, module, commands, replies, malformed } = options;
  const parser = options.parser ?? 'App.take_command';
  const checks = commands.map(({ pattern }, i) => `
def command_${i}(got: Maybe<&2, ${name === 'session' ? 'Session.Command' : 'App.Command'}>) -> Bool:
  match got:
    case Some{${pattern}}:
      True{}
    case other:
      False{}
`);
  const statements = commands.flatMap(({ hex }, i) => [
    `    Unit <- IO.print(Bool.show(command_${i}(${parser}(${bytes(hex)}))))`,
    `    Unit <- IO.print(Bool.show(rejections([${[...prefixes(hex), hex + '00', hex + 'ff'].map(bytes).join(', ')}])))`,
  ]);
  const program = `import Base
import ../../bend/${module}.bend as App
import ../../bend/bytes.bend as Bytes
import ../../bend/loop.bend as Loop
import ../../bend/pages.bend as Pages
import ../../bend/collection-features.bend as Features
${options.imports ?? ''}

def rejected(got: Maybe<&2, ${name === 'session' ? 'Session.Command' : 'App.Command'}>) -> Bool:
  match got:
    case None{}:
      True{}
    case Some{command}:
      False{}

def rejections(vectors: List<&2, List<&2, U32>>) -> Bool:
  match vectors:
    case Nil{}:
      True{}
    case payload <> rest:
      Bool.and(rejected(${parser}(payload)), rejections(rest))

def show_bytes.go(xs: List<&2, U32>, acc: String) -> String:
  match xs:
    case Nil{}:
      acc ++ "]"
    case h <> t:
      show_bytes.go(t, acc ++ "," ++ U32.show(h))

def show_bytes(xs: List<&2, U32>) -> String:
  match xs:
    case Nil{}:
      "[]"
    case h <> t:
      show_bytes.go(t, "[" ++ U32.show(h))
${options.helpers ?? ''}
${checks.join('')}
def main() -> IO(Unit):
  do IO<Unit>:
${statements.join('\n')}
    Unit <- IO.print(Bool.show(rejections([${malformed.map(bytes).join(', ')}])))
${replies.map(({ expression }) => `    Unit <- IO.print(show_bytes(${expression}))`).join('\n')}
    return Unit{}
`;
  const directory = projectPath('build/codecs');
  mkdirSync(directory, { recursive: true });
  const input = resolve(directory, `${name}-vectors.bend`);
  const output = resolve(directory, `${name}-vectors`);
  writeFileSync(input, program);
  run(bun, [resolve(source, 'bend2/main.ts'), input, '-o', output]);
  return run(output, CPU_ARGS).split('\n');
}
