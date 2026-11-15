import { oc } from '@orpc/contract';
import { z } from 'zod';

import { u32, nat, text } from './values.ts';

const arithmeticOp = z.enum(['add', 'sub', 'mul', 'div', 'mod']);
const comparisonOp = z.enum(['eq', 'ne', 'lt', 'le', 'gt', 'ge']);
export const arithmeticOps = arithmeticOp.options;
export const comparisonOps = comparisonOp.options;
export const bitOps = z.enum(['and', 'or', 'xor', 'not', 'shl', 'shr']).options;
export const conversionOps = z.enum(['natToU32', 'natToF32', 'u32ToNat', 'u32ToF32', 'f32ToU32', 'f32ToNat']).options;
const calculate = z.discriminatedUnion('domain', [
  z.strictObject({ kind: z.literal('calculate'), domain: z.literal('nat'), op: arithmeticOp, left: nat, right: nat }),
  z.strictObject({ kind: z.literal('calculate'), domain: z.enum(['u32', 'f32']), op: arithmeticOp, left: u32, right: u32 }),
]);
const compareNumber = z.discriminatedUnion('domain', [
  z.strictObject({ kind: z.literal('compareNumber'), domain: z.literal('nat'), op: comparisonOp, left: nat, right: nat }),
  z.strictObject({ kind: z.literal('compareNumber'), domain: z.enum(['u32', 'f32']), op: comparisonOp, left: u32, right: u32 }),
]);
const convert = z.discriminatedUnion('op', [
  z.strictObject({ kind: z.literal('convert'), op: z.enum(['natToU32', 'natToF32']), value: nat }),
  z.strictObject({ kind: z.literal('convert'), op: z.enum(['u32ToNat', 'u32ToF32', 'f32ToU32', 'f32ToNat']), value: u32 }),
]);

export const numericCommandSchema = z.union([
  z.strictObject({ kind: z.literal('accumulate'), amount: nat }),
  z.strictObject({ kind: z.literal('add'), amount: u32 }),
  z.strictObject({ kind: z.literal('read') }),
  z.strictObject({ kind: z.literal('reset') }),
  z.strictObject({ kind: z.literal('parse'), text: text() }),
  z.strictObject({ kind: z.literal('show') }),
  z.strictObject({ kind: z.literal('f32Add'), left: u32, right: u32 }),
  z.strictObject({ kind: z.literal('compare'), left: nat, right: nat }),
  z.strictObject({ kind: z.literal('bits'), op: z.union([z.number().int().min(0).max(2), z.enum(['and', 'or', 'xor', 'not', 'shl', 'shr'])]), left: u32, right: u32 }),
  ...calculate.options, ...convert.options, ...compareNumber.options,
  z.strictObject({ kind: z.literal('bool'), op: z.enum(['and', 'or', 'xor', 'not']), left: z.boolean(), right: z.boolean() }),
]);

const snapshotSchema = z.strictObject({ nat, total: u32, count: u32, f32Bits: u32 });

export const numericReplySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('value'), value: snapshotSchema }),
  z.strictObject({ kind: z.literal('overflow'), value: snapshotSchema }),
  z.strictObject({ kind: z.literal('invalidText') }),
  z.strictObject({ kind: z.literal('text'), text: text() }),
  z.strictObject({ kind: z.literal('order'), order: z.enum(['lt', 'eq', 'gt']) }),
  z.strictObject({ kind: z.literal('bits'), value: u32 }),
  z.strictObject({ kind: z.literal('invalidCommand') }),
  z.strictObject({ kind: z.literal('nat'), value: nat }),
  z.strictObject({ kind: z.literal('bool'), value: z.boolean() }),
  z.strictObject({ kind: z.literal('arithmeticError'), reason: z.enum(['overflow', 'divisionByZero', 'outOfRange']) }),
]);

export type NumericCommand = z.infer<typeof numericCommandSchema>;
export type NumericReply = z.infer<typeof numericReplySchema>;

export const numericContract = {
  command: oc.input(numericCommandSchema).output(numericReplySchema),
};
