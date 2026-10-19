import { describe, expect, it } from 'vitest';
import {
  Bin,
  KeyframeReason,
  ProtocolError,
  decodeBinary,
  encodeBinary,
  encodeJson,
  parseClientJson,
  parseServerJson,
  type BinaryMessage,
} from '../src/index.ts';

describe('binary codecs', () => {
  const samples: BinaryMessage[] = [
    {
      type: Bin.INPUT,
      fromStep: 123456,
      runs: [
        { steps: 3, held: 2 },
        { steps: 40, held: 6 },
      ],
      commands: [{ step: 123460, kind: 1, arg: 2 }],
    },
    { type: Bin.HASH, step: 90, hash: 0xdeadbeef },
    { type: Bin.TICK, serverStep: 99999, simStep: 400, ackStep: 403, slack: -5 },
    { type: Bin.RUNNER_INPUT, runner: 7, fromStep: 1, runs: [{ steps: 1, held: 0 }], commands: [] },
    {
      type: Bin.KEYFRAME,
      runner: 3,
      reason: KeyframeReason.RESYNC,
      serverStep: 77,
      state: Int32Array.from([1, -2, 3, 2147483647, -2147483648]),
    },
    { type: Bin.INPUT_FILL, runner: 3, step: 500, held: 16 },
  ];
  it('round-trips every message type', () => {
    for (const m of samples) {
      const back = decodeBinary(encodeBinary(m));
      expect(back).toEqual(m);
    }
  });
  it('rejects truncated and trailing bytes and unknown types', () => {
    const bytes = encodeBinary(samples[0]!);
    expect(() => decodeBinary(bytes.subarray(0, bytes.length - 1))).toThrow(ProtocolError);
    const longer = new Uint8Array(bytes.length + 1);
    longer.set(bytes);
    expect(() => decodeBinary(longer)).toThrow(ProtocolError);
    expect(() => decodeBinary(Uint8Array.of(250))).toThrow(ProtocolError);
  });
});

describe('json validators', () => {
  it('accepts a hello and rejects bad fields', () => {
    const hello = parseClientJson(
      encodeJson({ t: 'hello', v: 1, token: 'x'.repeat(32), name: ' Kite ', rules: 5 }),
    );
    expect(hello).toMatchObject({ t: 'hello', name: 'Kite' });
    expect(() =>
      parseClientJson('{"t":"hello","v":1,"token":"short","name":"a","rules":1}'),
    ).toThrow(ProtocolError);
    expect(() => parseClientJson('{"t":"look","look":{"hair":"bald","costume":"tee"}}')).toThrow(
      ProtocolError,
    );
    expect(() => parseClientJson('not json')).toThrow(ProtocolError);
  });
  it('parses server messages', () => {
    const m = parseServerJson(
      encodeJson({
        t: 'enter',
        id: 3,
        name: 'Bot',
        look: { hair: 'hairRed', costume: 'tee' },
        bot: true,
      }),
    );
    expect(m.t).toBe('enter');
  });
});
