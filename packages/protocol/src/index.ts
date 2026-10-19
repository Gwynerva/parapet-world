/**
 * @parapet-world/protocol: wire messages between the game and the server. Hot-path messages
 * (inputs, ticks, relayed inputs, keyframes) are binary frames with DataView codecs; the rest are
 * JSON text frames with hand-written validators.
 */
export { ByteReader, ByteWriter, ProtocolError } from './binary.ts';
export {
  Bin,
  KeyframeReason,
  decodeBinary,
  encodeBinary,
  type BinaryMessage,
  type HashMsg,
  type InputFillMsg,
  type InputMsg,
  type KeyframeMsg,
  type KeyframeReasonCode,
  type RunnerInputMsg,
  type TickMsg,
} from './binary-messages.ts';
export {
  NAME_RE,
  PROTOCOL_VERSION,
  encodeJson,
  parseClientJson,
  parseServerJson,
  validLook,
  type BoardEntry,
  type ClientJson,
  type ErrorCode,
  type GameEvent,
  type ProfileView,
  type ServerJson,
} from './json-messages.ts';
